/* 数值平衡测试台 + 自动调参。
 *
 * 用法：
 *   node tools/tune.mjs --games 24                  # 只跑一次评估，打印评分卡
 *   node tools/tune.mjs --rounds 50 --games 24      # 跑 50 轮坐标下降调参，写调参记录
 *   node tools/tune.mjs --patch '{"propertyTaxRate":0.03}' --games 60
 *
 * 评分卡关心的是「一局 2 小时、跌宕起伏、有策略」这件事：
 *   结束季度、破产率、领先易手次数、冠军领先幅度、现金占比、
 *   地产开发度、股票参与度、先手优势、地产指数振幅。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const GAMES = parseInt(argOf('games', '24'), 10);
const ROUNDS = parseInt(argOf('rounds', '0'), 10);
const OUT = argOf('out', path.join(root, 'docs', '平衡调参记录.md'));
const PATCH_FILE = argOf('patch-file', '');
const PATCH = PATCH_FILE
  ? JSON.parse(fs.readFileSync(PATCH_FILE, 'utf8').replace(/^\uFEFF/, ''))   // 容忍记事本存的 BOM
  : JSON.parse(argOf('patch', '{}'));
const SEED = parseInt(argOf('seed', '12345'), 10);
/* --inject "金额:季度" 或 "金额:季度:who"，who = lead/last/0..3，默认 lead。
   例：node tools/tune.mjs --games 200 --inject "200000:18:last"  */
const INJECT = (() => {
  const raw = argOf('inject', '');
  if (!raw) return null;
  const p = String(raw).split(':');
  const amount = parseInt(p[0], 10);
  const quarter = parseInt(p[1] || '1', 10);
  const who = p[2] || 'lead';
  if (!isFinite(amount)) return null;
  return { amount, quarter, who, seat: /^\d+$/.test(who) ? parseInt(who, 10) : -1 };
})();
const VERBOSE = argv.includes('--verbose');

/* ---------------- 把游戏代码装进 Node ---------------- */
/* ★ 可复现的 Math.random。
   以前这里直接把宿主的 Math 塞进沙箱，而且 --seed 解析出来后**从未被使用**（死参数）——
   后果是每次跑分都是一套新随机数，同配置跑两遍能差 0.003，而调参器却在按 0.005
   上下的分差做取舍，等于在噪声里选参数。现在：
     ① 每个沙箱一套独立的 Math，不污染宿主；
     ② PLAY_SRC 每次开跑前重置种子 → 不同配置用的是**完全相同的骰子和卡牌序列**，
        这是配对比较，config A vs B 的差异就是纯信号，不是抽样噪声。 */
function makeMath(seed) {
  const M = {};
  for (const k of Object.getOwnPropertyNames(Math)) {
    const v = Math[k];
    M[k] = typeof v === 'function' ? v.bind(Math) : v;
  }
  let a = seed >>> 0;
  M.random = function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /* 每次评估一个配置之前重置，保证各配置面对同一串随机事件 */
  M.__reseed = function (s) { a = (s === undefined ? seed : s) >>> 0; };
  return M;
}

const codeCache = {};
function freshContext() {
  const ctx = { console, Math: makeMath(SEED), JSON, Object, Array, String, Number, Boolean, Date, isNaN, parseInt, parseFloat };
  vm.createContext(ctx);
  for (const f of ['src/data.js', 'src/engine.js', 'src/ai.js']) {
    codeCache[f] = codeCache[f] || fs.readFileSync(path.join(root, f), 'utf8');
    vm.runInContext(codeCache[f], ctx, { filename: f });
  }
  return ctx;
}
const CTX = freshContext();
vm.runInContext('var __BASE_CONFIG = JSON.parse(JSON.stringify(CONFIG));', CTX);

