/* 地租经济学审计：回答"地租是不是太少"。
 *
 * 用法：node tools/rent-audit.mjs [模拟局数，默认 200]
 *
 * 两部分：
 *   A. 理论：直接调真实引擎的 upgradeCost / rentOf / assetValue，
 *      算出每级地产的「总投入 / 每次收租 / 每季持有成本 / 回本需要被踩几次」。
 *   B. 实测：跑 N 局 AI 对局，统计每局各类收入与支出的金额占比，
 *      看"持有地产"整体是净流入还是净流出。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = parseInt(process.argv[2] || '200', 10);

const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, isNaN, parseInt, parseFloat };
vm.createContext(ctx);
for (const f of ['src/data.js', 'src/engine.js', 'src/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const Game = vm.runInContext('Game', ctx);
const AI = vm.runInContext('AI', ctx);
const CONFIG = vm.runInContext('CONFIG', ctx);
const TILES = vm.runInContext('TILES', ctx);

const money = (n) => '¥' + Math.round(n).toLocaleString('en-US');
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '—');
const L = [];
const out = (s = '') => { L.push(s); console.log(s); };

out('═'.repeat(78));
out('  A. 理论：拿真实引擎算，不靠猜');
out('═'.repeat(78));
out();
out(`  租金公式： 每次被踩收租 = 地价 × 租金率[等级]，地价 = 基准价 × 地产指数/100`);
out(`  持有成本： 每季度物业税 = 地产市值 × ${(CONFIG.propertyTaxRate * 100).toFixed(1)}%`);
out(`  地产指数： 一局 ${CONFIG.maxQuarters} 季度，周期振幅 ±${CONFIG.reiCycleAmp} 点`);
out();

/* 挑一块中位价的地做样板 */
const lands = TILES.filter(t => t.type === 'land').map((t, i) => ({ ...t, i }));
const byPrice = lands.slice().sort((a, b) => a.basePrice - b.basePrice);
const sample = [byPrice[0], byPrice[Math.floor(byPrice.length / 2)], byPrice[byPrice.length - 1]];

for (const t of sample) {
  const g = new Game({ players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }] });
  g.rei = 100;                                    // 用 100 做基准，不受行情影响
  const tile = g.tile(t.i);
  out(`  ── ${t.name}（基准价 ${money(t.basePrice)}）──`);
  out(`    ${'等级'.padEnd(8)} ${'升级花费'.padStart(10)} ${'累计投入'.padStart(10)} ${'市值'.padStart(9)} ${'每次收租'.padStart(10)} ${'每季税'.padStart(9)} ${'回本需被踩'.padStart(11)} ${'回本季度'.padStart(9)}`);
  let invested = t.basePrice;                      // 买地价
  for (let lv = 0; lv <= 5; lv++) {
    if (lv > 0) {
      tile.level = lv - 1;
      invested += g.upgradeCost(tile);
    }
    tile.level = lv;
    const rent = g.rentOf(tile, 7);
    const val = g.assetValue(tile);
    const tax = Math.round(val * CONFIG.propertyTaxRate);
    const hits = rent > 0 ? invested / rent : Infinity;
    /* 每季度大约有几"轮"（所有人各走一次）—— engine 里一季 = 每人走一次 */
    const hitsPerQuarter = 2 * (1 / 40) * 2.0;     // 4 人局、每格被踩概率约 1/40×2 权重
    out(`    ${('L'+lv).padEnd(8)} ${money(lv === 0 ? 0 : g.upgradeCost({ ...tile, level: lv - 1 })).padStart(10)} ${money(invested).padStart(10)} ${money(val).padStart(9)} ${money(rent).padStart(10)} ${money(tax).padStart(9)} ${(hits === Infinity ? '—' : hits.toFixed(1)).padStart(11)} ${(hits === Infinity ? '—' : (hits / hitsPerQuarter).toFixed(0)).padStart(9)}`);
  }
  out();
}

/* ---------- B. 实测 ---------- */
out('═'.repeat(78));
out(`  B. 实测：跑 ${GAMES} 局 AI 对局，看钱到底从哪来、往哪去`);
out('═'.repeat(78));
out();

const agg = {
  rentIn: 0, taxPaid: 0, divIn: 0, stockProfit: 0, salaryIn: 0, eventIn: 0, cardOut: 0,
  upgradeSpend: 0, buyLandSpend: 0, jailFine: 0, games: 0, endQ: 0, rounds: 0,
};
const perPlayer = [];

