/* 玩家行为画像：从真实对局录制里看"这游戏实际玩起来是什么样"。
 * 用法：node tools/playprofile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs');

const games = fs.readdirSync(dir).filter(f => f.startsWith('对局-') && f.endsWith('.jsonl'))
  .map(f => ({ f, s: fs.statSync(path.join(dir, f)).size }))
  .filter(x => x.s > 5000).sort((a, b) => a.s - b.s);

const out = [];
const P = (s = '') => out.push(s);

for (const { f } of games) {
  const room = (f.match(/对局-([A-Z0-9]{4})/) || [])[1];
  const recs = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  P(`## ${room}`);
  P();

  /* 1. 每个真人玩家的决策时长（按 (turn,phase) 段） */
  const spans = [];
  let cur = null;
  for (const r of recs) {
    if (!r.phase || typeof r.turn !== 'number') continue;
    const p = (r.players || [])[r.turn] || {};
    const key = r.turn + '|' + r.phase + '|' + r.q;
    if (!cur || cur.key !== key) {
      if (cur) {
        const ms = new Date(r.t).getTime() - cur.t0;
        if (ms > 500 && ms < 300000) spans.push({ name: cur.name, phase: cur.phase, ms, ai: cur.ai });
      }
      cur = { key, t0: new Date(r.t).getTime(), phase: r.phase, ai: !!p.ai, name: p.n || '?' };
    }
  }
  const humans = [...new Set(spans.filter(s => !s.ai).map(s => s.name))];
  P('**每个真人的决策时长**（秒）');
  P();
  P('| 玩家 | 样本 | 中位 | P90 | 最长 |');
  P('|---|---|---|---|---|');
  for (const n of humans) {
    const a = spans.filter(s => s.name === n && !s.ai).map(s => s.ms).sort((x, y) => x - y);
    if (!a.length) continue;
    const at = p => (a[Math.min(a.length - 1, Math.floor(a.length * p))] / 1000).toFixed(0);
    P(`| ${n} | ${a.length} | ${at(0.5)}s | ${at(0.9)}s | ${(a[a.length - 1] / 1000).toFixed(0)}s |`);
  }
  P();

  /* 2. 策略偏好：持地 vs 持股（游戏结束时的构成） */
  const last = recs[recs.length - 1];
  const withFull = recs.filter(r => r.完整状态).pop();
  if (withFull) {
    try {
      const g = JSON.parse(withFull.完整状态);
      P('**结束时资产构成**（钱花在哪了）');
      P();
      P('| 玩家 | 现金 | 地产块数 | 地产等级和 | 持股数 | 净资产 |');
      P('|---|---|---|---|---|---|');
      for (const pl of g.players) {
        const mine = g.tiles.filter(t => t.owner === pl.id);
        const lv = mine.reduce((a, t) => a + t.level, 0);
        const sh = Object.values(pl.stocks || {}).reduce((a, b) => a + b, 0);
        const snap = (last.players || []).find(x => x.n === pl.name) || {};
        P(`| ${pl.name} | ¥${Math.round(pl.cash).toLocaleString()} | ${mine.length} | ${lv} | ${sh} | ¥${(snap.net || 0).toLocaleString()} |`);
      }
      P();
    } catch (e) {}
  }

  /* 3. 戏剧性：领先者换了几次手 */
  const byQ = new Map();
  for (const r of recs) byQ.set(r.q, r);
  const leaderSeq = [];
  for (const [q, r] of [...byQ.entries()].sort((a, b) => a[0] - b[0])) {
    const alive = (r.players || []).filter(p => p.alive);
    if (!alive.length) continue;
    leaderSeq.push(alive.slice().sort((a, b) => b.net - a.net)[0].n);
  }
  let changes = 0;
  for (let i = 1; i < leaderSeq.length; i++) if (leaderSeq[i] !== leaderSeq[i - 1]) changes++;
  P(`**戏剧性**：${leaderSeq.length} 个季度里领先者换手 **${changes} 次**`);
  P();
  P('领先者变化：' + leaderSeq.map((n, i) => (i === 0 || leaderSeq[i - 1] !== n ? `**${n}**` : '‖')).join(' ') + '');
  P();
  P('---');
  P();
}

const md = out.join('\n');
fs.writeFileSync(path.join(root, 'docs', '_playprofile.md'), md);
console.log(md);
