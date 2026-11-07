/* 把 tools/watch.mjs 录下的对局日志变成一份中文战报（Markdown）。
 *
 * 用法：
 *   node tools/report.mjs                       # 自动挑 logs/ 里最新的一份
 *   node tools/report.mjs logs/对局-XXXX-....jsonl
 *   node tools/report.mjs <文件> --out 战报.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const fileArg = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1);

let logFile = fileArg;
if (!logFile) {
  const dir = path.join(root, 'logs');
  if (!fs.existsSync(dir)) { console.log('没有 logs 目录'); process.exit(1); }
  const cands = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f, st: fs.statSync(path.join(dir, f)) }))
    .sort((a, b) => b.st.size - a.st.size);
  if (!cands.length) { console.log('logs/ 里没有记录文件'); process.exit(1); }
  logFile = path.join(dir, cands[0].f);
}
if (!path.isAbsolute(logFile)) logFile = path.join(root, logFile);
if (!fs.existsSync(logFile)) { console.log('找不到文件：' + logFile); process.exit(1); }

const recs = fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch (e) { return null; }
}).filter(Boolean);
if (!recs.length) { console.log('记录是空的'); process.exit(1); }

const L = [];
const p = (s = '') => L.push(s);
const money = (n) => '¥' + Math.round(n).toLocaleString('en-US');
const hm = (iso) => iso.slice(11, 19);

/* ---------- 基本盘 ---------- */
const first = recs[0], last = recs[recs.length - 1];
const room = (path.basename(logFile).match(/对局-([A-Z0-9]{4})/) || [])[1] || '?';
const t0 = new Date(first.t), t1 = new Date(last.t);
const mins = Math.round((t1 - t0) / 60000);

/* 每个季度取最后一条 */
const byQ = new Map();
for (const r of recs) byQ.set(r.q, r);
const quarters = [...byQ.keys()].sort((a, b) => a - b);

/* 最终完整状态 */
let finalG = null;
for (let i = recs.length - 1; i >= 0; i--) {
  if (recs[i].完整状态) { try { finalG = JSON.parse(recs[i].完整状态); break; } catch (e) {} }
}

/* ---------- 收集所有事件 ----------
   两个来源合并去重：
   1) watch 记录的"新日志"（第一次抓的是历史，之后靠内容比对）
   2) 每季度那份"完整状态"里的 logs —— 联机时被裁到最近 120 条，
      但会随对局推进，把各季度的快照合起来就能补回被漏掉的事件。
   日志文本自带游戏内季度（"Q6 eole 升级了…"），按它归档。 */
const events = [];
const seen = new Set();
function addEvent(q, raw, time) {
  let qq = q, t = String(raw);
  const m = t.match(/^Q(\d+)\s+([\s\S]*)$/);
  if (m) { qq = parseInt(m[1], 10); t = m[2]; }
  const k = qq + '|' + t;
  if (seen.has(k)) return;
  seen.add(k);
  events.push({ q: qq, t, time });
}
for (const r of recs) {
  for (const raw of (r.新日志 || [])) addEvent(r.q, raw, r.t);
  if (r.完整状态) {
    try {
      const g = JSON.parse(r.完整状态);
      for (const l of (g.logs || [])) addEvent(l.q, l.msg, r.t);
    } catch (e) {}
  }
}
events.sort((a, b) => a.q - b.q);

const cat = [
  ['破产 / 出局', /破产|出局|淘汰/],
  ['追缴 / 抵押', /追缴|抵押|赎回|收地|法拍/],
  ['买地 / 升级', /买下|升级/],
  ['租金往来', /租金|过路|付给/],
  ['股票交易', /股|分红|派息/],
  ['金融产品', /风险投资|垃圾债券|期权|保险|存单|开奖/],
  ['税费', /税/],
  ['卡片事件', /宝箱|深渊|机会|命运/],
];
const bucket = {};
for (const [name, re] of cat) bucket[name] = events.filter(e => re.test(e.t));

