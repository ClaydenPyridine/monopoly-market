/* 地租/物业税参数扫描：找出"持有地产能赚钱、同时不破坏其它指标"的数值。
 *
 * 用法：node tools/rent-sweep.mjs [每个候选跑几局，默认 60]
 *
 * 做法：每换一组参数就重建一个干净的 vm 上下文（CONFIG 是可变对象），
 * 跑 N 局 AI 对局，统计收租/物业税、以及会不会把别的指标搞坏。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = parseInt(process.argv[2] || '60', 10);

function freshCtx() {
  const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, isNaN, parseInt, parseFloat };
  vm.createContext(ctx);
  for (const f of ['src/data.js', 'src/engine.js', 'src/ai.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

function runGames(ctx, n) {
  const Game = vm.runInContext('Game', ctx);
  const AI = vm.runInContext('AI', ctx);
  const CONFIG = vm.runInContext('CONFIG', ctx);
  const acc = { rent: 0, tax: 0, q: 0, lvlSum: 0, lvlN: 0, elim: 0, bank: 0, endEarly: 0, reiRange: 0, games: n };

  for (let k = 0; k < n; k++) {
    const g = new Game({ players: [0, 1, 2, 3].map(i => ({ name: 'P' + i, isAI: true })) });
    let guard = 0;
    let reiMin = g.rei, reiMax = g.rei;
    while (!g.over && guard++ < 60000) {
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
        const t = g.tile(g.pending.tileId);
        if (AI.decideBuy(g, p)) g.buyLand(t.id, p);
        else g.log(`${p.name} 放弃购买 ${t.name}`, 'info');
        g.clearPending();
      } else if (g.pending && g.pending.type === 'event') {
        g.applyEvent(g.pending.event, p); g.clearPending();
      }
      if (!p.alive) { g.endTurn(); continue; }
      for (const a of AI.planActions(g, p)) a();
      g.endTurn();
      reiMin = Math.min(reiMin, g.rei); reiMax = Math.max(reiMax, g.rei);
    }
    for (const l of g.logs) {
      let m;
      if ((m = l.msg.match(/需付租金 ¥([\d,]+)/))) acc.rent += +m[1].replace(/,/g, '');
      if ((m = l.msg.match(/缴纳物业税 ¥([\d,]+)/))) acc.tax += +m[1].replace(/,/g, '');
    }
    const owned = g.tiles.filter(t => t.owner >= 0);
    acc.lvlSum += owned.reduce((a, t) => a + t.level, 0) / Math.max(1, owned.length);
    acc.lvlN++;
    acc.q += g.quarter;
    acc.bank += g.players.filter(p => !p.alive).length;
    acc.reiRange += (reiMax - reiMin);
  }
  acc.rentPerQ = acc.rent / acc.q;
  acc.taxPerQ = acc.tax / acc.q;
  acc.ratio = acc.taxPerQ ? acc.rentPerQ / acc.taxPerQ : Infinity;
  acc.avgQ = acc.q / n;
  acc.avgLv = acc.lvlSum / acc.lvlN;
  acc.avgBank = acc.bank / n;
  acc.avgRei = acc.reiRange / n;
  return acc;
}

/* 候选：物业税税率 × 租金率整体倍数 */
const RENT_BASE = [0, 0.12, 0.33, 0.62, 1.05, 1.75];
const CANDS = [
  { tax: 0.035, mul: 1.00, tag: '现状' },
  { tax: 0.025, mul: 1.50, tag: '温和' },
  { tax: 0.018, mul: 1.80, tag: '中' },
  { tax: 0.012, mul: 2.00, tag: '中强' },
  { tax: 0.010, mul: 2.30, tag: '强' },
  { tax: 0.007, mul: 2.60, tag: '激进' },
];

console.log('');
console.log('  物业税率  租金倍数   收租/季   税/季   收租÷税   平均等级   平均破产   指数振幅   平均季度');
console.log('  ' + '─'.repeat(88));
const results = [];
for (const c of CANDS) {
  const ctx = freshCtx();
  const CONFIG = vm.runInContext('CONFIG', ctx);
  CONFIG.propertyTaxRate = c.tax;
  CONFIG.rentRate = RENT_BASE.map(x => +(x * c.mul).toFixed(3));
  const r = runGames(ctx, GAMES);
  results.push({ ...c, ...r });
  console.log(`  ${c.tax.toFixed(3).padStart(7)}  ×${c.mul.toFixed(2).padStart(5)}   ` +
    `${('¥' + Math.round(r.rentPerQ)).padStart(8)} ${('¥' + Math.round(r.taxPerQ)).padStart(8)}   ` +
    `${r.ratio.toFixed(2).padStart(6)}   ${r.avgLv.toFixed(2).padStart(7)}   ${r.avgBank.toFixed(2).padStart(7)}   ` +
    `${r.avgRei.toFixed(0).padStart(7)}   ${r.avgQ.toFixed(1).padStart(8)}   ${c.tag}`);
}
console.log('');
const good = results.filter(r => r.ratio >= 2.0 && r.ratio <= 4.5 && r.avgBank >= 0.4 && r.avgQ >= 38 && r.avgLv >= 2.6);
if (good.length) {
  console.log('  ✓ 落在"地产有利可图且其它指标没垮"区间的候选：');
  good.forEach(r => console.log(`    物业税 ${r.tax} × 租金 ${r.mul}  → 收租/税 = ${r.ratio.toFixed(2)}，平均等级 ${r.avgLv.toFixed(2)}，平均破产 ${r.avgBank.toFixed(2)}`));
} else {
  console.log('  ⚠ 没有候选同时满足所有条件，需要更细的扫描或配合改别的参数。');
}
console.log('');
