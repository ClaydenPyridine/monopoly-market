/* 启动 cloudflared 快速隧道，并把公网网址单独醒目地打出来。
 * 用法：node tools/tunnel.mjs [端口]
 *
 * 为什么要包一层：cloudflared 原生日志把网址混在 INF 行里，普通人很容易复制错；
 * 而且它的启动日志里先前出现过 api.trycloudflare.com 这类干扰项，
 * 所以必须**等 "quick Tunnel has been created" 这行出现之后**再取网址。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.argv[2] || '8787';
const exe = path.join(root, 'cloudflared.exe');

console.log('');
console.log('  正在建立公网隧道，请等 10~20 秒（第一次会慢一点）…');
console.log('');

const proc = spawn(exe, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const MARK = 'quick Tunnel has been created';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

let found = false;
let buffer = '';
const tail = [];          // 只留最后几行，失败时打出来帮助排查

function scan(chunk) {
  const s = chunk.toString();
  s.split('\n').forEach(l => { if (l.trim()) tail.push(l.trim()); });
  while (tail.length > 12) tail.shift();
  if (found) return;

  buffer += s;
  const i = buffer.indexOf(MARK);
  if (i < 0) return;                       // 还没到"创建成功"那行，看到网址也不算数
  const m = buffer.slice(i).match(URL_RE);
  if (!m) return;

  found = true;
  const url = m[0];
  const lines = [
    '',
    '  ╔════════════════════════════════════════════════════════════════╗',
    '  ║                                                                ║',
    '  ║   把下面这一整行，原样复制发给朋友：                            ║',
    '  ║                                                                ║',
    `  ║   ${url.padEnd(60)} ║`,
    '  ║                                                                ║',
    '  ║   朋友：点开这个网址 → 联机对战 → 输房间号 → 加入房间           ║',
    '  ║   你： 本机浏览器点「联机对战 → 创建房间」，把房间号也发过去     ║',
    '  ║                                                                ║',
    '  ║   ! 两个黑窗口都别关；关掉任何一个，朋友都会掉线。             ║',
    '  ║   ! 这个网址是公开的，别发到公开群里；玩完关掉窗口即可。       ║',
    '  ║                                                                ║',
    '  ╚════════════════════════════════════════════════════════════════╝',
    '',
  ];
  console.log(lines.join('\n'));
}

proc.stdout.on('data', scan);
proc.stderr.on('data', scan);

proc.on('error', (e) => {
  console.log('');
  console.log('  启动 cloudflared 失败：' + e.message);
  console.log('  确认 cloudflared.exe 就在游戏文件夹里。');
});

proc.on('exit', (code) => {
  console.log('');
  if (!found) {
    console.log('  ✗ 隧道没能建立（退出码 ' + code + '）。最后几行日志：');
    tail.forEach(l => console.log('    ' + l));
    console.log('');
    console.log('  常见原因：本机连不上 Cloudflare（换网络/关代理再试）、');
    console.log('            或 cloudflared.exe 不在游戏文件夹里。');
  } else {
    console.log('  隧道已关闭（退出码 ' + code + '）。朋友那边会掉线。');
  }
  console.log('  直接关掉这个窗口即可。');
});

process.on('SIGINT', () => { try { proc.kill(); } catch (e) {} process.exit(0); });