/* ---------------- 一局 AI 对局 + 采样 ---------------- */
const PLAY_SRC = `
(function (patch, games, INJECT) {
  Math.__reseed();                      /* ★ 每个配置都用同一串随机事件（配对比较） */
  for (var k in __BASE_CONFIG) CONFIG[k] = JSON.parse(JSON.stringify(__BASE_CONFIG[k]));
  Object.assign(CONFIG, patch);
  const rows = [];
  /* ★ 现金注入实验（--inject "座位:金额:季度[:谁]"）
     目的：回答"钱能不能买到胜利"。真人局里出现过两种极端——
       ① NFYD 给一个人发 ¥174,000，他靠囤现金夺冠（现金占比 71%）
       ② 给末位反复发钱，他照样垫底
     这里把"发钱"变成可控变量，用配对种子跑同一串随机事件，只看发钱带来的差异。
     谁 = 'any'(默认) / 'lead'(当时领先者) / 'last'(当时末位) / '0'..'3' 固定座位 */
  const inj = INJECT || null;
  for (let n = 0; n < games; n++) {
    const g = new Game({ players: [
      { name: 'A', isAI: true }, { name: 'B', isAI: true },
      { name: 'C', isAI: true }, { name: 'D', isAI: true },
    ]});
    let guard = 0, leader = -1, leadChanges = 0, prevQ = g.quarter;
    let midLeader = -1, midQ = Math.max(3, Math.round(CONFIG.maxQuarters / 2));
    let reiMin = 1e9, reiMax = -1e9, peakNet = 0, seize = 0, bankruptcies = 0, marginCalls = 0;
    let alivePrev = 4, firstElim = -1;
    let injected = false, injectSeat = -1;
    while (!g.over && guard++ < 100000) {
      /* 到指定的季度就给目标座位发一笔钱（只发一次） */
      if (inj && !injected && g.quarter >= inj.quarter) {
        injected = true;
        const alive0 = g.players.filter(q => q.alive);
        if (inj.who === 'lead' && alive0.length) {
          injectSeat = alive0.slice().sort((a, b) => g.netWorth(b) - g.netWorth(a))[0].id;
        } else if (inj.who === 'last' && alive0.length) {
          injectSeat = alive0.slice().sort((a, b) => g.netWorth(a) - g.netWorth(b))[0].id;
        } else {
          injectSeat = Math.max(0, Math.min(3, inj.seat | 0));
        }
        const tp = g.players[injectSeat];
        if (tp && tp.alive) tp.cash += inj.amount;
      }
      const p = g.cur();
      if (!p) break;
      if (p.jailTurns > 0) {
        if (AI.decideJail(g, p)) { if (!g.payJail().ok) g.stayInJail(); } else g.stayInJail();
        continue;
      }
      const r = g.rollDice();
      g.movePlayer(p, r.total);
      g.resolveLanding(r.total);
      if (g.over) break;
      if (g.pending && g.pending.type === 'buy') {
        if (AI.decideBuy(g, p)) g.buyLand(g.pending.tileId, p);
        g.clearPending();
      } else if (g.pending && g.pending.type === 'event') {
        g.applyEvent(g.pending.event, p);
        g.clearPending();
      }
      if (!p.alive) { g.endTurn(); continue; }
      const acts = AI.planActions(g, p);
      for (const a of acts) { try { a(); } catch (e) { /* 忽略单步失败 */ } }
      g.endTurn();
      /* ★ 破产拍卖：收齐全场密封报价后一次开票（引擎只负责结算，出价在 AI 里） */
      if (g.pendingAuction) { try { g.auctionEstate(AI.allAuctionBids(g)); } catch (e) { g.resolveAuctionFallback(); } }
      if (g.rei < reiMin) reiMin = g.rei;
      if (g.rei > reiMax) reiMax = g.rei;
      const aliveNow = g.alivePlayers().length;
      if (aliveNow < alivePrev) { if (firstElim < 0) firstElim = g.quarter; alivePrev = aliveNow; }
      if (g.quarter !== prevQ || g.over) {
        prevQ = g.quarter;
        const alive = g.alivePlayers();
        if (alive.length) {
          const top = alive.slice().sort((a, b) => g.netWorth(b) - g.netWorth(a))[0];
          if (leader >= 0 && top.id !== leader) leadChanges++;
          leader = top.id;
          if (midLeader < 0 && g.quarter >= midQ) midLeader = top.id;
        }
      }
    }
    const alive = g.alivePlayers();
    const nets = g.players.map(p => g.netWorth(p));
    const sorted = alive.slice().sort((a, b) => g.netWorth(b) - g.netWorth(a));
    const winnerNet = sorted.length ? g.netWorth(sorted[0]) : 0;
    const secondNet = sorted.length > 1 ? g.netWorth(sorted[1]) : 0;
    const totalNet = nets.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const totalCash = g.players.reduce((a, p) => a + Math.max(0, p.cash), 0);
    const owned = g.tiles.filter(t => t.owner >= 0 && t.type === 'land');
    const avgLevel = owned.length ? owned.reduce((a, t) => a + t.level, 0) / owned.length : 0;
    /* ★ 垄断地区数：一局里有几个地区被同一个人控住。
       之前评分卡**完全没有这个指标**，所以"垄断门槛该定多少"这件事一直没法用数据回答，
       改成 2/3 之后只能靠嘴说。真人局实测三局垄断 0 次，正是这个盲区造成的。 */
    let monoRegions = 0;
    {
      const byGroup = {};
      for (const t of g.tiles) {
        if (t.type !== 'land' || !t.group) continue;
        (byGroup[t.group] = byGroup[t.group] || []).push(t.owner);
      }
      for (const grp in byGroup) {
        for (const pid of [0, 1, 2, 3]) {
          if (byGroup[grp].some(o => o < 0)) continue;
          if (g.ownsGroup(pid, grp)) { monoRegions++; break; }
        }
      }
    }
    let holdsStock = 0;
    for (const p of g.players) {
      if (Object.values(p.stocks).some(v => v > 0)) holdsStock++;
    }
    let trades = 0, divs = 0, rents = 0, taxes = 0, rentSum = 0, taxSum = 0;
    for (const l of g.logs) {
      if (l.kind === 'trade') trades++;
      else if (l.kind === 'dividend') divs++;
      else if (l.kind === 'bad' && l.msg.indexOf('追缴') >= 0) marginCalls++;
      else if (l.msg.indexOf('物业税') >= 0) taxes++;
      if (l.msg.indexOf('强制收回') >= 0) seize++;
      /* ★ 地租经济性：收租总额 vs 物业税总额。
         之前的评分卡漏了这一项，结果 160 轮调参把税率调到 0.035，
         实测收租只有物业税的 1/3 —— 地产变成负资产，玩家退化成只炒股。
         ⚠ 这段代码处在 PLAY_SRC 模板字符串里，两条禁忌：
           ① 未识别转义会吃掉反斜杠（\d 会退化成普通的 d），所以只能写 [0-9,]；
           ② 注释里绝对不能出现反引号，会把模板字符串提前截断。 */
      let m;
      if ((m = l.msg.match(/需付租金 ¥([0-9,]+)/))) rentSum += +m[1].replace(/,/g, '');
      if ((m = l.msg.match(/缴纳物业税 ¥([0-9,]+)/))) taxSum += +m[1].replace(/,/g, '');
    }
    bankruptcies = g.players.filter(p => !p.alive).length;
    rows.push({
      quarter: Math.min(g.quarter - 1, CONFIG.maxQuarters),
      earlyEnd: g.quarter - 1 < CONFIG.maxQuarters ? 1 : 0,
      byBankruptcy: alive.length <= 1 ? 1 : 0,
      eliminated: (4 - alive.length) > 0 ? 1 : 0,
      firstElim,
      comeback: (midLeader >= 0 && sorted.length && midLeader !== g.players.indexOf(sorted[0])) ? 1 : 0,
      bankruptcies,
      leadChanges,
      reiRange: reiMax - reiMin,
      winnerNet, secondNet,
      margin: totalNet ? (winnerNet - secondNet) / (totalNet / 4) : 0,
      cashRatio: totalCash / totalNet,
      landSoldPct: g.tiles.filter(t => t.type === 'land' && t.owner >= 0).length /
                   g.tiles.filter(t => t.type === 'land').length,
      avgLevel,
      monoRegions,
      /* 注入实验的结果：被发钱的人最终赢了吗、排第几、现金占比多少 */
      injSeat: injectSeat,
      injWon: (injectSeat >= 0 && sorted.length && sorted[0].id === injectSeat) ? 1 : 0,
      injRank: (injectSeat >= 0 && sorted.length) ? (sorted.findIndex(x => x.id === injectSeat) + 1) : 0,
      injCash: (injectSeat >= 0 && g.players[injectSeat]) ? g.players[injectSeat].cash : 0,
      injNet: (injectSeat >= 0 && g.players[injectSeat]) ? g.netWorth(g.players[injectSeat]) : 0,
      stockHolders: holdsStock,
      trades, divs, rents, taxes, seize, marginCalls, rentSum, taxSum,
      winSeat: sorted.length ? g.players.indexOf(sorted[0]) : -1,
      negNet: nets.filter(v => v < 0).length,
      reiEnd: g.rei,
    });
  }
  return rows;
})(__PATCH__, __GAMES__, __INJECT__)
`;