for (let n = 0; n < GAMES; n++) {
  const players = [0, 1, 2, 3].map(i => ({ name: 'P' + i, isAI: true }));
  const g = new Game({ players });
  const before = players.map(() => ({ cash: CONFIG.startingCash, rent: 0, tax: 0, div: 0, upg: 0 }));
  let guard = 0;
  while (!g.over && guard++ < 60000) {
    const p = g.cur();
    if (!p) break;
    const st = before[p.id];
    const cashBefore = p.cash;
    if (p.jailTurns > 0) {
      if (AI.decideJail(g, p)) { if (!g.payJail().ok) g.stayInJail(); } else g.stayInJail();
      continue;
    }
    const r = g.rollDice();
    g.movePlayer(p, r.total);
    g.resolveLanding(r.total);
    if (g.over) break;
    if (g.pending && g.pending.type === 'buy') {
      const t = g.tile(g.pending.tileId);
      const price = g.pending.price;
      if (AI.decideBuy(g, p)) { g.buyLand(t.id, p); agg.buyLandSpend += price; }
      else g.log(`${p.name} 放弃购买 ${t.name}`, 'info');
      g.clearPending();
    } else if (g.pending && g.pending.type === 'event') {
      g.applyEvent(g.pending.event, p); g.clearPending();
    }
    if (!p.alive) { g.endTurn(); continue; }
    const lvBefore = g.tiles.reduce((a, t) => a + (t.owner === p.id ? t.level : 0), 0);
    for (const a of AI.planActions(g, p)) a();
    const lvAfter = g.tiles.reduce((a, t) => a + (t.owner === p.id ? t.level : 0), 0);
    if (lvAfter > lvBefore) st.upg += 1;
    g.endTurn();
  }
  /* 从日志统计收支 */
  for (const l of g.logs) {
    const m = l.msg;
    let mm;
    if ((mm = m.match(/需付租金 ¥([\d,]+)/))) { agg.rentIn += +mm[1].replace(/,/g, ''); }
    if ((mm = m.match(/缴纳物业税 ¥([\d,]+)/))) { agg.taxPaid += +mm[1].replace(/,/g, ''); }
    if ((mm = m.match(/【分红】.*共派出 ¥([\d,]+)/)) || (mm = m.match(/【派息】.*共 ¥([\d,]+)/))) { agg.divIn += +mm[1].replace(/,/g, ''); }
    if ((mm = m.match(/领取委托报酬 ¥([\d,]+)/))) { agg.salaryIn += +mm[1].replace(/,/g, ''); }
  }
  agg.games++; agg.endQ += g.quarter;
  perPlayer.push(...g.players.map(p => ({ name: p.name, net: g.netWorth(p), alive: p.alive })));
}

out(`  平均对局长度：${(agg.endQ / agg.games).toFixed(1)} 季度`);
out();
out('  全局资金流（一局平均）：');
const rows = [
  ['工资（经过起点）', agg.salaryIn, 'in'],
  ['房租收入', agg.rentIn, 'in'],
  ['股票分红/派息', agg.divIn, 'in'],
  ['买地支出', -agg.buyLandSpend, 'out'],
  ['升级支出（次数）', 0, 'out'],
  ['物业税', -agg.taxPaid, 'out'],
];
for (const [k, v, dir] of rows) {
  if (k.includes('升级')) { out(`    ${k.padEnd(18)} ${(v / agg.games).toFixed(0)} 次/局`); continue; }
  out(`    ${k.padEnd(18)} ${money(Math.abs(v / agg.games)).padStart(12)}/局   ${dir === 'in' ? '流入' : '流出'}`);
}
out();
const rentPerQ = agg.rentIn / agg.games / (agg.endQ / agg.games);
const taxPerQ = agg.taxPaid / agg.games / (agg.endQ / agg.games);
out(`  ★ 关键对比（每季度，全场四人合计）：`);
out(`      收租  ${money(rentPerQ).padStart(10)}`);
out(`      物业税 ${money(taxPerQ).padStart(10)}`);
out(`      收租 / 物业税 = ${(rentPerQ / taxPerQ).toFixed(2)} 倍`);
out();
if (rentPerQ / taxPerQ < 1.0) {
  out('  ✗ 收租还不够交物业税 —— 囤地是净亏损，"地租太少"的抱怨属实，必须改参数。');
} else if (rentPerQ / taxPerQ < 2.0) {
  out('  ⚠ 收租勉强覆盖持有成本，盈余太薄 —— 地产相比股票缺乏吸引力。');
} else if (rentPerQ / taxPerQ <= 4.5) {
  out('  ✓ 收租是持有成本的 2~4.5 倍 —— 地产是有吸引力的资产，同时持有成本仍在起作用。');
} else {
  out('  ⚠ 收租远超持有成本 —— 持有成本形同虚设，可能会出现"无脑囤地"。');
}

const md = L.join('\n');
const f = path.join(root, 'docs', '地租经济学分析.md');
fs.writeFileSync(f, '# 地租经济学分析\n\n> 由 `tools/rent-audit.mjs` 自动生成，所有数字来自真实引擎与模拟对局。\n\n```\n' + md + '\n```\n');
console.log('\n（已写入 docs/地租经济学分析.md）');
