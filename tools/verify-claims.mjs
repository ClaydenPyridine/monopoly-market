/* 核实那份"机制问题反馈"里的数据主张。用法：node tools/verify-claims.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs');
const files = fs.readdirSync(dir).filter(f => f.startsWith('对局-') && f.endsWith('.jsonl'))
  .map(f => ({ f, s: fs.statSync(path.join(dir, f)).size })).filter(x => x.s > 5000);

const P = console.log;
const ROOMS = { NH8N: 'https://x', EW85: 'https://x', NFYD: 'https://x' };

for (const { f } of files) {
  const room = (f.match(/对局-([A-Z0-9]{4})/) || [])[1];
  const recs = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const seen = new Set(); const evs = [];
  for (const r of recs) {
    const msgs = [...(r.新日志 || [])];
    if (r.完整状态) { try { for (const l of (JSON.parse(r.完整状态).logs || [])) msgs.push('Q' + l.q + ' ' + l.msg); } catch {} }
    for (const m of msgs) if (!seen.has(m)) { seen.add(m); evs.push(m); }
  }
  const count = re => evs.filter(m => re.test(m)).length;

  P(`\n════ ${room} ════`);

  /* 1. 事件格（宝箱/深渊）到底触发几次 */
  P(`【主张1】事件格被架空、卡片事件触发 0 次`);
  P(`   宝箱格触发（抽事件卡）: ${count(/抽到|宝箱.*获得|翻开/) } 条含"抽到"的日志`);
  P(`   事件卡相关日志样本:`);
  evs.filter(m => /宝箱|深渊|事件卡/.test(m)).slice(0, 4).forEach(m => P(`     ${m.slice(0, 78)}`));

  /* 2. 垄断 */
  const wf = recs.filter(r => r.完整状态).pop();
  P(`【主张2】真人局几乎无人垄断`);
  if (wf) {
    const g = JSON.parse(wf.完整状态);
    const byGroup = {};
    for (const t of g.tiles) {
      if (t.type !== 'land' || t.group == null) continue;
      (byGroup[t.group] = byGroup[t.group] || []).push(t.owner);
    }
    let mono = 0, detail = [];
    for (const [grp, owners] of Object.entries(byGroup)) {
      const o = owners[0];
      if (o >= 0 && owners.every(x => x === o)) { mono++; detail.push(`${grp}=${g.players[o].name}`); }
    }
    P(`   地区总数 ${Object.keys(byGroup).length}，被垄断 ${mono} 个 ${detail.length ? '(' + detail.join(',') + ')' : ''}`);
    P(`   各地区归属: ${Object.entries(byGroup).map(([k, v]) => k + ':' + v.map(x => x < 0 ? '空' : x).join('')).join('  ')}`);
  }

  /* 3. REI 范围（触底30/触顶400 到底可不可达） */
  const reis = recs.map(r => r.rei).filter(x => typeof x === 'number');
  if (reis.length) {
    P(`【主张3】REI 触底 30 / 触顶 400 是死机制`);
    P(`   实测 REI 范围: ${Math.min(...reis).toFixed(1)} ~ ${Math.max(...reis).toFixed(1)}  （全 ${reis.length} 个采样）`);
  }

  /* 4. 出局 / 追缴 */
  P(`【主张4】真人局零出局`);
  P(`   追缴日志 ${count(/追缴/)} 条、强制收地 ${count(/银行收走|强制收/)} 条、破产 ${count(/破产|出局/)} 条`);

  /* 5. 最大一笔股票买入 */
  let maxBuy = null;
  for (const r of recs) {
    for (const m of (r.新日志 || [])) {
      const x = m.match(/买入 (\S+?[^\d]*?) (\d+) 股.*?花费 ¥([\d,]+)/);
      if (x) { const sh = +x[2]; if (!maxBuy || sh > maxBuy.sh) maxBuy = { sh, name: x[1].trim(), cost: x[3], q: r.q }; }
    }
  }
  if (maxBuy) P(`【主张5】"一口气买 784 股"   实测最大单笔: ${maxBuy.sh} 股 ${maxBuy.name}（Q${maxBuy.q}，¥${maxBuy.cost}）`);

  /* 6. 死机制 */
  P(`【主张6】死机制：退市 ${count(/退市/)} / 黑天鹅 ${count(/黑天鹅/)} / 强势反弹 ${count(/强势反弹/)} / 指数熔断 ${count(/熔断/)}`);
}
