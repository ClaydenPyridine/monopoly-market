/* 强制让某个玩家出局，并把它的全部财产对半分给指定的人。
 * 用法：node tools/admin-bankrupt.mjs <存档> <出局者名字> <继承人1> <继承人2>
 * 例：  node tools/admin-bankrupt.mjs logs/awv9-work.json "电脑·铁柱" Penguin 3799
 *
 * 为什么不能用接口：服务端的管理接口只能改现金，改不了地产/股票归属；
 * 引擎里也没有"对半分"这个逻辑（declareBankrupt 是"全给债权人"或"回归银行"）。
 * 所以走"改存档 → --restore 恢复"这条路。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [file, deadName, h1Name, h2Name] = process.argv.slice(2);
if (!file || !deadName || !h1Name || !h2Name) {
  console.log('用法：node tools/admin-bankrupt.mjs <存档> <出局者> <继承人1> <继承人2>');
  process.exit(1);
}

const outer = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
const g = JSON.parse(outer.game);

/* 用引擎算地块真实价值，保证"对半分"是按价值分的而不是按块数 */
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date };
vm.createContext(ctx);
for (const f of ['src/data.js', 'src/engine.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const valOf = (t) => {
  const ctx2 = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, T: t, REI: g.rei };
  vm.createContext(ctx2);
  for (const f of ['src/data.js', 'src/engine.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx2, { filename: f });
  return vm.runInContext('(function(){ const G = new Game({players:[{name:"x"}]}); G.rei = REI; return G.assetValue(T); })()', ctx2);
};

const dead = g.players.find(p => p.name === deadName);
const h1 = g.players.find(p => p.name === h1Name);
const h2 = g.players.find(p => p.name === h2Name);
if (!dead || !h1 || !h2) { console.log('找不到玩家：', { dead: !!dead, h1: !!h1, h2: !!h2 }); process.exit(1); }
if (!dead.alive) { console.log(`${deadName} 已经出局了`); process.exit(1); }

const before = {
  deadCash: Math.round(dead.cash),
  deadLands: g.tiles.filter(t => t.owner === dead.id).length,
  deadStocks: Object.values(dead.stocks || {}).reduce((a, b) => a + b, 0),
  h1Cash: Math.round(h1.cash), h2Cash: Math.round(h2.cash),
};

/* ---- 1. 地产：按价值贪心平摊（谁少给谁） ---- */
const lands = g.tiles.filter(t => t.owner === dead.id)
  .map(t => ({ t, v: Math.max(1, valOf(t)) }))
  .sort((a, b) => b.v - a.v);
let v1 = 0, v2 = 0, n1 = 0, n2 = 0;
for (const { t, v } of lands) {
  const toH1 = (v1 <= v2);
  t.owner = toH1 ? h1.id : h2.id;
  t.mortgaged = false; t.loan = 0; t.marginCall = false;
  if (toH1) { v1 += v; n1++; } else { v2 += v; n2++; }
}

/* ---- 2. 现金：对半 ---- */
const half = Math.floor(dead.cash / 2);
h1.cash += half;
h2.cash += dead.cash - half;

/* ---- 3. 股票：对半（整数，余数给 h1） ---- */
const stockLog = [];
for (const code of Object.keys(dead.stocks || {})) {
  const n = dead.stocks[code] || 0;
  if (!n) continue;
  const a = Math.ceil(n / 2), b = n - a;
  h1.stocks[code] = (h1.stocks[code] || 0) + a;
  h2.stocks[code] = (h2.stocks[code] || 0) + b;
  stockLog.push(`${code}×${n} → ${a}/${b}`);
}

/* ---- 4. 出局 ---- */
dead.alive = false;
dead.cash = 0;
dead.stocks = {};
dead.products = { junk: null, option: null, insurance: null, deposit: null };
dead.jailTurns = 0;

/* ---- 5. 记一条日志（玩家能在事件日志里看到） ---- */
const L = `⚖️ ${deadName} 被强制清盘出局：现金与地产、股票由 ${h1Name} 与 ${h2Name} 对半接收`;
if (Array.isArray(g.logs)) {
  g.logs.push({ q: g.quarter, msg: L, kind: 'bad' });
  g.logs.push({ q: g.quarter, msg: `${h1Name} 分得 ${n1} 块地（价值约 ¥${Math.round(v1).toLocaleString()}）`, kind: 'info' });
  g.logs.push({ q: g.quarter, msg: `${h2Name} 分得 ${n2} 块地（价值约 ¥${Math.round(v2).toLocaleString()}）`, kind: 'info' });
}

/* ---- 6. 如果轮到出局者，把回合让出去 ---- */
let turnMoved = false;
if (g.current === dead.id) {
  for (let k = 1; k <= 4; k++) {
    const nxt = (dead.id + k) % g.players.length;
    if (g.players[nxt].alive) { g.current = nxt; turnMoved = true; break; }
  }
  g.phase = 'awaiting-roll';
  g.pending = null;
}

outer.game = JSON.stringify(g);
outer.phase = g.phase;
outer.turn = g.current;
outer.quarter = g.quarter;
/* 座位上的"电脑接管"标记也清掉，避免恢复后又被当成 AI 管 */
if (Array.isArray(outer.seats) && outer.seats[dead.id]) {
  outer.seats[dead.id].isAI = true;
  outer.seats[dead.id].autoAI = false;
  outer.seats[dead.id].lastSeen = Date.now();
}

const out = path.resolve(root, 'logs/awv9-final.json');
fs.writeFileSync(out, JSON.stringify(outer));

console.log(`出局者：${deadName}`);
console.log(`  出局前：现金 ¥${before.deadCash.toLocaleString()}  地产 ${before.deadLands} 块  股票 ${before.deadStocks} 股`);
console.log(`地产按价值贪心平摊：`);
console.log(`  ${h1Name} 得 ${n1} 块，价值约 ¥${Math.round(v1).toLocaleString()}（原现金 ¥${before.h1Cash.toLocaleString()}）`);
console.log(`  ${h2Name} 得 ${n2} 块，价值约 ¥${Math.round(v2).toLocaleString()}（原现金 ¥${before.h2Cash.toLocaleString()}）`);
console.log(`现金对半：各 ¥${Math.round(half).toLocaleString()} / ¥${Math.round(before.deadCash - half).toLocaleString()}`);
if (stockLog.length) console.log(`股票对半：${stockLog.join('  ')}`);
if (turnMoved) console.log(`⚠ 原本轮到出局者，已把回合交给 ${g.players[g.current].name}`);
console.log(`\n已写出：${out}`);
console.log(`恢复命令：node server.mjs 8787 --restore "logs/awv9-final.json"`);
