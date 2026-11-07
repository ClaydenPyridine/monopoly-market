/* 旁观 + 记录一个正在进行的对局。
 *
 * ★ 只读：全程只调用 GET /api/state，绝不发任何会改变对局的请求。
 *   所以正在玩的人不会受到任何影响。
 *
 * 用法：
 *   node tools/watch.mjs <房间号> [轮询间隔毫秒，默认 1000]
 *
 * 产出：
 *   logs/对局-<房间号>-<开始时间>.jsonl   每有变化追加一行，可直接拿来复盘
 *   控制台实时滚动关键事件（季度、轮到谁、破产、追缴、指数异动、对局结束）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTERVAL = Math.max(300, parseInt(process.argv[3] || '1000', 10));
const PORT = process.env.DGS_PORT || '8787';
const BASE = `http://127.0.0.1:${PORT}`;

/* 没给房间号时：问本机服务端"现在有哪些房间"，自动挑一个正在进行的。
   （/api/rooms 是只允许本机访问的接口，公网隧道过来的请求会被拒。） */
async function pickRoom() {
  try {
    const r = await fetch(`${BASE}/api/rooms`);
    if (!r.ok) return null;
    const j = await r.json();
    const list = (j.rooms || []).filter(x => !x.over);
    if (!list.length) return null;
    list.sort((a, b) => (b.started - a.started) || (a.空闲秒数 - b.空闲秒数));
    return list[0];
  } catch (e) { return null; }
}

let ROOM = String(process.argv[2] || '').toUpperCase();
if (!/^[A-Z0-9]{4}$/.test(ROOM)) {
  const found = await pickRoom();
  if (found) {
    ROOM = found.room;
    console.log(`自动发现房间 ${found.room}（${found.started ? '进行中 Q' + found.quarter : '还在大厅'}，` +
      `${found.玩家.map(p => p.名字 + (p.电脑 ? '(电脑)' : '')).join(' / ')}）`);
  } else {
    console.log('用法：node tools/watch.mjs [4位房间号] [间隔毫秒]');
    console.log('不给房间号的话会自动找本机服务端上正在进行的对局。');
    console.log('（找不到说明服务端没跑，或者服务端版本较旧、还没有 /api/rooms 接口）');
    process.exit(1);
  }
}

