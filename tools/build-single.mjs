/* 把 index.html + styles.css + src/*.js 打成**一个** HTML 文件。
 * 用法：node tools/build-single.mjs
 * 产物：dist/地产股神.html —— 双击即玩，可以直接发给别人（微信/邮件/U盘都行）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const SRC_FILES = ['src/data.js', 'src/engine.js', 'src/ai.js', 'src/ui.js', 'src/net.js', 'src/main.js'];

let html = read('index.html');

/* 0. 内联 assets/ 下的图片资源（有就内联，没有就回退到程序生成的 SVG 徽记） */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function inlineDir(sub) {
  const dir = path.join(root, 'assets', sub);
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const ext = path.extname(f).toLowerCase();
    if (!MIME[ext]) continue;
    const key = path.basename(f, ext);
    out[key] = `data:${MIME[ext]};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;
  }
  return out;
}
const avatarData = inlineDir('avatars');
const elemData = inlineDir('elements');

/* 1. 内联 CSS */
const css = read('styles.css').trim();
const linkTag = '<link rel="stylesheet" href="styles.css">';
if (!html.includes(linkTag)) throw new Error('index.html 里找不到 ' + linkTag);
html = html.replace(linkTag, '<style>\n' + css + '\n</style>');

/* 2. 内联 JS（顺序不能变：data → engine → ai → ui → net → main） */
for (const f of SRC_FILES) {
  const tag = '<script src="' + f + '"></script>';
  if (!html.includes(tag)) throw new Error('index.html 里找不到 ' + tag);
  const code = read(f).replace(/<\/script>/gi, '<\\/script>').trim();
  let block = '<script>\n/* ══════ ' + f + ' ══════ */\n';
  if (f === 'src/ui.js') {
    if (Object.keys(avatarData).length) block += 'window.AVATAR_DATA = ' + JSON.stringify(avatarData) + ';\n';
    if (Object.keys(elemData).length) block += 'window.ELEM_DATA = ' + JSON.stringify(elemData) + ';\n';
  }
  block += code + '\n</script>';
  html = html.replace(tag, block);
}

/* 3. 打上来源标记，并确认没有任何外链残留 */
html = html.replace('<!DOCTYPE html>',
  '<!DOCTYPE html>\n<!-- 地产股神 v0.10 单文件版 · 由 tools/build-single.mjs 从 src/ 打包生成，请勿直接改这个文件 -->');
const leftover = html.match(/<script src=|<link[^>]+stylesheet/g);
if (leftover) throw new Error('还有未内联的外部资源：' + leftover.join(', '));

const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, '地产股神.html');
fs.writeFileSync(out, html);
const nAva = Object.keys(avatarData).length, nEl = Object.keys(elemData).length;
console.log(`打包完成：${out}`);
console.log(`大小 ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB，双击即可打开，不依赖任何其它文件。`);
console.log(nAva ? `已内联 ${nAva} 张角色头像：${Object.keys(avatarData).join(', ')}`
  : 'assets/avatars/ 里还没有图片，棋盘上显示的是元素徽记（丢图片进去再打包即可替换）。');
console.log(nEl ? `已内联 ${nEl} 个元素徽记：${Object.keys(elemData).join(', ')}`
  : 'assets/elements/ 里还没有图片，元素徽记用程序生成的 SVG。');