/* ---------- 输出 ---------- */
p(`# 对局战报 · 房间 ${room}`);
p();
p(`> 由 \`tools/watch.mjs\` 实时旁观录制，\`tools/report.mjs\` 生成。`);
p(`> 记录文件：\`${path.relative(root, logFile)}\`（${recs.length} 条快照）`);
p();

p('## 一、概况');
p();
p(`| 项目 | 数据 |`);
p(`|---|---|`);
p(`| 录制区间 | ${hm(first.t)} ~ ${hm(last.t)}（约 ${mins} 分钟）|`);
p(`| 覆盖季度 | Q${quarters[0]} → Q${quarters[quarters.length - 1]}（${quarters.length} 个季度）|`);
p(`| 玩家 | ${last.players.map(x => `${x.n}${x.ai ? '(电脑)' : ''}`).join('、')} |`);
p(`| 出局人数 | ${last.players.filter(x => !x.alive).length} |`);
p(`| 最终地产指数 | ${last.rei} |`);
p();

p('## 二、最终排名');
p();
p('| # | 玩家 | 净资产 | 现金 | |');
p('|---|---|---|---|---|');
last.players.slice().sort((a, b) => b.net - a.net).forEach((x, i) => {
  p(`| ${i + 1} | ${x.n}${x.ai ? ' 🤖' : ''} | **${money(x.net)}** | ${money(x.cash)} | ${x.alive ? '' : '❌ 出局'} |`);
});
p();

if (finalG) {
  p('### 资产构成（结束时）');
  p();
  p('| 玩家 | 地产块数 | 地产等级和 | 抵押中 | 持股数 | 净资产 |');
  p('|---|---|---|---|---|---|');
  for (const pl of finalG.players.slice().sort((a, b) => b.cash - a.cash)) {
    const mine = finalG.tiles.filter(t => t.owner === pl.id);
    const lv = mine.reduce((a, t) => a + t.level, 0);
    const mg = mine.filter(t => t.mortgaged).length;
    const sh = Object.values(pl.stocks || {}).reduce((a, b) => a + b, 0);
    const snap = last.players.find(x => x.n === pl.name) || {};
    p(`| ${pl.name} | ${mine.length} | ${lv} | ${mg} | ${sh} | ${money(snap.net || 0)} |`);
  }
  p();
}

p('## 三、地产指数走势');
p();
p('指数 100 = 基准。地价与租金都按 `指数/100` 缩放，所以这条线就是全局的"行情"。');
p();
const maxR = Math.max(...quarters.map(q => byQ.get(q).rei));
const minR = Math.min(...quarters.map(q => byQ.get(q).rei));
const W = 44;
for (const q of quarters) {
  const r = byQ.get(q).rei;
  const n = Math.max(1, Math.round((r - minR) / Math.max(1, maxR - minR) * W));
  p(`Q${String(q).padStart(2)} ${String(r).padStart(6)} ${'█'.repeat(n)}`);
}
p();
p(`区间：最低 **${minR}**，最高 **${maxR}**，振幅 **${(maxR - minR).toFixed(1)} 点**。`);
p();

p('## 四、名次变化');
p();
p('| 季度 | ' + last.players.map(x => x.n).join(' | ') + ' |');
p('|---|' + last.players.map(() => '---|').join(''));
for (const q of quarters) {
  const r = byQ.get(q);
  const rank = r.players.slice().sort((a, b) => b.net - a.net).map(x => x.n);
  const cells = r.players.map(x => {
    const pos = rank.indexOf(x.n) + 1;
    return `${pos}. ${money(x.net)}${x.alive ? '' : ' ❌'}`;
  });
  p(`| Q${q} | ${cells.join(' | ')} |`);
}
p();

