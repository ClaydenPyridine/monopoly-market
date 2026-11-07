/* 把正在进行的对局完整快照到磁盘（断线救援用）。
 *
 * 用法：
 *   node tools/snapshot.mjs <房间号> [要交给电脑接管的座位号]
 *
 * 产物：logs/存档-<房间号>-Q<季度>.json
 *   { room, savedAt, quarter, seats:[{name,isAI,接管}], game }
 * 之后可以用 server.mjs --restore <该文件> 把对局原样恢复。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const room = String(process.argv[2] || '').toUpperCase();
const takeover = process.argv[3] !== undefined ? parseInt(process.argv[3], 10) : -1;
const PORT = process.env.DGS_PORT || '8787';

if (!/^[A-Z0-9]{4}$/.test(room)) {
  console.log('用法：node tools/snapshot.mjs <4位房间号> [要交给电脑接管的座位号]');
  process.exit(1);
}

const r = await fetch(`http://127.0.0.1:${PORT}/api/state?room=${room}`);
if (!r.ok) { console.log('读不到房间 ' + room + '（HTTP ' + r.status + '）'); process.exit(1); }
const j = await r.json();
if (!j.ok || !j.state || !j.state.started || !j.state.game) {
  console.log('这个房间还没开局，没有可存的对局状态');
  process.exit(1);
}
const g = JSON.parse(j.state.game);

const snap = {
  room,
  savedAt: new Date().toISOString(),
  quarter: g.quarter,
  turn: g.current,
  phase: g.phase,
  seats: (j.state.seats || []).map((s, i) => ({
    name: s.name, isAI: !!s.isAI, 接管: i === takeover,
  })),
  game: j.state.game,          // 原样保存序列化字符串，恢复时不做二次解析
};

const dir = path.join(root, 'logs');
fs.mkdirSync(dir, { recursive: true });
/* 文件名带时间戳：同一个季度反复存档也不会覆盖掉之前那份 */
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(dir, `存档-${room}-Q${g.quarter}-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify(snap, null, 1));

console.log(`已存档：${path.relative(root, file)}`);
console.log(`  房间 ${room}  Q${g.quarter}  阶段 ${g.phase}  轮到 ${g.players[g.current].name}`);
snap.seats.forEach((s, i) => {
  console.log(`  [${i}] ${s.name.padEnd(18)} ${s.接管 ? '← 将交给电脑接管 ★' : s.isAI ? '(本来就是电脑)' : ''}`);
});
if (takeover >= 0) console.log(`\n恢复时会把座位 ${takeover} 标记为电脑，由服务端自动接管。`);
console.log(`\n恢复命令： node server.mjs 8787 --restore "${path.relative(root, file)}"`);