/* ---------------- 评分卡 ---------------- */
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const band = (v, lo, hi, soft) => {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / soft);
};

function scorecard(rows) {
  const q = avg(rows.map(r => r.quarter));
  const early = avg(rows.map(r => r.earlyEnd));
  const bank = avg(rows.map(r => r.byBankruptcy));
  const lead = avg(rows.map(r => r.leadChanges));
  const capGames = rows.filter(r => !r.earlyEnd);
  /* 冠军领先幅度只在"打满季度"的对局里算；提前打崩对手本身就是好事 */
  const margin = capGames.length ? avg(capGames.map(r => Math.abs(r.margin))) : 0.2;
  const cash = avg(rows.map(r => r.cashRatio));
  const land = avg(rows.map(r => r.landSoldPct));
  const lvl = avg(rows.map(r => r.avgLevel));
  const rei = avg(rows.map(r => r.reiRange));
  const hold = avg(rows.map(r => r.stockHolders));
  const trades = avg(rows.map(r => r.trades));
  const neg = avg(rows.map(r => r.negNet));
  const taxes = avg(rows.map(r => r.taxes));
  const marginCalls = avg(rows.map(r => r.marginCalls));
  const seize = avg(rows.map(r => r.seize));
  const seatWins = [0, 0, 0, 0];
  for (const r of rows) if (r.winSeat >= 0) seatWins[r.winSeat]++;
  const seatSpread = (Math.max(...seatWins) - Math.min(...seatWins)) / rows.length;
  const elimRate = avg(rows.map(r => r.eliminated));
  const firstElim = avg(rows.filter(r => r.firstElim > 0).map(r => r.firstElim));
  /* 地租经济性：全场收租总额 ÷ 物业税总额。低于 1 = 持有地产净亏损。 */
  const rentTot = rows.reduce((a, r) => a + (r.rentSum || 0), 0);
  const taxTot = rows.reduce((a, r) => a + (r.taxSum || 0), 0);
  const rentEcon = taxTot > 0 ? rentTot / taxTot : 0;

  /* 目标：一局 2 小时（约 50 个季度）、中途就有人被打崩、领先反复易手、
     不囤现金、地产开发到中后期、指数有振幅、股票有人玩、先手不明显占优 */
  const S = {
    length:   band(q, 38, 54, 18),          // 一局够长 ≈ 2 小时
    endsHard: band(early, 0.20, 0.70, 0.35),// 有相当比例是"提前打崩"收场
    danger:   band(elimRate, 0.45, 0.95, 0.4),   // 大部分对局真的会死人
    dangerAt: band(firstElim, 26, 46, 16),       // 而且死在中期，不是最后一天才倒
    swings:   band(lead, 6, 40, 6),         // 领先易手次数 → 跌宕起伏
    comeback: band(avg(rows.map(r => r.comeback)), 0.35, 0.78, 0.35), // 中途领先的人未必笑到最后
    close:    band(margin, 0.05, 0.70, 0.55), // 冠军赢得不轻松
    noHoard:  band(cash, 0.05, 0.35, 0.25), // 现金不会无脑堆着
    built:    band(lvl, 3.0, 4.4, 1.3),     // 中后期楼盖起来了
    landUse:  band(land, 0.72, 1.0, 0.4),   // 地得有人买，不然棋盘是空的
    market:   band(rei, 60, 400, 35),       // 地产指数有振幅
    stocks:   band(hold, 2.5, 4, 1.5),      // 大家都碰股票
    trading:  band(trades, 15, 300, 30),    // 股票交易得真的在发生
    leverage: band(marginCalls + seize, 0.5, 5, 1.6), // 加杠杆遇崩盘要真的会爆仓
    seatFair: band(seatSpread, 0, 0.15, 0.2),
    noDebtTrap: band(neg, 0, 0.5, 1.2),
    /* ★ 新增：持有地产必须有利可图，否则地租再热闹也只是负资产。
       目标区间 2.0~4.5 倍（收租 ÷ 物业税）。低于 1 就是"囤地给银行打工"。 */
    rentEcon: band(rentEcon, 2.0, 4.5, 1.0),
  };
  const W = { length: 1.5, endsHard: 0.8, danger: 1.3, dangerAt: 1.3, swings: 1.5, comeback: 1.4,
              close: 1.0, noHoard: 1.1, built: 0.9, landUse: 1.2, market: 1.2, stocks: 1.0,
              trading: 0.8, leverage: 1.0, seatFair: 0.7, noDebtTrap: 0.6, rentEcon: 1.6 };
  let num = 0, den = 0;
  for (const k in S) { num += S[k] * W[k]; den += W[k]; }

  return {
    score: +(num / den).toFixed(4),
    parts: S,
    m: {
      结束季度: +q.toFixed(1), 提前收场占比: +early.toFixed(2), 破产人数: +avg(rows.map(r => r.bankruptcies)).toFixed(2),
      有淘汰占比: +elimRate.toFixed(2), 首次淘汰季度: +firstElim.toFixed(1),
      领先易手: +lead.toFixed(1), 反超夺冠率: +avg(rows.map(r => r.comeback)).toFixed(2),
      冠军领先幅度: +margin.toFixed(2), 现金占比: +cash.toFixed(2),
      地产售出率: +land.toFixed(2), 平均等级: +lvl.toFixed(2), 指数振幅: +rei.toFixed(0),
      /* ★ 新增指标：一局平均有几个地区被垄断。用来回答"垄断门槛该定多少"。
         注意它目前**只出现在 m 里、没有进评分卡**（怕直接调权会带偏其它指标），
         先用它做 A/B 观察，确认合适了再决定要不要给它权重。 */
      垄断地区: +avg(rows.map(r => r.monoRegions)).toFixed(2),
      /* ★ 注入实验专用：被发钱的人最终夺冠率 / 平均名次 / 结束时现金占比。
         不发钱时这些是 0，看的时候注意区分（injSeat < 0 的行不算）。 */
      注入者夺冠率: +(rows.filter(r => r.injSeat >= 0).length
        ? rows.filter(r => r.injSeat >= 0 && r.injWon).length / rows.filter(r => r.injSeat >= 0).length : 0).toFixed(2),
      注入者平均名次: +(rows.filter(r => r.injSeat >= 0).length
        ? avg(rows.filter(r => r.injSeat >= 0).map(r => r.injRank)) : 0).toFixed(2),
      注入者现金: +avg(rows.filter(r => r.injSeat >= 0).map(r => r.injCash)).toFixed(0),
      持股人数: +hold.toFixed(1), 交易次数: +trades.toFixed(1), 物业税笔数: +taxes.toFixed(1),
      追缴次数: +marginCalls.toFixed(2), 强制收回: +seize.toFixed(2), 负资产人数: +neg.toFixed(2),
      先手差距: +seatSpread.toFixed(2), 期末指数: +avg(rows.map(r => r.reiEnd)).toFixed(0),
      收租除以物业税: +rentEcon.toFixed(2),
    },
  };
}

