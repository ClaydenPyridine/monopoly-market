/* 针对 v0.10 那批改动的实战核查：拿一局真人录像，逐条验证"改动到底生效没有、有没有副作用"。
 * 用法：node tools/analyze-game.mjs [录制文件名或房间号]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs');

/* 选文件：给了参数就按房间号/文件名找，否则挑最新且 >5KB 的 */
let file;
const arg = process.argv[2];
const all = fs.readdirSync(dir).filter(f => f.startsWith('对局-') && f.endsWith('.jsonl'))
  .map(f => ({ f, s: fs.statSync(path.join(dir, f)).size, t: fs.statSync(path.join(dir, f)).mtime }))
  .filter(x => x.s > 5000).sort((a, b) => b.t - a.t);
if (arg) {
  const hit = all.find(x => x.f.includes(arg) || x.f.includes(arg.toUpperCase()));
  if (!hit) { console.log('找不到录制的房间:', arg); console.log('现有:', all.map(x => x.f).join('\n  ')); process.exit(1); }
  file = hit.f;
} else {
  if (!all.length) { console.log('没有可用录制'); process.exit(0); }
  file = all[0].f;
}

const recs = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(l => l.trim())
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const room = (file.match(/对局-([A-Z0-9]{4})/) || [])[1];
const P = console.log;

P(`\n╔══════════════════════════════════════════════════════════╗`);
P(`  房间 ${room}   录制 ${file}`);
P(`  采样 ${recs.length} 条   ${new Date(recs[0].t).toLocaleString()} → ${new Date(recs[recs.length - 1].t).toLocaleString()}`);
P(`╚══════════════════════════════════════════════════════════╝`);

/* ── 收集全部日志（去重，跨快照） ── */
const seen = new Set(); const evs = [];
for (const r of recs) {
  const msgs = [...(r.新日志 || [])];
  if (r.完整状态) { try { for (const l of (JSON.parse(r.完整状态).logs || [])) msgs.push('Q' + l.q + ' ' + l.msg); } catch {} }
  for (const m of msgs) if (!seen.has(m)) { seen.add(m); evs.push(m); }
}
const cnt = re => evs.filter(m => re.test(m)).length;

/* ── 1. 走格子的骰子分布（验证 d12 生效） ──
   ⚠️ 必须**从落点反推**，不能用日志正则：日志里 `掷出 X+Y=Z` 是**风险投资卡**的格式
   （那张卡永远 2d6），用它判断骰子模式会得出"d12 没生效"的错误结论（踩过这个坑）。 */
P(`\n【1】走格子骰子分布 —— 验证 diceMode 生效（从落点反推）`);
{
  const steps = [];
  for (let i = 1; i < recs.length; i++) {
    const A = recs[i - 1].players, B = recs[i].players;
    if (!A || !B) continue;
    for (let s = 0; s < A.length; s++) {
      if (!A[s] || !B[s]) continue;
      const d = (B[s].pos - A[s].pos + 40) % 40;
      if (d >= 1 && d <= 12) steps.push(d);
    }
  }
  if (steps.length >= 20) {
    const c = {}; steps.forEach(d => c[d] = (c[d] || 0) + 1);
    const vals = Object.keys(c).map(Number).sort((a, b) => a - b);
    P(`   样本 ${steps.length} 个，范围 ${vals[0]}~${vals[vals.length - 1]}`);
    P(`   分布: ${vals.map(v => v + ':' + (c[v] / steps.length * 100).toFixed(1) + '%').join(' ')}`);
    if (c[1]) {
      const dev = Math.max(...vals.map(v => Math.abs(c[v] / steps.length - 1 / 12)));
      P(`   含 1 → 只能是 d12（2d6 掷不出 1）。最大偏离 1/12 = ${(dev * 100).toFixed(1)}%`);
      P(`   → 判定: ${dev < 0.09 ? '✓ d12 等概率生效' : '⚠ 范围像 d12 但样本偏少'}`);
    } else {
      P(`   没有 1，点数从 ${vals[0]} 起 → 仍是 2d6（钟形）✗ diceMode 没生效`);
    }
    P(`   注：快照每 800ms 一次，快速连走会被合并，所以样本数少于真实掷骰次数。`);
  } else {
    P(`   （落点样本只有 ${steps.length} 个，不足以判断）`);
  }
}
/* 顺带把"风险投资卡"的骰子单独报一下，它永远是 2d6 */
{
  const vcRolls = [];
  for (const m of evs) {
    const x = m.match(/买下风险投资卡，掷出 (\d+)\+(\d+)=(\d+)/);
    if (x) vcRolls.push(+x[3]);
  }
  if (vcRolls.length) P(`   （对照）风险投资卡开奖 ${vcRolls.length} 次，点数范围 ${Math.min(...vcRolls)}~${Math.max(...vcRolls)} —— 它永远是 2d6，不算走格子）`);
}

