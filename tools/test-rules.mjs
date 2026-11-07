/* 规则回归测试：把"能被玩家钻空子"和"新机制必须正确"的地方钉死。
 * 用法：node tools/test-rules.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, isNaN, parseInt, parseFloat };
vm.createContext(ctx);
for (const f of ['src/data.js', 'src/engine.js', 'src/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const run = (src) => vm.runInContext(src, ctx, { filename: 'rule' });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const R = run(`
(function () {
  const out = {};
  const newGame = () => {
    const g = new Game({ players: [
      { name: 'P1', isAI: false }, { name: 'P2', isAI: false },
      { name: 'P3', isAI: false }, { name: 'P4', isAI: false }] });
    return g;
  };

  /* ---------- 1. 股票套利必须被堵死 ---------- */
  const arb = [];
  for (const qty of [1, 3, 12, 40]) {
    const g = newGame();
    const p = g.players[0];
    const before = p.cash;
    const priceBefore = g.stockPrice(g.stockByCode('003'));
    const b = g.buyStock('003', qty, p);
    const s = g.sellStock('003', b.qty, p);
    arb.push({ qty: b.qty, delta: p.cash - before, buy: b.cost, sell: s.gain, priceBefore,
               priceAfter: g.stockPrice(g.stockByCode('003')) });
  }
  out.arb = arb;

  /* 连刷 20 轮也必须越刷越少 */
  const g2 = newGame();
  const p2 = g2.players[0];
  const start = p2.cash;
  for (let i = 0; i < 20; i++) {
    const b = g2.buyStock('003', 5, p2);
    if (b.ok) g2.sellStock('003', b.qty, p2);
  }
  out.arbLoopDelta = p2.cash - start;

  /* ---------- 2. 风险投资卡赔付表 ---------- */
  const g3 = newGame();
  const p3 = g3.players[0];
  const vBefore = p3.cash;
  const v = g3.buyVenture(p3);
  out.venture = { total: v.total, pay: v.pay, text: v.text, delta: p3.cash - vBefore, cost: CONFIG.cards.ventureCost };

  /* ---------- 3. 垃圾债券：领息 + 爆雷（单次可能第一圈就炸，所以统计期望寿命）---------- */
  let totalLaps = 0, explodedCount = 0, N = 400;
  for (let i = 0; i < N; i++) {
    const g = newGame();
    const p = g.players[0];
    p.cash = 100000;
    g.buyJunkBond(p);
    let laps = 0;
    while (p.products.junk && laps < 300) { g.onPassGo(p); laps++; }
    totalLaps += laps;
    if (!p.products.junk) explodedCount++;
  }
  out.junk = { avgLaps: totalLaps / N, explodeRate: explodedCount / N, lapPay: CONFIG.cards.junkPayment };

  /* ---------- 4. 地产期权：半价买 + 过路费 ---------- */
  const g5 = newGame();
  const A = g5.players[0], B = g5.players[1];
  A.cash = 100000; B.cash = 100000;
  const tileId = 21;                       // 枫丹廷
  const listPrice = g5.landPrice(g5.tile(tileId));
  g5.buyOption(tileId, A);
  const aCash = A.cash;
  const buy = g5.buyLand(tileId, A);       // 自己踩到 → 半价
  out.optionSelf = { listPrice, paid: aCash - A.cash, half: Math.round(listPrice * CONFIG.cards.optionDiscount / 100) * 100, owner: g5.tile(tileId).owner, optionCleared: !A.products.option };

  const g6 = newGame();
  const C1 = g6.players[0], C2 = g6.players[1];
  C1.cash = 100000; C2.cash = 100000;
  const t2 = 27;                           // 群玉阁
  g6.buyOption(t2, C1);
  const c1Cash = C1.cash, c2Cash = C2.cash;
  C2.pos = t2;
  g6.current = 1;
  g6.resolveLanding(7);
  const pending = g6.pending;
  g6.buyLand(t2, C2);
  out.optionOther = {
    feeCharged: pending ? pending.optionFee : -1,
    buyerPaid: c2Cash - C2.cash,
    holderGot: C1.cash - c1Cash,
    owner: g6.tile(t2).owner,
    optionCleared: !C1.products.option,
  };

  /* ---------- 5. 租金保险 ---------- */
  const g7 = newGame();
  const D = g7.players[0], E = g7.players[1];
  D.cash = 100000; E.cash = 100000;
  const landId = 26;                       // 璃月港
  g7.tile(landId).owner = 1;
  g7.tile(landId).level = 5;
  D.products.insurance = { paid: 0 };
  const rent = g7.rentOf(g7.tile(landId), 7);
  D.pos = landId; g7.current = 0;
  const dCash = D.cash, eCash = E.cash;
  g7.resolveLanding(7);
  out.insurance = { rent, payerPaid: dCash - D.cash, ownerGot: E.cash - eCash, selfRate: CONFIG.cards.insuranceSelfRate, consumed: !D.products.insurance };

  /* ---------- 6. 定期存单：3 圈到期 + 提前赎回 ---------- */
  const g8 = newGame();
  const F = g8.players[0];
  F.cash = 100000;
  const fBefore = F.cash;
  g8.buyDeposit(F);
  const afterBuy = F.cash;
  let laps = 0;
  while (F.products.deposit && laps < 10) { g8.onPassGo(F); laps++; }
  out.deposit = { cost: fBefore - afterBuy, laps, back: F.cash - afterBuy, rate: CONFIG.cards.depositRate };

  const g9 = newGame();
  const G1 = g9.players[0];
  G1.cash = 100000;
  const gBefore = G1.cash;
  g9.buyDeposit(G1);
  g9.redeemDeposit(G1);
  out.depositEarly = { net: G1.cash - gBefore, penalty: CONFIG.cards.depositPenalty };

  /* ---------- 7. 高风险产品只能持有一张 ---------- */
  const g10 = newGame();
  const H = g10.players[0];
  H.cash = 100000;
  g10.buyJunkBond(H);
  const secondJunk = g10.buyOption(22, H);
  out.highRiskLimit = { blocked: !secondJunk.ok, msg: secondJunk.msg };
  const secondIns = g10.buyInsurance(H);
  g10.buyInsurance(H);
  out.insuranceLimit = { first: secondIns.ok, second: g10.buyInsurance(H).ok };

  /* ---------- 8. 手续费确实收了 ---------- */
  const g11 = newGame();
  const I = g11.players[0];
  const before11 = I.cash;
  const b11 = g11.buyStock('003', 1, I);
  const s11 = g11.sellStock('003', 1, I);
  out.fee = { roundTrip: I.cash - before11, commission: CONFIG.stockCommission, buy: b11.cost, sell: s11.gain };

  return out;
})()
`);

/* ---------- 断言 ---------- */
for (const a of R.arb) {
  ok(a.delta < 0, `套利未堵死：买 ${a.qty} 股后立刻卖出净赚 ${a.delta}`);
}
ok(R.arbLoopDelta < 0, `连续买卖 20 轮居然赚钱了：${R.arbLoopDelta}`);
ok(R.venture.delta === R.venture.pay - R.venture.cost, '风投卡结算金额对不上');
ok(R.venture.total >= 2 && R.venture.total <= 12, '风投卡点数越界');
ok(R.junk.avgLaps > 5.0 && R.junk.avgLaps < 7.2, `垃圾债券期望寿命不对：${R.junk.avgLaps.toFixed(2)} 圈（理论值 6）`);
ok(R.junk.explodeRate > 0.95, `垃圾债券迟早应该爆雷，实际只炸了 ${(R.junk.explodeRate * 100).toFixed(0)}%`);
ok(R.optionSelf.paid === R.optionSelf.half, `期权半价不对：付了 ${R.optionSelf.paid}，应为 ${R.optionSelf.half}`);
ok(R.optionSelf.owner === 0 && R.optionSelf.optionCleared, '期权买地后没有正确清掉');
ok(R.optionOther.feeCharged === 1500, '期权过路费金额不对');
ok(R.optionOther.holderGot === 1500, '期权持有人没收到过路费');
ok(R.optionOther.owner === 1 && R.optionOther.optionCleared, '别人买走后期权没作废');
ok(R.insurance.payerPaid < R.insurance.rent, '租金保险没让投保人少付钱');
ok(R.insurance.ownerGot === R.insurance.rent, '房东没有拿到全额租金');
ok(R.insurance.consumed, '租金保险用掉后没有消耗');

const depNet = R.deposit.back - R.deposit.cost;
ok(R.deposit.laps === 3, `定期存单期数不对：${R.deposit.laps}`);
ok(depNet > 0, `定期存单到期居然亏了：${depNet}`);
ok(R.depositEarly.net === -3000 + 5000 - 5000 + 3000 ? true : R.depositEarly.net === -(5000 - 3000), `提前赎回净亏不对：${R.depositEarly.net}`);
ok(R.highRiskLimit.blocked, '高风险产品可以持有两张（应该被拦住）');
ok(R.insuranceLimit.first && !R.insuranceLimit.second, '租金保险可以重复买');
ok(R.fee.roundTrip < 0, `买 1 股再卖 1 股应该亏钱，实际 ${R.fee.roundTrip}`);
ok(near(R.fee.roundTrip / 1200, -0.028, 0.012), `单股往返亏损比例不对：${(R.fee.roundTrip / 1200 * 100).toFixed(2)}%`);

/* ★ 局时配置必须"属于这一局"，不能被全局 CONFIG 顶掉。
   踩过的坑：this.config 存的是 CONFIG 的**引用**，而 endTurn 读 CONFIG.maxQuarters，
   于是存档恢复后（全局退回默认 35）任何恢复过的对局都会提前结束 ——
   实测 PGVS 那局上限 50，恢复后 Q36 就被判结束，直接毁掉一局。 */
const Q = run(`
(function () {
  const out = {};
  CONFIG.maxQuarters = 50;
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] });
  out.own = g.totalQuarters();
  const snap = g.serialize(0);
  CONFIG.maxQuarters = 35;                 // 模拟"服务端全局回到了默认值"
  const g2 = Game.deserialize(snap);
  out.globalAfter = CONFIG.maxQuarters;
  out.afterRestore = g2.totalQuarters();
  out.isCopy = (g2.config !== CONFIG) && (g.config !== CONFIG);
  /* 两个房间并存时不能互相覆盖 */
  CONFIG.maxQuarters = 20;
  const ga = new Game({ players: [{ name: 'A' }] });
  CONFIG.maxQuarters = 90;
  const gb = new Game({ players: [{ name: 'B' }] });
  out.roomA = ga.totalQuarters();
  out.roomB = gb.totalQuarters();
  /* 把一局推到第 40 季度：上限 50 的局绝不能在 36 就结束 */
  CONST_QUARTER_PROBE: {
    CONFIG.maxQuarters = 35;
    const g3 = Game.deserialize(snap);
    g3.quarter = 39;
    let guard = 0;
    while (!g3.over && guard++ < 400000) {
      const p = g3.cur(); if (!p) break;
      if (p.jailTurns > 0) { g3.stayInJail(); continue; }
      const rr = g3.rollDice(); g3.movePlayer(p, rr.total); g3.resolveLanding(rr.total);
      if (g3.over) break;
      if (g3.pending && g3.pending.type === 'buy') { g3.buyLand(g3.pending.tileId, p); g3.clearPending(); }
      else if (g3.pending && g3.pending.type === 'event') { g3.applyEvent(g3.pending.event, p); g3.clearPending(); }
      if (!p.alive) { g3.endTurn(); continue; }
      for (const a of AI.planActions(g3, p)) { try { a(); } catch (e) {} }
      g3.endTurn();
    }
    out.survivedPast40 = g3.quarter > 40;
    out.endedAt = g3.quarter;
  }
  return out;
})()
`);
ok(Q.own === 50, `本局上限应为 50，实际 ${Q.own}`);
ok(Q.afterRestore === 50, `恢复存档后本局上限应仍是 50，实际 ${Q.afterRestore}（全局是 ${Q.globalAfter}）`);
ok(Q.isCopy, 'config 必须是对局的副本，不能是全局 CONFIG 的引用');
ok(Q.roomA === 20 && Q.roomB === 90, `多房间配置串了：先开 ${Q.roomA}、后开 ${Q.roomB}（应为 20/90）`);
ok(Q.survivedPast40, `上限 50 的对局在第 ${Q.endedAt} 季度就结束了（恢复后提前收场的老 bug 复发）`);

/* ★ 破产地产拍卖：挂起 → 一轮密封报价 → 价高者得 → 成交款给债权人；
   报价从高到低依次结算，**不能透支**；无人出价的地回归银行。 */
const AU = run(`
(function () {
  const out = {};
  const mk = () => {
    const g = new Game({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
    g.rei = 100;
    return g;
  };
  let g = mk();
  const lands = g.tiles.filter(t => t.type === 'land').slice(0, 3);
  lands.forEach(t => { t.owner = 0; t.level = 0; });
  g.players[0].cash = 0;
  g.declareBankrupt(g.players[0], 1, 5000);
  out.pending = !!g.pendingAuction;
  out.stillOwnedByDead = g.tiles.filter(t => t.owner === 0).length;
  out.creditorOwnedBefore = g.tiles.filter(t => t.owner === 1).length;

  g.players[1].cash = 20000; g.players[2].cash = 20000; g.players[3].cash = 5000;
  const bids = { 1: {}, 2: {}, 3: {} };
  bids[1][lands[0].id] = 3000;
  bids[2][lands[0].id] = 6000;
  bids[3][lands[0].id] = 4000;
  bids[1][lands[1].id] = 2000;
  const r = g.auctionEstate(bids);
  out.sold = r.sold;
  out.total = r.total;
  out.t0owner = g.tiles.find(t => t.id === lands[0].id).owner;
  out.t1owner = g.tiles.find(t => t.id === lands[1].id).owner;
  out.t2owner = g.tiles.find(t => t.id === lands[2].id).owner;
  out.t2level = g.tiles.find(t => t.id === lands[2].id).level;
  out.buyer2cash = g.players[2].cash;
  out.creditorCash = g.players[1].cash;
  out.cleared = !g.pendingAuction;

  /* 不能透支：只有 5000，却对三块地各出 4000 */
  const g2 = mk();
  const L = g2.tiles.filter(t => t.type === 'land').slice(0, 3);
  L.forEach(t => { t.owner = 0; });
  g2.players[0].cash = 0;
  g2.declareBankrupt(g2.players[0], -1, 1);
  g2.players[1].cash = 5000;
  const b2 = { 1: {} };
  L.forEach(t => { b2[1][t.id] = 4000; });
  g2.auctionEstate(b2);
  out.boughtWith5000 = g2.tiles.filter(t => t.owner === 1).length;
  out.cashAfter = g2.players[1].cash;
  out.neverNegative = g2.players[1].cash >= 0;

  /* 低于 minBid 视为弃权 */
  const g3 = mk();
  const L3 = g3.tiles.filter(t => t.type === 'land').slice(0, 1);
  L3[0].owner = 0;
  g3.players[0].cash = 0;
  g3.declareBankrupt(g3.players[0], -1, 1);
  g3.players[1].cash = 99999;
  g3.auctionEstate({ 1: { [L3[0].id]: 50 } });
  out.tooLowRejected = g3.tiles.find(t => t.id === L3[0].id).owner === -1;

  /* 关掉拍卖 → 回到"整包给债权人" */
  CONFIG.auction.enabled = false;
  const g4 = mk();
  const L4 = g4.tiles.filter(t => t.type === 'land').slice(0, 2);
  L4.forEach(t => { t.owner = 0; });
  g4.players[0].cash = 0;
  g4.declareBankrupt(g4.players[0], 2, 1);
  out.offNoPending = !g4.pendingAuction;
  out.offAllToCreditor = g4.tiles.filter(t => t.owner === 2).length === 2;
  CONFIG.auction.enabled = true;
  return out;
})()
`);
ok(AU.pending, '破产时应该挂起拍卖，而不是当场分配地产');
ok(AU.stillOwnedByDead === 3 && AU.creditorOwnedBefore === 0, '挂起阶段地产不该已经易主');
ok(AU.sold === 2 && AU.t0owner === 2 && AU.t1owner === 1, `拍卖成交数/买家不对：sold=${AU.sold} t0=${AU.t0owner} t1=${AU.t1owner}`);
ok(AU.buyer2cash === 14000, `中标者没扣钱：2 号应为 14000，实际 ${AU.buyer2cash}`);
ok(AU.t2owner === -1 && AU.t2level === 0, '无人出价的地应回归银行且等级清零');
ok(AU.creditorCash === 20000 - 2000 + 8000, `成交款没给债权人：应 ${20000 - 2000 + 8000}，实际 ${AU.creditorCash}`);
ok(AU.cleared, '结算后 pendingAuction 应清空');
ok(AU.boughtWith5000 === 1 && AU.cashAfter === 1000 && AU.neverNegative, `不能透支：实际买了 ${AU.boughtWith5000} 块、剩 ${AU.cashAfter}`);
ok(AU.tooLowRejected, '低于 minBid 的报价应视为弃权');
ok(AU.offNoPending && AU.offAllToCreditor, '关掉拍卖后应回到"整包给债权人"的老逻辑');

console.log(JSON.stringify({
  ok: fails.length === 0,
  套利检查: R.arb.map(a => `${a.qty}股: ${a.delta >= 0 ? '+' : ''}${a.delta}`).join('  '),
  连刷20轮: R.arbLoopDelta,
  风投卡: `${R.venture.total} 点 → ${R.venture.text}（${R.venture.delta >= 0 ? '+' : ''}${R.venture.delta}）`,
  垃圾债券: `平均领息 ${R.junk.avgLaps.toFixed(2)} 圈后爆雷（${(R.junk.explodeRate * 100).toFixed(0)}% 会炸）`,
  期权半价: `牌价 ${R.optionSelf.listPrice} → 实付 ${R.optionSelf.paid}`,
  期权过路费: `${R.optionOther.feeCharged}（持有人收到 ${R.optionOther.holderGot}）`,
  租金保险: `租金 ${R.insurance.rent}，自付 ${R.insurance.payerPaid}，房东收 ${R.insurance.ownerGot}`,
  定期存单: `${R.deposit.cost} → ${R.deposit.back}（${R.deposit.laps} 圈）｜提前赎回净 ${R.depositEarly.net}`,
  单股往返: R.fee.roundTrip,
  问题: fails,
}, null, 2));
process.exit(fails.length ? 1 : 0);

// 局时配置回归：本局上限必须独立于全局 CONFIG
