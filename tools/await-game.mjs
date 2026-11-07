/* 等一局结束（或服务器关闭），然后自动跑分析并落盘报告。
 * 用法：node tools/await-game.mjs AWV9
 * 设计：每 5 秒探一次 /api/state；满足任一条件就收尾：
 *   ① 对局 over（打完了）  ② 服务器连不上（关服了）  ③ 超过 3 小时兜底
 *
 * ★★ 本脚本会**自己拉起录像**（spawn tools/watch.mjs）★★
 *    踩过的坑：这个脚本原先是"只守候、不录像"，我误以为它就是录像脚本，
 *    于是 JUDZ 那局全程没写 jsonl；等服务器一关，内存里的日志没了，整局数据彻底丢失。
 *    （PGVS 那次是忘开录像，JUDZ 这次是开错了脚本 —— 同一个后果。）
 *    现在录像在这里内建，**只要启动了守候就一定有录像**，不可能再漏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const room = (process.argv[2] || 'AWV9').toUpperCase();
const BASE = process.env.DGS_BASE || 'http://127.0.0.1:8787';
const MAX_MIN = 180;
const t0 = Date.now();

/* ---- 内建录像：子进程跑 watch.mjs，输出直接透传到本进程的日志 ---- */
let recorder = null;
try {
  recorder = spawn(process.execPath, [path.join(root, 'tools', 'watch.mjs'), room],
    { cwd: root, stdio: 'inherit' });
  recorder.on('error', e => console.error('录像进程启动失败：', e && e.message));
} catch (e) {
  console.error('录像进程启动异常：', e && e.message);
}
const stopRecorder = () => {
  try { if (recorder && !recorder.killed) recorder.kill(); } catch (e) {}
};

const get = async (url) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return await r.json();
  } finally { clearTimeout(timer); }
};

let lastQ = 0, offlineStreak = 0, reason = '';
const t = () => new Date().toTimeString().slice(0, 8);

console.log(`[${t()}] 开始守候房间 ${room}（每 5 秒探一次；对局结束或服务器关闭即收尾）`);

for (;;) {
  if ((Date.now() - t0) / 60000 > MAX_MIN) { reason = `超过 ${MAX_MIN} 分钟兜底退出`; break; }
  let st = null, err = null;
  try {
    const r = await get(`${BASE}/api/state?room=${room}`);
    st = r && r.state ? r.state : null;
  } catch (e) { err = e; }

  if (!st) {
    offlineStreak++;
    /* 连续 4 次（约 20 秒）拿不到状态才算服务器关了，避免网络抖动误判 */
    if (offlineStreak >= 4) { reason = '服务器已关闭（连续 20 秒取不到房间状态）'; break; }
  } else {
    offlineStreak = 0;
    let g = null;
    try { g = JSON.parse(st.game); } catch {}
    if (g) {
      if (g.quarter !== lastQ) {
        lastQ = g.quarter;
        console.log(`[${t()}] Q${g.quarter}  指数 ${g.rei != null ? g.rei.toFixed(1) : '?'}  轮到 ${g.players[g.current] ? g.players[g.current].name : '?'}`);
      }
      if (g.over) { reason = `对局结束（Q${g.quarter}），冠军 ${g.winner ? g.winner.name : '?'}`; break; }
    }
  }
  await new Promise(r => setTimeout(r, 5000));
}

console.log(`[${t()}] 收尾原因：${reason}`);
stopRecorder();
console.log(`[${t()}] 开始分析录像…\n`);

/* 跑分析 */
const r2 = spawnSync(process.execPath, [path.join(root, 'tools', 'analyze-game.mjs'), room],
  { cwd: root, encoding: 'utf8' });
const report = (r2.stdout || '') + (r2.stderr || '');
console.log(report);

const out = path.join(root, 'docs', `对局分析-${room}.md`);
fs.writeFileSync(out, '```\n' + report.trim() + '\n```\n');
console.log(`\n[${t()}] 报告已写入 ${out}`);