function evaluate(patch, games) {
  const src = PLAY_SRC.replace('__PATCH__', JSON.stringify(patch))
    .replace('__GAMES__', String(games))
    .replace('__INJECT__', JSON.stringify(INJECT));
  const rows = vm.runInContext(src, CTX, { filename: 'play' });
  return scorecard(rows);
}

/* ---------------- 坐标下降搜索 ---------------- */
const PARAMS = [
  { key: 'propertyTaxRate',   vals: [0.018, 0.025, 0.035, 0.05, 0.07] },
  { key: 'startingCash',      vals: [20000, 25000, 30000, 40000] },
  { key: 'salary',            vals: [1800, 2200, 2500, 3000] },
  { key: 'rentRate',          vals: [
      [0, 0.12, 0.30, 0.55, 0.90, 1.45],
      [0, 0.12, 0.33, 0.62, 1.05, 1.75],
      [0, 0.13, 0.36, 0.70, 1.20, 2.00],
  ] },
  { key: 'levelValue+upgradeCostRate', vals: [
      [[0, 1, 1.5, 2.1, 2.9, 3.9], [0, 0, 0.5, 0.6, 0.8, 1.0]],
      [[0, 1, 1.65, 2.45, 3.45, 4.7], [0, 0, 0.65, 0.8, 1.0, 1.25]],
      [[0, 1, 1.8, 2.8, 4.1, 5.7], [0, 0, 0.8, 1.0, 1.3, 1.6]],
  ] },
  { key: 'reiCycleAmp',       vals: [18, 24, 30, 38, 46] },
  { key: 'reiQuarterNoise',   vals: [5, 8, 12] },
  { key: 'reiRegression',     vals: [0.04, 0.07, 0.11] },
  { key: 'reiScarcityBonus',  vals: [10, 22, 35] },
  { key: 'mortgageLtv',       vals: [0.40, 0.50, 0.60] },
  { key: 'marginCallRatio',   vals: [1.10, 1.20, 1.35] },
  { key: 'sellToBankRate',    vals: [0.70, 0.85, 0.95] },
  { key: 'incomeTaxRate',     vals: [0.08, 0.10, 0.14] },
  { key: 'luxuryTax',         vals: [1500, 2000, 3000] },
  { key: 'railRent',          vals: [[0, 200, 400, 800, 1600], [0, 250, 500, 1000, 2000], [0, 300, 600, 1200, 2400]] },
  { key: 'utilityRentPerPip', vals: [120, 150, 200] },
  { key: 'groupRentBonus',    vals: [1.4, 1.5, 1.7] },
];

