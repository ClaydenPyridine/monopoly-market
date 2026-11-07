/* 今晚所有联机对局的汇总分析：从录制文件里把关键指标全捞出来。
 * 用法：node tools/night-report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs');

const payOf = t => t <= 3 ? 0 : t <= 5 ? 2000 : t <= 8 ? 3200 : t <= 10 ? 4500 : t === 11 ? 13000 : 26000;

const files = fs.readdirSync(dir).filter(f => f.startsWith('对局-') && f.endsWith('.jsonl'))
  .map(f => ({ f, s: fs.statSync(path.join(dir, f)).size }))
  .filter(x => x.s > 5000).sort((a, b) => a.s - b.s);

const out = [];
const P = (s = '') => out.push(s);

for (const { f, s } of files) {
  const room = (f.match(/对局-([A-Z0-9]{4})/) || [])[1];
  const recs = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!recs.length) continue;

  /* 去重收集所有日志 */
  const seen = new Set(); const evs = [];
  for (const r of recs) {
    const msgs = [...(r.新日志 || [])];
    if (r.完整状态) { try { for (const l of (JSON.parse(r.完整状态).logs || [])) msgs.push('Q' + l.q + ' ' + l.msg); } catch {} }
    for (const raw of msgs) { if (!seen.has(raw)) { seen.add(raw); evs.push(raw); } }
  }

  const t0 = new Date(recs[0].t), t1 = new Date(recs[recs.length - 1].t);
  const mins = Math.round((t1 - t0) / 60000);
  const last = recs[recs.length - 1];
  const first = recs[0];

  const grants = evs.filter(m => m.includes('后台给'));
  const grantTotal = grants.reduce((a, m) => { const x = m.match(/发放 \+?(-?[\d,]+)/); return a + (x ? +x[1].replace(/,/g, '') : 0); }, 0);
  const takeover = evs.filter(m => m.includes('已由电脑接管')).length;
  const back = evs.filter(m => m.includes('回来了，重新接管')).length;
  const timeouts = evs.filter(m => m.includes('超时未操作')).length;
  const venture = evs.filter(m => m.includes('买下风险投资卡')).map(m => {
    const x = m.match(/🎲 (.+?) 买下风险投资卡，掷出 (\d)\+(\d)=(\d+)：/);
    return x ? { name: x[1], total: +x[4] } : null;
  }).filter(Boolean);
  const vcDelta = venture.reduce((a, c) => a + payOf(c.total) - 4000, 0);
  const rents = evs.filter(m => m.includes('需付租金'));
  const taxes = evs.filter(m => m.includes('缴纳物业税'));
  const rentSum = rents.reduce((a, m) => { const x = m.match(/需付租金 ¥([\d,]+)/); return a + (x ? +x[1].replace(/,/g, '') : 0); }, 0);
  const taxSum = taxes.reduce((a, m) => { const x = m.match(/缴纳物业税 ¥([\d,]+)/); return a + (x ? +x[1].replace(/,/g, '') : 0); }, 0);

  P(`### 房间 ${room}`);
  P();
  P(`| 项目 | 数据 |`);
  P(`|---|---|`);
  P(`| 录制区间 | ${t0.toTimeString().slice(0, 8)} ~ ${t1.toTimeString().slice(0, 8)}（${mins} 分钟）|`);
  P(`| 覆盖季度 | Q${first.q} → Q${last.q} |`);
  P(`| 玩家 | ${last.players.map(p => p.n + (p.ai ? '(电脑)' : '')).join('、')} |`);
  P(`| 快照 / 事件 | ${recs.length} 条 / ${evs.length} 条 |`);
  P(`| **人工发钱** | **${grants.length} 次，合计 ¥${grantTotal.toLocaleString('en-US')}** |`);
  P(`| 掉线托管 / 接管回来 | ${takeover} 次 / ${back} 次 |`);
  P(`| 超时自动操作 | ${timeouts} 次 |`);
  P(`| 风险投资卡 | ${venture.length} 张，净 ${vcDelta >= 0 ? '+' : ''}¥${vcDelta.toLocaleString('en-US')} |`);
  P(`| 收租 / 物业税 | ¥${rentSum.toLocaleString('en-US')} / ¥${taxSum.toLocaleString('en-US')}（${(rentSum / Math.max(1, taxSum)).toFixed(2)} 倍）|`);
  P(`| 最终净资产 | ${last.players.slice().sort((a, b) => b.net - a.net).map(p => `${p.n} ¥${p.net.toLocaleString('en-US')}`).join(' ｜ ')} |`);
  P();
  if (grants.length) {
    P('**人工发钱明细：**');
    P();
    for (const g of grants) P(`- ${g.replace(/^Q\d+\s*/, '')}`);
    P();
  }
}

console.log(out.join('\n'));
fs.writeFileSync(path.join(root, 'docs', '_night-raw.md'), out.join('\n'));