/* 载入引擎，用来算净资产（和游戏里的口径完全一致）。
   注意：vm 里顶层 `class` / `const` 不会变成 sandbox 对象的属性，
   必须用 runInContext('Game') 取，不能写 ctx.Game（那是 undefined）。 */
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, isNaN, parseInt, parseFloat };
vm.createContext(ctx);
for (const f of ['src/data.js', 'src/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const Game = vm.runInContext('Game', ctx);
const CONFIG = vm.runInContext('CONFIG', ctx);
if (typeof Game !== 'function') {
  console.log('载入引擎失败：拿不到 Game 类');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logDir = path.join(root, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `对局-${ROOM}-${stamp}.jsonl`);
const stream = fs.createWriteStream(logFile, { flags: 'a' });

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const money = (n) => '¥' + Math.round(n).toLocaleString('en-US');
let lastKey = null;       // 上一次快照的序列化字符串，用来判断"有没有变化"
let lastSnap = null;      // 上一次快照对象，用来算增量（千万别把字符串当对象用）
/* 日志是"滑动窗口"：服务端每次只发最近 120 条，所以长度永远是 120，
   不能用 length 判断有没有新日志——必须按内容找上次见过的最后一条。 */
function pickNewLogs(logs) {
  const ids = logs.map(l => `${l.q}|${l.msg}`);
  let out;
  if (lastLogKey === null) {
    out = logs.slice();                       // 第一次：全是历史
  } else {
    const i = ids.lastIndexOf(lastLogKey);
    out = i >= 0 ? logs.slice(i + 1) : logs.slice(-12);   // 找不到就保守取最后 12 条
  }
  if (ids.length) lastLogKey = ids[ids.length - 1];
  return out;
}
let lastLogKey = null;
let ticks = 0;
let started = false;

function snapshot(g) {
  return {
    q: g.quarter, turn: g.current, phase: g.phase,
    rei: Math.round(g.rei * 10) / 10,
    over: !!g.over,
    cur: g.cur() ? g.cur().name : '',
    players: g.players.map(p => ({
      n: p.name, cash: Math.round(p.cash), net: Math.round(g.netWorth(p)),
      pos: p.pos, alive: !!p.alive, ai: !!p.isAI,
      levels: g.tiles.filter(t => t.owner === p.id && !t.mortgaged).reduce((a, t) => a + t.level, 0),
      calls: g.tiles.filter(t => t.owner === p.id && t.marginCall).length,
    })),
    stocks: g.players.reduce((a, p) => a + Object.values(p.stocks || {}).reduce((x, y) => x + y, 0), 0),
    holds: g.players.reduce((a, p) => a + g.tiles.filter(t => t.owner === p.id).length, 0),
  };
}

function show(s, newLogs, prev) {
  const rank = s.players.filter(p => p.alive).sort((a, b) => b.net - a.net);
  const lead = rank[0];
  const tag = s.over ? '【结束】' : `Q${s.q}`;
  console.log(
    `${now()}  ${tag} 轮到 ${s.cur}  指数 ${s.rei}` +
    (lead ? `  领先 ${lead.n} ${money(lead.net)}` : '') +
    `  持股${s.stocks}只/持地${s.holds}块`
  );
  for (const l of newLogs) console.log('        · ' + l);
  /* 重点事件单独高亮 */
  if (prev) {
    for (const p of s.players) {
      const o = prev.players.find(x => x.n === p.n);
      if (!o) continue;
      if (o.alive && !p.alive) console.log(`        ⚠ ${p.n} 出局了`);
      if (p.calls > o.calls) console.log(`        ⚠ ${p.n} 有 ${p.calls - o.calls} 块地被银行追缴`);
      if (o.calls > p.calls) console.log(`        ✓ ${p.n} 赎回了解除追缴`);
      const drop = o.net - p.net;
      if (drop > o.net * 0.15 && drop > 3000) console.log(`        ↓ ${p.n} 净资产掉了 ${money(drop)}`);
    }
    if (Math.abs(s.rei - prev.rei) >= 5) {
      const d = s.rei - prev.rei;
      console.log(`        指数${d > 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(1)} 点`);
    }
  }
}

function write(obj) {
  try { stream.write(JSON.stringify(obj) + '\n'); } catch (e) {}
}

async function loop() {
  for (;;) {
    let st = null;
    try {
      const r = await fetch(`${BASE}/api/state?room=${ROOM}`);
      if (r.status === 404) {
        if (ticks % 10 === 0) console.log(`${now()}  房间 ${ROOM} 还不存在（或已经解散）…等着`);
        ticks++;
        await new Promise(x => setTimeout(x, INTERVAL));
        continue;
      }
      const j = await r.json();
      st = j.state;
    } catch (e) {
      if (ticks % 15 === 0) console.log(`${now()}  连不上服务端（${e.message}），重试中…`);
      ticks++;
      await new Promise(x => setTimeout(x, INTERVAL));
      continue;
    }
    ticks++;

    if (!st || !st.started || !st.game) {
      if (!started && ticks % 8 === 0) console.log(`${now()}  已进房间 ${ROOM}，等房主开始游戏…`);
      await new Promise(x => setTimeout(x, INTERVAL));
      continue;
    }
    if (!started) {
      started = true;
      console.log('');
      console.log(`  ★ 开始记录对局 ${ROOM}`);
      console.log(`  ★ 日志文件：${path.relative(root, logFile)}`);
      console.log('');
    }

    let g;
    try { g = Game.deserialize(st.game); } catch (e) {
      console.log(`${now()}  解析状态失败：${e.message}`);   // 不要静默吞掉
      await new Promise(x => setTimeout(x, INTERVAL));
      continue;
    }
    const s = snapshot(g);
    const key = JSON.stringify(s);
    const logs = g.logs || [];
    const newLogs = pickNewLogs(logs).map(l => `Q${l.q} ${l.msg}`);

    if (key !== lastKey) {
      const prev = lastSnap;
      lastKey = key;
      lastSnap = s;
      show(s, newLogs.slice(-8), prev);
      write({
        t: new Date().toISOString(), ...s,
        新日志: newLogs,
        /* 每季度存一次完整状态，方便事后精确复盘 */
        ...(prev === null || prev.q !== s.q ? { 完整状态: st.game } : {}),
      });
      if (s.over) {
        console.log('');
        console.log('  ★ 对局结束，最终排名：');
        s.players.slice().sort((a, b) => b.net - a.net).forEach((p, i) =>
          console.log(`     ${i + 1}. ${p.n.padEnd(10)} ${money(p.net).padStart(12)}  现金 ${money(p.cash)}`));
        console.log('');
        console.log(`  记录已写入 ${path.relative(root, logFile)}`);
        break;
      }
    }
    await new Promise(x => setTimeout(x, INTERVAL));
  }
}

process.on('SIGINT', () => {
  console.log('\n  已停止记录。文件：' + path.relative(root, logFile));
  try { stream.end(); } catch (e) {}
  process.exit(0);
});

console.log('');
console.log(`  旁观房间 ${ROOM}（每 ${INTERVAL}ms 读一次，只读不改）`);
console.log('');
loop();
