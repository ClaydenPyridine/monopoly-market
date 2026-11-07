/* 从 Edge localStorage(leveldb) 里抠《地产股神》存档。
 * ★ 关键：Chromium 的 localStorage **值是 UTF-16LE** 编码的（键是 UTF-8），
 *   之前用 UTF-8 解所以只找到 key、读不出 JSON。只读，不碰浏览器文件。
 * 用法：node tools/extract-save.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const KEY8 = 'dizhu-gushen-save-v1';
const roots = [
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/User Data'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data'),
];
const dirs = [];
for (const r of roots) {
  if (!fs.existsSync(r)) continue;
  for (const d of fs.readdirSync(r)) {
    if (!/^(Default|Profile \d+)$/.test(d)) continue;
    const ls = path.join(r, d, 'Local Storage', 'leveldb');
    if (fs.existsSync(ls)) dirs.push(ls);
  }
}
if (!dirs.length) { console.log('没找到浏览器的 localStorage 目录'); process.exit(0); }

/* 括号配平，从 '{"' 起解析出完整 JSON */
function grab(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < Math.min(s.length, start + 4_000_000); j++) {
    const c = s[j];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, j + 1); }
  }
  return null;
}

let best = null;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ldb') && !f.endsWith('.log')) continue;
    let buf; try { buf = fs.readFileSync(path.join(dir, f)); } catch { continue; }
    /* 两种编码都试 */
    for (const [enc, key] of [['utf16le', KEY8], ['utf8', KEY8]]) {
      const s = buf.toString(enc);
      let from = 0;
      for (;;) {
        const i = s.indexOf(key, from);
        if (i < 0) break;
        from = i + 1;
        const b = s.indexOf('{', i + key.length);
        if (b < 0) continue;
        const raw = grab(s, b);
        if (!raw) continue;
        let o; try { o = JSON.parse(raw); } catch { continue; }
        if (!o.players || !o.tiles) continue;
        if (!best || raw.length > best.raw.length) best = { raw, o, from: path.join(dir, f), enc };
      }
    }
  }
}

if (!best) { console.log('没找到有效存档（可能值被 LevelDB 压缩了，或游戏在别的浏览器）'); process.exit(0); }

const out = path.join(process.cwd(), 'saves', 'local-latest.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, best.raw);
console.log(`✓ 已提取 → saves/local-latest.json  (${(best.raw.length / 1024).toFixed(1)} KB, ${best.enc})`);
console.log(`  来源 ${best.from}`);

const g = best.obj;
const total = (g.config && g.config.maxQuarters) || '?';
console.log(`\n季度 ${g.quarter} / ${total}   阶段 ${g.phase}   指数 ${g.rei != null ? g.rei.toFixed(1) : '?'}   结束 ${!!g.over}`);
console.log('\n玩家：');
for (const p of g.players) {
  const lands = g.tiles.filter(t => t.owner === p.id);
  const lv = lands.reduce((a, t) => a + t.level, 0);
  const sh = Object.values(p.stocks || {}).reduce((a, b) => a + b, 0);
  console.log(`  ${String(p.name).padEnd(12)} 现金 ¥${String(Math.round(p.cash)).padStart(8)}  地 ${String(lands.length).padStart(2)}块(等级和${String(lv).padStart(2)})  持股 ${String(sh).padStart(3)}  存活 ${p.alive ? '是' : '否'}`);
}
console.log('\n地区归属（地块序号顺序）：');
const mono = {};
for (const t of g.tiles) { if (t.type === 'land' && t.group) (mono[t.group] = mono[t.group] || []).push(t.owner); }
for (const [k, v] of Object.entries(mono)) {
  const owners = v.map(o => o < 0 ? '空' : o);
  const uniq = new Set(v.filter(o => o >= 0));
  let tag = '';
  for (const pid of [0, 1, 2, 3]) {
    const have = v.filter(o => o === pid).length;
    if (have > 0 && have >= Math.ceil(v.length * 2 / 3)) tag = `  ← 玩家${pid} 垄断`;
  }
  console.log(`  ${k.padEnd(10)} ${owners.join('-')}${tag}`);
}
console.log(`\n事件日志（最后 12 条）：`);
for (const l of (g.logs || []).slice(-12)) console.log(`  Q${l.q} ${l.msg}`);