/* ── 2. 每回合升级次数（验证 upgradesPerTurn） ── */
P(`\n【2】每回合盖楼次数 —— 验证 upgradesPerTurn=1`);
const upM = evs.map(m => m.match(/Q(\d+)\s+(.+?) 把 (.+?) 升级为/)).filter(Boolean);
const upPerTurn = {};
for (const m of upM) { const k = m[1] + '|' + m[2]; upPerTurn[k] = (upPerTurn[k] || 0) + 1; }
const over = Object.entries(upPerTurn).filter(([, n]) => n > 1);
P(`   盖楼共 ${upM.length} 次，涉及 ${Object.keys(upPerTurn).length} 个「季度+人」`);
if (over.length) P(`   ★ 有 ${over.length} 次单回合盖了多栋：${over.slice(0, 5).map(([k, n]) => k + '=' + n).join(', ')}`);
else P(`   → ✓ 没有任何人单回合盖楼超过 1 次（上限生效，或本来就没人想连盖）`);

/* ── 3. 风险投资卡（验证 venturePerTurn=1） ── */
P(`\n【3】风险投资卡 —— 验证 venturePerTurn=1`);
const vc = evs.map(m => m.match(/Q(\d+)\s+🎲 (.+?) 买下风险投资卡/)).filter(Boolean);
const vcPerTurn = {};
for (const m of vc) { const k = m[1] + '|' + m[2]; vcPerTurn[k] = (vcPerTurn[k] || 0) + 1; }
const vcOver = Object.entries(vcPerTurn).filter(([, n]) => n > 1);
P(`   共买 ${vc.length} 张`);
if (vc.length) {
  const byP = {};
  for (const m of vc) byP[m[2]] = (byP[m[2]] || 0) + 1;
  P(`   各人张数: ${Object.entries(byP).map(([k, v]) => k + ' ' + v + ' 张').join('  ')}`);
  P(`   对照：改动前 NFYD 一局被刷 304 张（其中一人 198 张）`);
}
if (vcOver.length) P(`   ★ 有 ${vcOver.length} 次单回合买多张：${vcOver.slice(0, 5).map(([k, n]) => k + '=' + n).join(', ')}`);
else P(`   → ✓ 没有单回合超买`);

/* ── 4. 垄断（验证 monopolyShare=2/3） ── */
P(`\n【4】垄断 —— 验证 monopolyShare=2/3`);
const wf = recs.filter(r => r.完整状态).pop();
if (wf) {
  const g = JSON.parse(wf.完整状态);
  const grp = {};
  for (const t of g.tiles) { if (t.type === 'land' && t.group) (grp[t.group] = grp[t.group] || []).push(t.owner); }
  let mono = 0;
  for (const [k, v] of Object.entries(grp)) {
    const owners = v.map(o => o < 0 ? '空' : o);
    let tag = '';
    for (const pid of [0, 1, 2, 3]) {
      const have = v.filter(o => o === pid).length;
      if (have > 0 && have >= Math.ceil(v.length * 2 / 3)) { tag = ` ← 玩家${pid} 垄断(2/3)`; mono++; }
    }
    P(`   ${k.padEnd(10)} ${owners.join('-')}${tag}`);
  }
  P(`   → 结束时垄断 ${mono} 个地区   对照：改动前真人三局全是 0 个`);
}