function applyValues(patch, p, v) {
  const next = Object.assign({}, patch);
  const keys = p.key.split('+');
  if (keys.length === 1) next[keys[0]] = v;
  else keys.forEach((k, i) => { next[k] = v[i]; });
  return next;
}

function search(rounds, games) {
  const cur = Object.assign({}, PATCH);
  let best = evaluate(cur, games);
  const log = [];
  let round = 0;
  log.push({ round: 0, param: '(初始默认值)', value: '-', score: best.score, m: best.m });

  for (let pass = 0; pass < 3 && round < rounds; pass++) {
    for (const p of PARAMS) {
      if (round >= rounds) break;
      let localBest = { score: best.score, patch: null };
      for (const v of p.vals) {
        if (round >= rounds) break;
        const trial = applyValues(cur, p, v);
        if (JSON.stringify(trial) === JSON.stringify(cur)) continue;
        round++;
        const r = evaluate(trial, games);
        log.push({ round, param: p.key, value: JSON.stringify(v), score: r.score, m: r.m });
        if (VERBOSE) console.log(`R${round} ${p.key}=${JSON.stringify(v)} → ${r.score}`);
        if (r.score > localBest.score) localBest = { score: r.score, m: r.m, patch: trial };
      }
      if (localBest.patch) { Object.assign(cur, localBest.patch); best = { score: localBest.score, m: localBest.m, parts: null }; }
    }
  }
  return { cur, best, log };
}