p('## 五、关键事件');
p();
p(`> 共 ${events.length} 条。按游戏内季度归档，已经去掉重复。`);
p();
for (const [name, list] of Object.entries(bucket)) {
  if (!list.length) continue;
  p(`### ${name}（${list.length} 条）`);
  p();
  const show = list.length > 40 ? list.slice(0, 20).concat([{ q: '…', t: `（另有 ${list.length - 40} 条同类事件）` }], list.slice(-20)) : list;
  for (const e of show) p(`- \`Q${e.q}\` ${e.t}`);
  p();
}

p('## 六、统计');
p();
const stat = {};
for (const [, list] of Object.entries(bucket)) stat[list.length] = stat;
p('| 类别 | 次数 |');
p('|---|---|');
for (const [name, list] of Object.entries(bucket)) p(`| ${name} | ${list.length} |`);
p(`| **合计** | **${events.length}** |`);
p();

/* 追缴与净资产滑坡 */
const drops = [];
for (const q of quarters) {
  const r = byQ.get(q);
  const prev = byQ.get(quarters[quarters.indexOf(q) - 1]);
  if (!prev) continue;
  for (const pl of r.players) {
    const o = prev.players.find(x => x.n === pl.n);
    if (o && o.net - pl.net > o.net * 0.2 && o.net - pl.net > 5000) {
      drops.push(`Q${q} ${pl.n} 从 ${money(o.net)} 跌到 ${money(pl.net)}（−${money(o.net - pl.net)}）`);
    }
  }
}
if (drops.length) {
  p('### 净资产大滑坡（单季度跌幅 >20%）');
  p();
  drops.forEach(d => p('- ' + d));
  p();
}

/* 最大赢家 / 输家 */
const delta = last.players.map(pl => {
  const f = first.players.find(x => x.n === pl.n);
  return { n: pl.n, d: pl.net - (f ? f.net : pl.net), from: f ? f.net : pl.net, to: pl.net };
}).sort((a, b) => b.d - a.d);
p('### 全程涨跌');
p();
p('| 玩家 | 开始时 | 结束时 | 变化 |');
p('|---|---|---|---|');
for (const d of delta) p(`| ${d.n} | ${money(d.from)} | ${money(d.to)} | ${d.d >= 0 ? '+' : ''}${money(d.d)} |`);
p();

/* 记录完整性说明 */
const evQ = events.map(e => e.q).filter(q => typeof q === 'number');
const evMin = evQ.length ? Math.min(...evQ) : '-';
const evMax = evQ.length ? Math.max(...evQ) : '-';
const fullQs = recs.filter(r => r.完整状态).map(r => r.q);
p('## 附：记录说明（怎么读这份战报）');
p();
p('* 由 `tools/watch.mjs` 约每秒读取一次**服务端权威状态**，全程只读，不影响对局。');
p(`* 快照覆盖 **Q${quarters[0]}–Q${quarters[quarters.length - 1]}**；事件日志覆盖 **Q${evMin}–Q${evMax}**。`);
p(`* 完整状态（可精确复盘）保存在这些季度：${[...new Set(fullQs)].map(q => 'Q' + q).join('、')}。`);
p('* ⚠️ 联机时服务端每次只推**最近 120 条日志**（省流量），所以：');
p('  * 中途开始录制时，之前的日志会一次性带进来；');
p('  * 如果某个季度的日志没被任何快照覆盖到（比如录制在季度中途结束），那个季度的事件会缺失——');
p('    **上面的名次变化表和净资产数据是全的**（来自状态快照），缺的只是文字事件。');
p('* 净资产按引擎口径：`现金 + Σ(地产市值 − 该地贷款) + 持股市值`。**抵押中的地按市值减贷款计入**，不是归零。');
p();

const md = L.join('\n');const target = outFile
  ? path.resolve(root, outFile)
  : path.join(root, 'docs', `战报-${room}.md`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, md);
console.log('战报已生成：' + target);
console.log(`（${quarters.length} 个季度 / ${events.length} 条事件 / ${recs.length} 条快照）`);