/* ── 5. 地产售出率（群聊抱怨"两小时还有不少地没买"） ── */
P(`\n【5】地产售出率 —— 群聊关注的"地买不完"`);
if (wf) {
  const g = JSON.parse(wf.完整状态);
  const lands = g.tiles.filter(t => t.type === 'land');
  const owned = lands.filter(t => t.owner >= 0);
  P(`   ${owned.length} / ${lands.length} = ${(owned.length / lands.length * 100).toFixed(0)}%`);
  P(`   对照：AI 35 季约 89%`);
}

/* ── 6. 格子访问分布（验证"d12 让覆盖更均匀"这个说法） ── */
P(`\n【6】格子访问分布 —— 检验"有些格子走不到"`);
const posSeq = recs.filter(r => r.players && r.players.length).map(r => r.players.map(p => p.pos));
const visits = new Array(40).fill(0);
for (let i = 1; i < posSeq.length; i++) {
  for (let s = 0; s < posSeq[i].length; s++) {
    if (posSeq[i - 1][s] !== posSeq[i][s]) visits[posSeq[i][s]]++;
  }
}
const tot2 = visits.reduce((a, b) => a + b, 0);
if (tot2 > 50) {
  const mean = tot2 / 40;
  const sd = Math.sqrt(visits.reduce((a, x) => a + (x - mean) ** 2, 0) / 40);
  const mn = Math.min(...visits), mx = Math.max(...visits);
  P(`   共 ${tot2} 次落点，平均 ${mean.toFixed(0)}/格，最少 ${mn}，最多 ${mx}，极差 ${(mx / Math.max(1, mn)).toFixed(2)}×，变异系数 ${(sd / mean * 100).toFixed(1)}%`);
  P(`   对照实测：2d6 变异系数 9.1%、d12 8.5%（几乎无差别 —— 棋盘是环，长期访问自然均匀）`);
} else P('   （落点样本太少，无法统计）');

/* ── 7. 追缴 / 破产 / 出局 ── */
P(`\n【7】高潮机制有没有发生`);
P(`   追缴 ${cnt(/追缴/)} 条 ｜ 强制收地 ${cnt(/银行收走|强制收/)} 条 ｜ 破产 ${cnt(/破产|出局/)} 条`);
P(`   对照：改动前真人三局全部是 0 / 0 / 0`);

/* ── 8. 玩家决策时长 ── */
P(`\n【8】决策时长（季度推进速度）`);
const t0 = new Date(recs[0].t).getTime(), t1 = new Date(recs[recs.length - 1].t).getTime();
const q0 = recs[0].q, q1 = recs[recs.length - 1].q;
const mins = (t1 - t0) / 60000;
if (q1 > q0) {
  P(`   ${mins.toFixed(1)} 分钟推进了 ${q1 - q0} 个季度 = ${(mins / (q1 - q0)).toFixed(2)} 分钟/季度`);
  P(`   按此速度 35 季度需要 ${(mins / (q1 - q0) * 35).toFixed(0)} 分钟（设计目标 120 分钟）`);
}

/* ── 9. 结算资产构成 ── */
if (wf) {
  const g = JSON.parse(wf.完整状态);
  P(`\n【9】结束时资产构成`);
  P(`   ${'玩家'.padEnd(14)}${'现金'.padStart(9)}${'地(等级)'.padStart(11)}${'持股'.padStart(7)}  存活`);
  for (const p of g.players) {
    const mine = g.tiles.filter(t => t.owner === p.id);
    const lv = mine.reduce((a, t) => a + t.level, 0);
    const sh = Object.values(p.stocks || {}).reduce((a, b) => a + b, 0);
    P(`   ${String(p.name).padEnd(14)}${String(Math.round(p.cash)).padStart(9)}${String(mine.length + '(' + lv + ')').padStart(11)}${String(sh).padStart(7)}  ${p.alive ? '是' : '否'}`);
  }
}
P('');