/* ---------------- 入口 ---------------- */
if (ROUNDS > 0) {
  console.log(`开始调参：最多 ${ROUNDS} 轮，每轮 ${GAMES} 局…`);
  const t0 = Date.now();
  const { cur, best, log } = search(ROUNDS, GAMES);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const lines = [];
  lines.push('# 数值平衡调参记录');
  lines.push('');
  lines.push(`自动调参：每轮 ${GAMES} 局四人 AI 对局，坐标下降，共 ${log.length - 1} 次评估，耗时 ${secs} 秒。`);
  lines.push('');
  lines.push('## 每轮结果');
  lines.push('');
  lines.push('| 轮次 | 调整参数 | 取值 | 综合得分 | 结束季度 | 有淘汰 | 首次淘汰 | 领先易手 | 反超夺冠 | 冠军领先 | 现金占比 | 平均等级 | 指数振幅 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const l of log) {
    const m = l.m;
    lines.push(`| ${l.round} | ${l.param} | ${l.value} | **${l.score}** | ${m.结束季度} | ${m.有淘汰占比} | ${m.首次淘汰季度} | ${m.领先易手} | ${m.反超夺冠率} | ${m.冠军领先幅度} | ${m.现金占比} | ${m.平均等级} | ${m.指数振幅} |`);
  }
  lines.push('');
  lines.push('## 最终参数');
  lines.push('```json');
  lines.push(JSON.stringify(cur, null, 2));
  lines.push('```');
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  if (argOf('save', '')) fs.writeFileSync(argOf('save', ''), JSON.stringify(cur, null, 2), 'utf8');
  console.log(`完成，用时 ${secs}s，最佳得分 ${best.score}`);
  console.log('最终参数：' + JSON.stringify(cur));
  console.log('记录已写入 ' + OUT);
} else {
  const r = evaluate(PATCH, GAMES);
  console.log(JSON.stringify(r, null, 2));
}
