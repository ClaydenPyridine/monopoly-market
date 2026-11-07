/* 单局调试：打印完整日志，检查买地/收租/分红是否真的在发生 */
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

const g = vm.runInContext(`
(function () {
  const g = new Game({ players: [{name:'A',isAI:true},{name:'B',isAI:true},{name:'C',isAI:true},{name:'D',isAI:true}] });
  let guard = 0;
  while (!g.over && guard++ < 20000) {
    const p = g.cur(); if (!p) break;
    if (p.jailTurns > 0) { if (AI.decideJail(g, p)) { if (!g.payJail().ok) g.stayInJail(); } else g.stayInJail(); continue; }
    const r = g.rollDice(); g.movePlayer(p, r.total); g.resolveLanding(r.total);
    if (g.over) break;
    if (g.pending && g.pending.type === 'buy') { if (AI.decideBuy(g, p)) g.buyLand(g.pending.tileId, p); g.clearPending(); }
    else if (g.pending && g.pending.type === 'event') { g.applyEvent(g.pending.event, p); g.clearPending(); }
    if (!p.alive) { g.endTurn(); continue; }
    for (const a of AI.planActions(g, p)) a();
    g.endTurn();
  }
  return g;
})()
`, ctx);

const kinds = {};
for (const l of g.logs) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
console.log('logs total', g.logs.length, JSON.stringify(kinds));
console.log('owned tiles', g.tiles.filter(t => t.owner >= 0).length);
console.log('levels', JSON.stringify(g.tiles.filter(t => t.owner >= 0).map(t => t.short + ':' + t.level)));
console.log('rei', g.rei.toFixed(1), 'quarter', g.quarter);
console.log('net:\n    ' + g.players.map(p => `${p.name} net=${g.netWorth(p)} cash=${Math.round(p.cash)} lands=${g.ownedTiles(p.id).length} stocks=${JSON.stringify(p.stocks)}`).join('\n    '));
console.log('---- 前 60 条日志 ----');
console.log(g.logs.slice(0, 60).map(l => `Q${l.q} [${l.kind}] ${l.msg}`).join('\n'));
