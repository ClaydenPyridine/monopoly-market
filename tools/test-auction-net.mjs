/* 破产拍卖的真·联机端到端验证。
 * 关键点：只有服务端全程走一遍，才能确认"窗口开了、票收了、无条件结算了"。
 * 用法：node tools/test-auction-net.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const problems = [];
const ok = (c, m) => { if (!c) problems.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const post = async (p, body) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json();
const game = async (room, tok) => {
  const r = await fetch(`${BASE}/api/state?room=${room}&token=${encodeURIComponent(tok)}`);
  const j = await r.json();
  try { return JSON.parse(j.state.game); } catch { return null; }
};
const waitFor = async (fn, ms = 12000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    let v = null; try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
};

const srv = spawn(process.execPath, ['server.mjs', String(PORT)], {
  cwd: root,
  env: Object.assign({}, process.env, {
    DGS_T_ROLL: '45', DGS_T_TRADE: '45', DGS_GRACE: '90000', DGS_AI_DELAY: '30',
  }),
  stdio: 'ignore',
});
let ready = false;
for (let i = 0; i < 75; i++) {
  try { if ((await fetch(BASE + '/api/rooms')).ok) { ready = true; break; } } catch {}
  await sleep(200);
}
if (!ready) {
  srv.kill();
  console.log(JSON.stringify({ ok: false, 问题: [`服务端没能在 ${PORT} 起来`] }, null, 2));
  process.exit(1);
}

try {
  /* 1 个人 + 3 个电脑：这样"所有人都交票"= 我交了，能立刻结算，不用等 25 秒窗口 */
  const me = await post('/api/create', { name: '甲' });
  ok(me.ok, '建房失败');
  /* 起始现金压到最低，让破产更容易在几十个回合内出现 */
  await post('/api/start', { room: me.room, token: me.token, players: 4, quarters: 60, cash: 5000 });
  await sleep(500);

  let g = await game(me.room, me.token);
  ok(!!g, '开局后读不到对局');
  ok(g.players[0].name === '甲', '座位不对');

  /* ★ 用 admin/bankrupt 确定性触发破产 —— 早先是"一直推进直到有人破产"，
     实测跑了 545 轮、Q61 都没人出局，测试时红时绿，不可靠。
     先让甲买一块地（这样有资产可拍），再强制一个电脑出局。 */
  const drive = async (onBuy) => {
    const p = g.players[g.current];
    if (!p || p.name !== '甲' || p.isAI) return false;
    if (g.phase === 'awaiting-roll') await post('/api/action', { room: me.room, token: me.token, action: 'roll' });
    else if (g.phase === 'awaiting-buy') await post('/api/action', { room: me.room, token: me.token, action: onBuy });
    else if (g.phase === 'awaiting-event') await post('/api/action', { room: me.room, token: me.token, action: 'eventAck' });
    else if (g.phase === 'awaiting-jail') await post('/api/action', { room: me.room, token: me.token, action: 'payJail' });
    else if (g.phase === 'awaiting-trade') {
      await post('/api/action', { room: me.room, token: me.token, action: 'endTurn' });
    }
    return true;
  };
  /* ★ 两个条件都要满足：① 甲有地（后面要靠他竞拍）② **有人（电脑）有地**。
     早先只等 ①，被强制出局的人常常名下一块地都没有，
     而引擎的设计是"无地就不挂拍卖"（engine.js 里 lots.length 判断），于是拍卖永远不出现。 */
  const bothReady = gg => gg.tiles.some(t => t.owner === 0 && t.type === 'land')
    && gg.tiles.some(t => t.owner > 0 && t.type === 'land');
  let guard = 0;
  while (!bothReady(g) && guard++ < 250) {
    await drive('buy');
    await sleep(150);
    g = (await game(me.room, me.token)) || g;
    if (g.over) break;
  }
  ok(g.tiles.some(t => t.owner === 0 && t.type === 'land'), '甲没能买到地（后面要靠他竞拍）');
  ok(g.tiles.some(t => t.owner > 0 && t.type === 'land'), '跑了 ' + guard + ' 轮仍没有电脑持有地块（没有可拍标的）');

  /* 强制一个电脑出局 → 它的地产进入拍卖 */
  const victim = g.players.find(p => p.id !== 0 && p.alive);
  /* 优先挑"名下有地"的电脑，否则拍卖没有标的 */
  const withLand = g.players.filter(p => p.id !== 0 && p.alive && g.tiles.some(t => t.owner === p.id));
  const target = withLand[0];
  ok(!!target, '没有"名下有地"的电脑可以强制出局（拍卖就没有标的）');
  ok(!!target, '没有可供强制出局的电脑');
  const kb = await post('/api/admin/bankrupt', { room: me.room, name: target.name });
  ok(kb.ok, '强制出局失败：' + JSON.stringify(kb));

  let seenAuction = null;
  for (let i = 0; i < 40 && !seenAuction; i++) {
    await sleep(200);
    g = (await game(me.room, me.token)) || g;
    if (g.pendingAuction) seenAuction = g.pendingAuction;
  }
  ok(!!seenAuction, '强制出局后拍卖没有挂起（第 ' + g.quarter + ' 季度）');
  if (!seenAuction) throw new Error('没有拍卖可测，后续断言无法进行');

  const lots = g.tiles.filter(t => t.owner === seenAuction.deadId);
  ok(lots.length > 0, '挂起拍卖但出局者名下没有地块');
  ok(seenAuction.deadId !== 0, '破产的居然是本人（那我没法竞拍自己的资产，换个断言）');

  /* ★ 必须等"窗口真的开了"再出价。
     pendingAuction 挂起和窗口开启之间隔着一次看门狗扫描（最多 500ms），
     空窗期出价会被服务端拒成"还没开始收票"—— 上一版测试就是在这里假绿的
     （超现金出价"被拒"了，但拒绝理由是错的）。 */
  const opened = await waitFor(async () => {
    const r = await fetch(`${BASE}/api/state?room=${me.room}&token=${encodeURIComponent(me.token)}`);
    const j = await r.json();
    return (j.state && j.state.auction && j.state.auction.open) ? j.state.auction : null;
  }, 8000);
  ok(!!opened, '拍卖挂起了但 8 秒内都没开收票窗口');
  ok(opened && opened.deadline > Date.now(), '开窗后 deadline 不合法');

  /* ★ 先给自己灌足现金再出必胜价。
     早先是"按市值出价"，结果 AI 出得更高、地被 AI 拍走，测试于是在"中标后地块没归我"
     这条上时红时绿 —— **测试假设了我会赢，那是假设不是事实**。
     要断言"中标流程正确"，就得先保证自己一定是最高价。 */
  await post('/api/admin/pay', { room: me.room, name: '甲', amount: 200000 });
  await sleep(300);
  g = (await game(me.room, me.token)) || g;
  const myCash = Math.round(g.players[0].cash);
  const bidTile = lots[0];
  const price = Math.min(myCash, Math.max(1000, Math.round(bidTile.basePrice * g.rei / 100) * 10));

  /* 非法：出价超过现金 → 必须被拒，而且**理由必须是超现金**（不能是因为窗口没开） */
  const tooHigh = await post('/api/action', {
    room: me.room, token: me.token, action: 'bidAuction',
    payload: { bids: { [bidTile.id]: myCash + 999999 } },
  });
  ok(!tooHigh.ok, '出价超过现金居然被接受了');
  ok(!/还没开始收票/.test(tooHigh.msg || ''), '出价被拒的理由是"窗口没开"，说明窗口状态没暴露对：' + tooHigh.msg);

  /* 正常提交 */
  const r = await post('/api/action', {
    room: me.room, token: me.token, action: 'bidAuction',
    payload: { bids: { [bidTile.id]: price } },
  });
  ok(r.ok, '正常出价被拒：' + JSON.stringify(r));

  /* 密封报价不能改 */
  const again = await post('/api/action', {
    room: me.room, token: me.token, action: 'bidAuction',
    payload: { bids: { [bidTile.id]: price + 100 } },
  });
  ok(!again.ok, '重复出价居然被接受了（密封报价应按只交一次）');

  /* 全场只有我一个真人 → 交完票应立刻结算 */
  const resolved = await waitFor(async () => {
    const gg = await game(me.room, me.token);
    return (gg && !gg.pendingAuction) ? gg : null;
  }, 8000);
  ok(!!resolved, '交完票后拍卖没有结算（pendingAuction 一直挂着 → 客户端弹窗永远不关）');
  if (resolved) {
    const t = resolved.tiles.find(x => x.id === bidTile.id);
    ok(t && t.owner === 0, `中标后地块没归我：owner=${t && t.owner}`);
    ok(Math.round(resolved.players[0].cash) === myCash - price, `没扣钱：${myCash} → ${resolved.players[0].cash}（应扣 ${price}）`);
    ok(t && t.mortgaged === false, '中标后地块仍处于抵押状态');
  }

} catch (e) {
  problems.push('抛异常：' + (e && e.stack || e));
} finally {
  srv.kill();
}
console.log(JSON.stringify({ ok: problems.length === 0, 问题: problems }, null, 2));
process.exit(problems.length ? 1 : 0);
