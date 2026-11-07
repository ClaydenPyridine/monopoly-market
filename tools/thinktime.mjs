/* 从旁观录制里统计"玩家每步实际花了多久"，用来决定超时该设多少秒。
 *
 * 用法：node tools/thinktime.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs');

const files = fs.readdirSync(dir).filter(f => f.startsWith('对局-') && f.endsWith('.jsonl'))
  .map(f => ({ f, size: fs.statSync(path.join(dir, f)).size }))
  .filter(x => x.size > 5000)
  .sort((a, b) => b.size - a.size);

if (!files.length) { console.log('没有可用的录制文件'); process.exit(1); }

const spans = [];   // {phase, ms, human, room}
for (const { f } of files) {
  const room = (f.match(/对局-([A-Z0-9]{4})/) || [])[1];
  let recs = [];
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line)); } catch (e) {}
  }
  let cur = null;
  for (const r of recs) {
    if (!r.phase || typeof r.turn !== 'number') continue;
    const key = r.turn + '|' + r.phase + '|' + r.q;
    const p = (r.players || [])[r.turn] || {};
    if (!cur || cur.key !== key) {
      if (cur) {
        const ms = new Date(r.t).getTime() - cur.t0;
        /* 只统计 0.5~300 秒的，滤掉录制中断造成的大空洞 */
        if (ms > 500 && ms < 300000) spans.push({ phase: cur.phase, ms, human: !cur.ai, room });
      }
      cur = { key, t0: new Date(r.t).getTime(), phase: r.phase, ai: !!p.ai };
    }
  }
}

const stat = (arr) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] / 1000;
  return { n: s.length, med: at(0.5), p75: at(0.75), p90: at(0.9), p99: at(0.99), max: s[s.length - 1] / 1000 };
};
const fmt = (s, label) => s
  ? `  ${label.padEnd(22)} 样本${String(s.n).padStart(4)}  中位 ${s.med.toFixed(0).padStart(4)}s  P75 ${s.p75.toFixed(0).padStart(4)}s  P90 ${s.p90.toFixed(0).padStart(4)}s  P99 ${s.p99.toFixed(0).padStart(5)}s  最长 ${s.max.toFixed(0)}s`
  : `  ${label}：无样本`;

console.log('');
console.log('  玩家每步实际耗时（秒）—— 数据来自真实旁观录制');
console.log('  ' + '─'.repeat(104));
for (const ph of ['awaiting-roll', 'awaiting-jail', 'awaiting-buy', 'awaiting-event', 'awaiting-trade']) {
  const human = spans.filter(s => s.phase === ph && s.human).map(s => s.ms);
  const ai = spans.filter(s => s.phase === ph && !s.human).map(s => s.ms);
  console.log(`  【${ph}】`);
  console.log(fmt(stat(human), '真人'));
  console.log(fmt(stat(ai), '电脑'));
}
console.log('');
const allHuman = stat(spans.filter(s => s.human).map(s => s.ms));
console.log(fmt(allHuman, '真人合计'));
console.log('');
/* 如果设成 N 秒超时，会误伤多少比例的正常操作？ */
console.log('  如果把超时设成 N 秒，会打断多少比例的"正常"操作（按真人样本）：');
const hu = spans.filter(s => s.human).map(s => s.ms).sort((a, b) => a - b);
for (const N of [30, 45, 60, 90, 120, 150, 180, 240]) {
  const cut = hu.filter(ms => ms > N * 1000).length;
  const pctv = (cut / hu.length * 100);
  const bar = '█'.repeat(Math.round(pctv / 2));
  console.log(`    ${String(N).padStart(3)} 秒 → 打断 ${String(cut).padStart(4)} 次 (${pctv.toFixed(1).padStart(5)}%) ${bar}`);
}
console.log('');
