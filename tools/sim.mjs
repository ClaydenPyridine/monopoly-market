/* 无头模拟：把引擎和 AI 拉进 Node 里跑完整对局，用来验证规则和数值。
 * 用法：node tools/sim.mjs [局数]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, isNaN, parseInt, parseFloat };
vm.createContext(ctx);
for (const f of ['src/data.js', 'src/engine.js', 'src/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}

const GAMES = parseInt(process.argv[2] || '200', 10);
ctx.GAMES = GAMES;

const code = `
(function (GAMES) {
  const stats = { wins: {}, bankrupt: 0, reiEnd: [], quarters: [], trades: 0, dividends: 0, rents: 0, errors: [] };
  for (let n = 0; n < GAMES; n++) {
    const g = new Game({ players: [
      { name: 'A', isAI: true }, { name: 'B', isAI: true },
      { name: 'C', isAI: true }, { name: 'D', isAI: true },
    ]});
    let guard = 0;
    while (!g.over && guard++ < 20000) {
      const p = g.cur();
      if (!p) break;
      if (p.jailTurns > 0) {
        if (AI.decideJail(g, p)) { if (!g.payJail().ok) g.stayInJail(); }
        else g.stayInJail();
        continue;
      }
      const r = g.rollDice();
      g.movePlayer(p, r.total);
      const res = g.resolveLanding(r.total);
      if (g.over) break;
      if (g.pending && g.pending.type === 'buy') {
        if (AI.decideBuy(g, p)) { if (!g.buyLand(g.pending.tileId, p).ok) throw new Error('buyLand failed'); }
        g.clearPending();
      } else if (g.pending && g.pending.type === 'event') {
        g.applyEvent(g.pending.event, p);
        g.clearPending();
      }
      if (!p.alive) { g.endTurn(); continue; }
      const acts = AI.planActions(g, p);
      for (const a of acts) a();
      g.endTurn();
    }
    if (guard >= 20000) { stats.errors.push('超时未结束'); break; }
    if (!g.ranking) { stats.errors.push('没有结算'); break; }
    stats.wins[g.winner.name] = (stats.wins[g.winner.name] || 0) + 1;
    stats.bankrupt += g.players.filter(p => !p.alive).length;
    stats.reiEnd.push(Math.round(g.rei * 10) / 10);
    stats.quarters.push(g.quarter - 1);
    for (const l of g.logs) {
      if (l.kind === 'trade') stats.trades++;
      else if (l.kind === 'dividend') stats.dividends++;
      else if (l.kind === 'warn' && l.msg.indexOf('租金') >= 0) stats.rents++;
    }
    // 存档往返测试
    const clone = Game.deserialize(g.serialize());
    if (clone.netWorth(clone.players[0]) !== g.netWorth(g.players[0])) stats.errors.push('存档往返不一致');
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return {
    games: GAMES,
    avgQuarter: avg(stats.quarters).toFixed(2),
    avgReiEnd: avg(stats.reiEnd).toFixed(1),
    reiMin: Math.min.apply(null, stats.reiEnd),
    reiMax: Math.max.apply(null, stats.reiEnd),
    bankruptPerGame: (stats.bankrupt / GAMES).toFixed(2),
    tradesPerGame: (stats.trades / GAMES).toFixed(1),
    dividendsPerGame: (stats.dividends / GAMES).toFixed(1),
    rentsPerGame: (stats.rents / GAMES).toFixed(1),
    winRate: Object.fromEntries(Object.entries(stats.wins).map(([k, v]) => [k, (v / GAMES * 100).toFixed(1) + '%'])),
    errors: stats.errors.slice(0, 5),
  };
})(GAMES)
`;

const out = vm.runInContext(code, ctx, { filename: 'sim' });
console.log(JSON.stringify(out, null, 2));
