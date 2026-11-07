#!/usr/bin/env node
/* ============================================================
 * tools/audit-layout.mjs —— 《地产股神》布局缺陷审计 · 真实测量工具
 *
 * 干什么：用 headless Edge + CDP（Chrome DevTools Protocol）把游戏**真的跑起来**，
 *         在 7 种常规分辨率 + 6 个媒体查询断点探针 × 33 种界面状态下注入测量脚本，量出：
 *           · 内容溢出：scrollHeight > clientHeight + 2（且 overflow 不是滚动容器）
 *           · 真·文字压叠：两个文本节点的可见矩形相交（先按祖先 overflow 与视口裁剪）
 *           · 元素遮挡：两个"有底/有边"的盒子矩形相交（排除祖先、被裁掉的部分、上层遮罩）
 *           · 截断：text-overflow: ellipsis 真的把字截掉了
 *           · 裁剪：overflow:hidden 的容器把文本切掉了（含"可见高度只剩 ch/sh%"）
 *           · 出界：可见元素跑出视口
 *           · 滚动不可达：滚动容器起始边被切且滚不回来
 *           · 布局抖动：动画有没有把元素顶动（--jitter）
 *         每个场景顺手存一张截图（默认 %TEMP%\layout-audit\）。
 *
 * 为什么不改 HTML：CDP 的 Runtime.evaluate 能在页面里执行任意 JS，
 *         等价于"在 </body> 前插一段 <script>"，但**不用碰 dist 产物**。
 *         想手动复现：把 MEASURE 那段贴进 DevTools Console 回车即可（--emit-js 导出）。
 *
 * ★ 三个必须做、否则数据是错的工程处理（都有注释详述）：
 *   1) 测量前 cancel 掉所有 CSS 动画 —— headless 无合成帧时动画停在 @keyframes 的 from 状态，
 *      会把 19px 的棋子量成 3.8px（scale(.2)）。用 --no-freeze-anim 关闭。
 *   2) 每次新文档清 localStorage['dgs-center-mini'] —— 否则跑过 ?mini=1 后所有场景都被污染。
 *   3) 注入 act 前等"就绪闸门"（UI 已定义 + readyState complete + 格子已建好）。
 *
 * 用法（详见 docs\布局缺陷审计.md）：
 *   node tools/audit-layout.mjs                          # 全矩阵（7 分辨率 × 33 场景）
 *   node tools/audit-layout.mjs --probe                  # 只跑媒体查询断点探针分辨率
 *   node tools/audit-layout.mjs --scenario=drawer-market --viewport=1280x720
 *   node tools/audit-layout.mjs --scenario=tokens-4 --jitter          # 加动画抖动采样
 *   node tools/audit-layout.mjs --eval="document.getElementById('slots').scrollWidth"  # 定点诊断
 *   node tools/audit-layout.mjs --crop=325,150,200,90 --crop-scale=5  # 放大局部截图
 *   node tools/audit-layout.mjs --list                   # 只列场景 / 分辨率
 *   node tools/audit-layout.mjs --out=D:\tmp\shots       # 截图目录
 *   node tools/audit-layout.mjs --json=D:\tmp\raw.json   # 原始数据落盘
 *   node tools/audit-layout.mjs --emit-js=measure.js     # 导出测量脚本成独立 .js
 *   node tools/audit-layout.mjs --port=9411 --out=...    # 换端口即可并行开多个浏览器
 *   node tools/audit-layout.mjs --keep-open              # 跑完不关浏览器（调试）
 * 环境变量：EDGE_PATH 覆盖 msedge.exe 路径；PAGE 覆盖被测 HTML 路径。
 * ============================================================ */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_PAGE = path.join(ROOT, 'dist', '地产股神.html');
const TMP = path.join(os.tmpdir(), 'layout-audit');

/* ───────────────────────── 命令行参数 ───────────────────────── */
function arg(name, def) {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--' + name) return (i + 1 < a.length && !a[i + 1].startsWith('--')) ? a[i + 1] : true;
    if (a[i].startsWith('--' + name + '=')) return a[i].slice(name.length + 3);
  }
  return def;
}
const hasFlag = (n) => arg(n, undefined) !== undefined;

const EDGE = process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = process.env.PAGE || arg('page', DEFAULT_PAGE);
const OUT_DIR = String(arg('out', TMP));
const JSON_PATH = arg('json', path.join(OUT_DIR, 'audit-raw.json'));
const PORT = parseInt(arg('port', '9333'), 10);
const ONLY_SCEN = arg('scenario', null);
const ONLY_VP = arg('viewport', null);
/* 允许逗号分隔多个：--viewport=1280x720,1366x768 --scenario=mini,longname */
const splitList = (v) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null);
const ONLY_SCEN_LIST = splitList(ONLY_SCEN);
const ONLY_VP_LIST = splitList(ONLY_VP);
const SETTLE_SCALE = parseFloat(arg('settle', '1')) || 1;
/* --crop=x,y,w,h --crop-scale=N：把截图裁到指定区域并放大 N 倍，用于肉眼复核字是否真压在一起 */
const CROP = arg('crop', null);
const CROP_SCALE = parseFloat(arg('crop-scale', '4')) || 4;
/* --jitter：跑完常规测量后再采 6 次矩形，报动画造成的布局位移 */
const JITTER = hasFlag('jitter');
/* --no-freeze-anim：不结算 CSS 动画（默认结算，见 FREEZE_SRC 的说明） */
const NO_FREEZE = hasFlag('no-freeze-anim');
/* --probe：只跑媒体查询断点探针分辨率 × PROBE_SCENARIOS */
const PROBE_MODE = hasFlag('probe');

/* ───────────────────────── 分辨率 ───────────────────────── */
const VIEWPORTS = [
  { id: '1920x1080', w: 1920, h: 1080 },
  { id: '1600x940', w: 1600, h: 940 },
  { id: '1440x820', w: 1440, h: 820 },
  { id: '1366x768', w: 1366, h: 768 },
  { id: '1280x720', w: 1280, h: 720 },
  { id: '1024x768', w: 1024, h: 768 },
  { id: '900x700', w: 900, h: 700 },
  /* ★ 媒体查询断点边界探针：styles.css 有 max-height:860px（砍价格）和
     max-height:700px（砍头像）。断点"半开半关"的怪状态要在这几个高度上抓。 */
  { id: '1440x861', w: 1440, h: 861, probe: 'bp-860-上' },
  { id: '1440x860', w: 1440, h: 860, probe: 'bp-860-命中' },
  { id: '1440x859', w: 1440, h: 859, probe: 'bp-860-下' },
  { id: '1440x701', w: 1440, h: 701, probe: 'bp-700-上' },
  { id: '1440x700', w: 1440, h: 700, probe: 'bp-700-命中' },
  { id: '1440x699', w: 1440, h: 699, probe: 'bp-700-下' },
];
const VIEWPORTS_MAIN = VIEWPORTS.filter(v => !v.probe).map(v => v.id);
const VIEWPORTS_PROBE = VIEWPORTS.filter(v => v.probe).map(v => v.id);
/* 断点探针只跑这几个最能暴露问题的场景，省时间 */
const PROBE_SCENARIOS = ['play-roll', 'mini', 'tokens-4', 'longname', 'drawer-market', 'tokens-4-drawer'];

/* ───────────────────────── 场景 ─────────────────────────
 * url   : 附加 query（auto=1 会跳过开局页直接开打）
 * act   : 加载完成后执行的 JS（点击 / 注入极端数据 / 直接调 UI 接口）
 * settle: 额外等待毫秒（turbo 模式下游戏在跑，等它把日志/资产填满）
 * ───────────────────────────────────────────────────────── */
const AUTO = 'auto=1&ai=4&q=50&turbo=0.03';
const HUMAN = 'auto=1&ai=0&human=4&q=50&turbo=0.03';

const LONG_NAME = '提瓦特超级无敌霸道总裁老王';
const SCENARIOS = [
  {
    id: 'setup', label: '开局设置页', url: '', settle: 900,
  },
  {
    id: 'setup-longname', label: '开局设置页·超长名字', url: '', settle: 900,
    act: `(function(){
      var ips = document.querySelectorAll('#slots input');
      for (var i=0;i<ips.length;i++) ips[i].value = i===0 ? '${LONG_NAME}${LONG_NAME}' : '${LONG_NAME}' + (i+1);
    })()`,
  },
  {
    id: 'lobby', label: '联机大厅', url: 'lan=1', settle: 2200,
  },
  {
    id: 'play-roll', label: '对局中·掷骰阶段', url: AUTO, settle: 4200,
  },
  {
    id: 'play-human', label: '对局中·真人回合（等掷骰）', url: HUMAN, settle: 2600,
  },
  {
    id: 'drawer-market', label: '股市抽屉展开', url: AUTO + '&drawer=market', settle: 4600,
  },
  {
    id: 'drawer-players', label: '玩家抽屉展开', url: AUTO + '&drawer=players', settle: 4600,
  },
  {
    id: 'drawer-cards', label: '金融抽屉展开', url: AUTO + '&drawer=cards', settle: 4600,
  },
  {
    id: 'menu-drawer', label: '菜单抽屉展开', url: AUTO + '&drawer=menu', settle: 4600,
  },
  {
    id: 'drawer-market-mini', label: '股市抽屉 + 中央折叠', url: AUTO + '&drawer=market&mini=1', settle: 4600,
  },
  {
    /* ★ 4 个真人全部挤在同一格：验证 .tile.has-tk 的底部留白够不够、
       棋子（flex:none, clamp(11px,1.1vw,19px)）会不会互相压叠/溢出格子、
       .tk.me::after 的白色小三角会不会被 .tile 的 overflow:hidden 裁掉。
       顺便把一整个地区判给 0 号玩家，制造真正的 .tile.mono（垄断发光 + 动画）。 */
    id: 'tokens-4', label: '极端·4人同格+垄断发光', url: HUMAN, settle: 2600,
    act: `(function(){
      var g = UI.g;
      var base = g.tiles.findIndex(function(x){ return x.type === 'land'; });
      var grp = g.tiles[base].group;
      g.tiles.forEach(function(x){ if (x.type === 'land' && x.group === grp) { x.owner = 0; x.level = 2; } });
      g.players.forEach(function(p){ p.pos = base; p.alive = true; });
      UI.renderAll();
      var tks = document.querySelectorAll('#board .tokens .tk');
      if (tks.length) tks[tks.length - 1].classList.add('me');
    })()`,
  },
  {
    id: 'tokens-4-drawer', label: '极端·4人同格+抽屉挤压棋盘', url: HUMAN + '&drawer=market', settle: 3000,
    act: `(function(){
      var g = UI.g;
      var base = g.tiles.findIndex(function(x){ return x.type === 'land'; });
      g.players.forEach(function(p){ p.pos = base; p.alive = true; });
      UI.renderAll();
      var tks = document.querySelectorAll('#board .tokens .tk');
      if (tks.length) tks[tks.length - 1].classList.add('me');
    })()`,
  },
  {
    id: 'tokens-4-mini', label: '极端·4人同格+中央折叠', url: HUMAN + '&mini=1', settle: 3000,
    act: `(function(){
      var g = UI.g;
      var base = g.tiles.findIndex(function(x){ return x.type === 'land'; });
      g.players.forEach(function(p){ p.pos = base; p.alive = true; });
      UI.renderAll();
    })()`,
  },
  {
    id: 'tokens-4-all', label: '极端·4人同格+长名+大钱+抽屉+弹窗', url: HUMAN + '&drawer=players', settle: 3000,
    act: `(function(){
      var g = UI.g;
      var base = g.tiles.findIndex(function(x){ return x.type === 'land'; });
      g.players.forEach(function(p, i){ p.pos = base; p.alive = true; p.name = i === 0 ? '${LONG_NAME}${LONG_NAME}' : '${LONG_NAME}' + (i + 1); });
      g.players[0].cash = 1234567890;
      UI.renderAll();
      var tks = document.querySelectorAll('#board .tokens .tk');
      if (tks.length) tks[tks.length - 1].classList.add('me');
      UI.rulesModal();
    })()`,
  },
  {
    id: 'mini', label: '中央面板折叠', url: AUTO + '&mini=1', settle: 5600,
  },
  {
    id: 'mini-human', label: '中央折叠 + 4 真人', url: HUMAN + '&mini=1', settle: 2600,
  },
  {
    id: 'log', label: '事件日志展开', url: AUTO, settle: 5200,
    act: `document.getElementById('log-expand').click()`,
  },
  {
    id: 'log-drawer', label: '日志展开 + 股市抽屉', url: AUTO + '&drawer=market', settle: 5200,
    act: `document.getElementById('log-expand').click()`,
  },
  {
    id: 'tile-own', label: '地块详情弹窗（有主高价地）', url: AUTO, settle: 5200,
    act: `(function(){
      var g = UI.g, best = -1, bestV = -1;
      g.tiles.forEach(function(t,i){ if (t.owner >= 0) { var v = g.assetValue(t); if (v > bestV) { bestV = v; best = i; } } });
      if (best < 0) best = g.tiles.findIndex(function(t){ return t.type === 'land'; });
      UI.tileModal(best);
    })()`,
  },
  {
    id: 'tile-empty', label: '地块详情弹窗（无主地）', url: AUTO, settle: 4200,
    act: `(function(){
      var g = UI.g;
      var i = g.tiles.findIndex(function(t){ return t.type === 'land' && t.owner < 0; });
      UI.tileModal(i < 0 ? 1 : i);
    })()`,
  },
  {
    id: 'tile-rail', label: '地块详情弹窗（传送锚点）', url: AUTO, settle: 4200,
    act: `(function(){
      var i = UI.g.tiles.findIndex(function(t){ return t.type === 'rail'; });
      UI.tileModal(i < 0 ? 5 : i);
    })()`,
  },
  {
    id: 'buy-modal', label: '买地弹窗', url: AUTO, settle: 3000,
    act: `(function(){
      var g = UI.g, p = g.cur();
      var i = g.tiles.findIndex(function(t){ return t.type === 'land' && t.owner < 0; });
      if (i < 0) i = g.tiles.findIndex(function(t){ return t.owner < 0; });
      g.pending = { type: 'buy', tileId: i, price: g.landPrice(g.tiles[i]) };
      UI.buyModal();
    })()`,
  },
  {
    id: 'event-modal', label: '事件卡弹窗', url: AUTO, settle: 3000,
    act: `(function(){
      UI.g.pending = { type: 'event', cardType: 'chance',
        event: { title: '股市熔断', text: '地产指数单日暴跌 15%。所有持有地产的玩家按当前市值缩水，抵押中的地块可能立刻触发银行追缴。' } };
      UI.eventModal();
    })()`,
  },
  {
    id: 'result-modal', label: '结算弹窗', url: AUTO, settle: 3000,
    act: `(function(){
      var g = UI.g;
      g.ranking = g.players.slice().sort(function(a,b){ return g.netWorth(b)-g.netWorth(a); })
        .map(function(p){ return { name:p.name, color:p.color, alive:p.alive, cash:p.cash,
          lands:g.ownedTiles(p.id).length, stocks:Object.keys(p.stocks||{}).length, net:g.netWorth(p) }; });
      g.winner = g.ranking[0];
      UI._resultShown = false;
      UI.showResult();
    })()`,
  },
  {
    id: 'rules-modal', label: '规则弹窗', url: AUTO, settle: 2200,
    act: `UI.rulesModal()`,
  },
  {
    id: 'assets-modal', label: '资产盘点弹窗', url: AUTO, settle: 5200,
    act: `UI.assetsModal()`,
  },
  {
    id: 'longname', label: '极端·超长玩家名', url: AUTO, settle: 5200,
    act: `(function(){
      var g = UI.g;
      g.players.forEach(function(p,i){ p.name = i===0 ? '${LONG_NAME}${LONG_NAME}${LONG_NAME}' : '${LONG_NAME}' + (i+1) + '号'; });
      UI.renderAll();
    })()`,
  },
  {
    id: 'longname-mini', label: '极端·超长名 + 中央折叠', url: AUTO + '&mini=1', settle: 5200,
    act: `(function(){
      var g = UI.g;
      g.players.forEach(function(p,i){ p.name = i===0 ? '${LONG_NAME}${LONG_NAME}${LONG_NAME}' : '${LONG_NAME}' + (i+1) + '号'; });
      UI.renderAll();
    })()`,
  },
  {
    id: 'longname-drawers', label: '极端·超长名 + 三个抽屉全开', url: AUTO, settle: 5200,
    act: `(function(){
      var g = UI.g;
      g.players.forEach(function(p,i){ p.name = i===0 ? '${LONG_NAME}${LONG_NAME}${LONG_NAME}' : '${LONG_NAME}' + (i+1) + '号'; });
      UI.renderAll();
      UI.openDrawer('players'); UI.renderPlayers();
    })()`,
  },
  {
    id: 'bigcash', label: '极端·9~10 位数现金', url: AUTO, settle: 4200,
    act: `(function(){
      var g = UI.g;
      g.players[0].cash = 987654321; g.players[1].cash = 1234567890;
      if (g.players[2]) g.players[2].cash = -87654321;
      UI.renderAll();
    })()`,
  },
  {
    id: 'bigcash-mini', label: '极端·9位数现金 + 中央折叠', url: AUTO + '&mini=1', settle: 5200,
    act: `(function(){
      var g = UI.g;
      g.players[0].cash = 987654321; g.players[1].cash = 1234567890;
      if (g.players[2]) g.players[2].cash = -87654321;
      UI.renderAll();
    })()`,
  },
  {
    id: 'stress-both', label: '极端·长名+大钱+日志展开', url: AUTO, settle: 5200,
    act: `(function(){
      var g = UI.g;
      g.players.forEach(function(p,i){ p.name = i===0 ? '${LONG_NAME}${LONG_NAME}' : '${LONG_NAME}' + (i+1); });
      g.players[0].cash = 1234567890;
      UI.renderAll();
      document.getElementById('log-expand').click();
    })()`,
  },
  {
    id: 'stress-all', label: '极端·长名+大钱+抽屉+弹窗', url: AUTO + '&drawer=market', settle: 5200,
    act: `(function(){
      var g = UI.g;
      g.players.forEach(function(p,i){ p.name = i===0 ? '${LONG_NAME}${LONG_NAME}' : '${LONG_NAME}' + (i+1); });
      g.players[0].cash = 1234567890;
      UI.renderAll();
      UI.openDrawer('players'); UI.renderPlayers();
      UI.rulesModal();
    })()`,
  },
];

/* ───────────────────────── 测量脚本（注入到页面里跑） ─────────────────────────
 * 纯 ES5 写法 + 字符串拼接，不依赖页面任何变量，可以直接贴进 DevTools Console。
 * ───────────────────────────────────────────────────────────────────────── */
const MEASURE = String.raw`
(function () {
  var MAXT = 46;
  function cut(s, n) { s = (s || '').replace(/\s+/g, ' ').trim(); n = n || MAXT;
    return s.length > n ? s.slice(0, n) + '…' : s; }
  function fx(v) { return Math.round(v * 10) / 10; }
  function rect(o) { return { x: fx(o.left), y: fx(o.top), w: fx(o.width), h: fx(o.height), R: fx(o.right), B: fx(o.bottom) }; }
  function sel(el) {
    if (!el || el.nodeType !== 1) return '?';
    var parts = [], cur = el, d = 0;
    while (cur && cur.nodeType === 1 && d < 4) {
      var s = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      var cl = (typeof cur.className === 'string' ? cur.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
      if (cl.length) s += '.' + cl.join('.');
      var p = cur.parentElement;
      if (p) { var same = [].slice.call(p.children).filter(function (c) { return c.tagName === cur.tagName; });
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')'; }
      parts.unshift(s); cur = p; d++;
    }
    return parts.join('>');
  }
  function vis(el) {
    try { return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true }); }
    catch (e) {
      var cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
    }
  }
  /* 元素被哪些祖先 / 视口裁掉了 */
  function clipBox(el) {
    var b = { x1: -1e9, y1: -1e9, x2: 1e9, y2: 1e9 }, cur = el;
    while (cur && cur.nodeType === 1) {
      var cs = getComputedStyle(cur);
      var o = cs.overflow + ',' + cs.overflowX + ',' + cs.overflowY;
      if (/hidden|auto|scroll|clip/.test(o) && cs.display !== 'inline' && !/^inline/.test(cs.display)) {
        var r = cur.getBoundingClientRect();
        b.x1 = Math.max(b.x1, r.left); b.y1 = Math.max(b.y1, r.top);
        b.x2 = Math.min(b.x2, r.right); b.y2 = Math.min(b.y2, r.bottom);
      }
      cur = cur.parentElement;
    }
    b.x1 = Math.max(b.x1, 0); b.y1 = Math.max(b.y1, 0);
    b.x2 = Math.min(b.x2, window.innerWidth); b.y2 = Math.min(b.y2, window.innerHeight);
    return b;
  }
  function clipOne(r, b) {
    var x1 = Math.max(r.left, b.x1), y1 = Math.max(r.top, b.y1);
    var x2 = Math.min(r.right, b.x2), y2 = Math.min(r.bottom, b.y2);
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1), fullW: r.width, fullH: r.height };
  }
  /* ★ 遮挡判定：矩形相交 ≠ "看起来压在一起"。
     模态框 (.modal-mask)、开局遮罩 (.overlay)、展开的日志 (#bottom.expanded)、
     抽屉 (.drawer.open)、断线横幅、toast 都是**不透明的上层**，被它们盖住的
     下层文字交叠是正常的、不是缺陷。
     做法：在交叠区中心用 elementFromPoint 取最上层元素，如果它落在某个遮罩里，
     而这两个文字**不都在同一个遮罩里**，就判为"一方被盖住"→ 不算缺陷。
     （这也顺手排除了"棋盘文字 vs 弹窗文字"这类 100% 的误报。） */
  var OVERLAYS = [];
  ['.modal-mask', '.overlay:not(.hide)', '#bottom.expanded', '#net-banner:not(.hide)',
    '.toast', '.drawer.open'].forEach(function (s) {
    var l = document.querySelectorAll(s);
    for (var i = 0; i < l.length; i++) OVERLAYS.push(l[i]);
  });
  function inOverlay(el) {
    for (var i = 0; i < OVERLAYS.length; i++) {
      var o = OVERLAYS[i];
      if (o === el || o.contains(el)) return o;
    }
    return null;
  }
  function occludedPair(A, B, x, y) {
    if (!OVERLAYS.length) return false;
    var hit = null;
    try { hit = document.elementFromPoint(x, y); } catch (e) { return false; }
    if (!hit) return false;
    var o = inOverlay(hit);
    if (!o) return false;                     // 最上层不在遮罩里 → 没有东西盖住
    return !(inOverlay(A) === o && inOverlay(B) === o);
  }

  var out = { page: {}, containers: {}, overflow: [], clipped: [], ellipsis: [], textOverlap: [], boxOverlap: [], offscreen: [], unreachable: [], counts: {} };
  var W = window.innerWidth, H = window.innerHeight;
  out.page = {
    vw: W, vh: H, dpr: window.devicePixelRatio,
    docScrollW: document.documentElement.scrollWidth, docScrollH: document.documentElement.scrollHeight,
    bodyScrollW: document.body.scrollWidth, bodyScrollH: document.body.scrollHeight,
    centerMini: !!(document.getElementById('center-grid') || {}).classList && document.getElementById('center-grid').classList.contains('mini'),
    logExpanded: !!(document.getElementById('bottom') || {}).classList && document.getElementById('bottom').classList.contains('expanded'),
    drawerOpen: [].slice.call(document.querySelectorAll('#drawers .drawer.open')).map(function (d) { return d.id; }),
    modal: (document.querySelector('#modal-root .modal') ? sel(document.querySelector('#modal-root .modal')) : null),
  };

  /* ── 1. 关键容器体检 ── */
  var KEYS = ['#app', '#topbar', '.topstats', '#ts-current', '.topactions', '#board', '#boardwrap',
    '#center', '#center-grid', '.rei-box', '#rei-value', '#turn-box', '#turn-timer', '.dice-box',
    '.mini-stats', '.asset-split', '.center-actions', '.mini-rank', '#rail', '#bottom', '#log',
    '.drawer.open', '#modal-root .modal', '.modal .m-body', '.panel-foot', '.pcard', '.stock',
    '.card-row', '.mr-row', '#setup .setup-card', '#slots', '.lobby-card', '.slot'];
  KEYS.forEach(function (k) {
    var el = document.querySelector(k);
    if (!el) { out.containers[k] = null; return; }
    var cs = getComputedStyle(el);
    out.containers[k] = {
      sel: sel(el), rect: rect(el.getBoundingClientRect()),
      cw: el.clientWidth, ch: el.clientHeight, sw: el.scrollWidth, sh: el.scrollHeight,
      disp: cs.display, ovY: cs.overflowY, ovX: cs.overflowX, fs: cs.fontSize, lh: cs.lineHeight,
      rows: cs.gridTemplateRows ? cs.gridTemplateRows.slice(0, 120) : '', visible: vis(el),
    };
  });

  /* ── 2. 内容溢出 / 裁剪 / 截断 ── */
  var all = document.body.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'PATH') continue;
    if (!vis(el)) continue;
    var cs = getComputedStyle(el);
    var disp = cs.display;
    if (disp === 'inline' && tag !== 'BUTTON' && tag !== 'INPUT') continue;
    var cw = el.clientWidth, ch = el.clientHeight, sw = el.scrollWidth, sh = el.scrollHeight;
    if (cw === 0 && ch === 0) continue;
    var txt = cut((el.textContent || '').trim(), 40);
    var hasText = !!(el.textContent || '').trim();
    var base = { sel: sel(el), rect: rect(el.getBoundingClientRect()), cw: cw, ch: ch, sw: sw, sh: sh,
      ovY: cs.overflowY, ovX: cs.overflowX, disp: disp, fs: cs.fontSize, minH: cs.minHeight,
      h: cs.height, txt: txt, visPct: sh > 0 ? Math.round(100 * ch / sh) : 100 };
    var scrollableY = /auto|scroll/.test(cs.overflowY);
    var scrollableX = /auto|scroll/.test(cs.overflowX);
    /* (a) 内容纵向溢出、且容器不滚动 → 视觉上会溢出去压到邻居 */
    if (sh > ch + 2 && !scrollableY && cs.overflowY === 'visible') {
      out.overflow.push(Object.assign({ axis: 'y', over: sh - ch, why: 'scrollHeight(' + sh + ') > clientHeight(' + ch + ')，overflow-y:visible，内容会溢出去压邻居' }, base));
    }
    if (sw > cw + 2 && cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis' && !scrollableX) {
      out.overflow.push(Object.assign({ axis: 'x', over: sw - cw, why: 'scrollWidth(' + sw + ') > clientWidth(' + cw + ')，overflow-x:visible，内容横向溢出' }, base));
    }
    /* (b) overflow:hidden 的容器把文本裁掉了 */
    if (hasText && /hidden|clip/.test(cs.overflowY) && sh > ch + 2 && el.children.length === 0) {
      out.clipped.push(Object.assign({ over: sh - ch, why: 'overflow:hidden 把文本裁掉了（scrollHeight ' + sh + ' > clientHeight ' + ch + '）' }, base));
    }
    /* (c) text-overflow: ellipsis 真的截断了 */
    if (hasText && cs.textOverflow === 'ellipsis' && cw > 0 && sw > cw + 1) {
      out.ellipsis.push(Object.assign({ over: sw - cw, why: 'ellipsis 截断：scrollWidth ' + sw + ' > clientWidth ' + cw }, base));
    }
    /* (d) line-clamp 截断 */
    if (hasText && cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && sh > ch + 2) {
      out.clipped.push(Object.assign({ over: sh - ch, why: '-webkit-line-clamp:' + cs.webkitLineClamp + ' 截断了文本（scrollHeight ' + sh + ' > clientHeight ' + ch + '）', clamp: true }, base));
    }
    /* (e) 出界：元素可见矩形跑出视口 */
    var r = el.getBoundingClientRect();
    if (r.width > 40 && r.height > 8) {
      var cb = clipBox(el);
      var visibleTooBig = (r.right > W + 2 && Math.min(r.right, cb.x2) > W + 2) || (r.bottom > H + 2 && Math.min(r.bottom, cb.y2) > H + 2);
      if (visibleTooBig) out.offscreen.push(Object.assign({ why: '元素跑出视口：right=' + fx(r.right) + ' / bottom=' + fx(r.bottom) + '，视口 ' + W + 'x' + H }, base));
    }
  }

  /* ── 3. 文本矩形两两相交 = 真·文字压叠 ── */
  var texts = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var n;
  while ((n = walker.nextNode())) {
    var tv = n.nodeValue;
    if (!tv || !tv.trim()) continue;
    var pel = n.parentElement;
    if (!pel) continue;
    var ptag = pel.tagName;
    if (ptag === 'SCRIPT' || ptag === 'STYLE' || ptag === 'NOSCRIPT') continue;
    if (!vis(pel)) continue;
    var pcs = getComputedStyle(pel);
    var box = clipBox(pel);
    var rg = document.createRange();
    try { rg.selectNodeContents(n); } catch (e) { continue; }
    var rs = rg.getClientRects();
    for (var k = 0; k < rs.length; k++) {
      var c = clipOne(rs[k], box);
      if (c.w < 2 || c.h < 2) continue;
      texts.push({ el: pel, sel: sel(pel), text: cut(tv), fs: pcs.fontSize, col: pcs.color,
        rect: { x: fx(c.x), y: fx(c.y), w: fx(c.w), h: fx(c.h) },
        clipped: (c.w < c.fullW - 1.5) });
    }
  }
  for (var a = 0; a < texts.length; a++) {
    for (var b = a + 1; b < texts.length; b++) {
      var A = texts[a], B = texts[b];
      if (A.el === B.el) continue;
      var ox1 = Math.max(A.rect.x, B.rect.x), oy1 = Math.max(A.rect.y, B.rect.y);
      var ox2 = Math.min(A.rect.x + A.rect.w, B.rect.x + B.rect.w);
      var oy2 = Math.min(A.rect.y + A.rect.h, B.rect.y + B.rect.h);
      var ow = ox2 - ox1, oh = oy2 - oy1;
      if (ow > 1 && oh > 1 && ow * oh > 4) {
        var minH = Math.min(A.rect.h, B.rect.h), minW = Math.min(A.rect.w, B.rect.w);
        /* 交叠区中心取样，确认没有第三方不透明层盖在上面 */
        var ccx = (Math.max(A.rect.x, B.rect.x) + Math.min(A.rect.x + A.rect.w, B.rect.x + B.rect.w)) / 2;
        var ccy = (Math.max(A.rect.y, B.rect.y) + Math.min(A.rect.y + A.rect.h, B.rect.y + B.rect.h)) / 2;
        if (occludedPair(A.el, B.el, ccx, ccy)) continue;
        out.textOverlap.push({
          a: A.sel, b: B.sel, at: A.text, bt: B.text,
          aRect: A.rect, bRect: B.rect, ovW: fx(ow), ovH: fx(oh), ovArea: Math.round(ow * oh),
          /* ratioV = 纵向交叠占较矮那行的比例。行盒本身含 leading，
             ratioV < .3 基本是"上下两行行盒擦边"，不是真压字；≥ .3 才可能是字压字。 */
          ratioV: +(oh / minH).toFixed(2), ratioW: +(ow / minW).toFixed(2),
          nested: (A.el.contains(B.el) || B.el.contains(A.el)),
        });
      }
    }
  }

  /* ── 4. 盒子遮挡：两边都有底/有边、都够大，且**用被裁剪后的可见矩形**比较 ──
     不裁剪会大量误报：滚动容器里滚出视口的行（如 #log 的老日志）、
     比容器高的中央面板（#center-grid）都会"看起来"压在别的元素上。 */
  var boxes = [];
  var cand = document.body.querySelectorAll('#app *, #drawers .drawer.open *, #modal-root .modal *');
  for (var q = 0; q < cand.length; q++) {
    var be = cand[q];
    if (!vis(be)) continue;
    if (be.closest('.modal-mask') && be.closest('.modal-mask') !== be && !be.classList.contains('modal')) continue;
    if (be.classList.contains('modal-mask') || be.id === 'modal-root' || be.id === 'bottom') continue;
    if (be.classList.contains('overlay')) continue;
    var bcs = getComputedStyle(be);
    if (bcs.display === 'inline') continue;
    var bg = bcs.backgroundColor;
    var m = /rgba?\(([^)]+)\)/.exec(bg);
    var alpha = 1;
    if (m) { var ps = m[1].split(','); if (ps.length === 4) alpha = parseFloat(ps[3]); }
    var hasBorder = parseFloat(bcs.borderTopWidth) > 0 && bcs.borderTopStyle !== 'none';
    var hasBg = alpha > 0.55;
    if (!hasBg && !hasBorder) continue;
    var br = be.getBoundingClientRect();
    var cbx = clipBox(be);
    var vx1 = Math.max(br.left, cbx.x1), vy1 = Math.max(br.top, cbx.y1);
    var vx2 = Math.min(br.right, cbx.x2), vy2 = Math.min(br.bottom, cbx.y2);
    var vw = vx2 - vx1, vh = vy2 - vy1;
    if (vw < 12 || vh < 12 || vw * vh < 250) continue;
    boxes.push({ el: be, sel: sel(be), z: bcs.zIndex, bg: bg, area: vw * vh,
      v: { x: fx(vx1), y: fx(vy1), w: fx(vw), h: fx(vh) }, rect: rect(br),
      txt: cut((be.textContent || '').trim(), 30) });
  }
  for (var x = 0; x < boxes.length; x++) {
    for (var y = x + 1; y < boxes.length; y++) {
      var P = boxes[x], Q = boxes[y];
      if (P.el === Q.el) continue;
      if (P.el.contains(Q.el) || Q.el.contains(P.el)) continue;
      var ix1 = Math.max(P.v.x, Q.v.x), iy1 = Math.max(P.v.y, Q.v.y);
      var ix2 = Math.min(P.v.x + P.v.w, Q.v.x + Q.v.w), iy2 = Math.min(P.v.y + P.v.h, Q.v.y + Q.v.h);
      var iw = ix2 - ix1, ih = iy2 - iy1;
      if (iw > 2 && ih > 2 && iw * ih > 80) {
        if (occludedPair(P.el, Q.el, (ix1 + ix2) / 2, (iy1 + iy2) / 2)) continue;
        out.boxOverlap.push({ a: P.sel, b: Q.sel, aRect: P.rect, bRect: Q.rect,
          aVis: P.v, bVis: Q.v, aTxt: P.txt, bTxt: Q.txt,
          ovW: fx(iw), ovH: fx(ih), ovArea: Math.round(iw * ih), aZ: P.z, bZ: Q.z });
      }
    }
  }

  /* ── 5. 滚动容器「起始边不可达」：内容比容器高、又用了 center 对齐时，
     顶端溢出部分滚不回去（CSS 里 start 方向的溢出不可滚动）→ 内容永远看不见。 ── */
  var scrollers = document.body.querySelectorAll('*');
  for (var s2 = 0; s2 < scrollers.length; s2++) {
    var se = scrollers[s2];
    if (!vis(se)) continue;
    var scs = getComputedStyle(se);
    if (!/auto|scroll/.test(scs.overflowY)) continue;
    if (se.scrollHeight <= se.clientHeight + 2) continue;
    if (se.scrollTop > 1) continue;                    // 已滚过就说明上边能滚回来
    var sr = se.getBoundingClientRect();
    var lost = 0, lostSel = null, lostTxt = '';
    var ch2 = se.querySelectorAll('*');
    for (var t2 = 0; t2 < ch2.length; t2++) {
      var ce = ch2[t2];
      if (!vis(ce)) continue;
      var cr = ce.getBoundingClientRect();
      if (cr.height <= 0) continue;
      var cut2 = sr.top - cr.top;                      // 被切在容器顶边之外多少
      if (cut2 > 1 && cut2 > lost) { lost = cut2; lostSel = sel(ce); lostTxt = cut((ce.textContent || '').trim(), 30); }
    }
    if (lost > 1) {
      out.unreachable.push({ sel: sel(se), rect: rect(sr), lost: fx(lost), childSel: lostSel, txt: lostTxt,
        ch: se.clientHeight, sh: se.scrollHeight,
        why: 'scrollTop=0 时仍有 ' + fx(lost) + 'px 内容被切在容器顶边之外且滚不回来（' + lostSel + '）' });
    }
  }

  out.counts = {
    overflow: out.overflow.length, clipped: out.clipped.length, ellipsis: out.ellipsis.length,
    textOverlap: out.textOverlap.length, boxOverlap: out.boxOverlap.length, offscreen: out.offscreen.length,
    unreachable: out.unreachable.length, texts: texts.length, boxes: boxes.length,
  };
  return JSON.stringify(out);
})()
`;

/* ───────────────────────── 动画结算 ─────────────────────────
 * ★ 必须做，否则数据是错的：headless(--disable-gpu) 下没有合成帧的时候，
 * CSS 动画的时间轴不前进，元素会**一直停在 @keyframes 的 from 状态**。
 * 实测后果：.tk 的入场动画 tkpop 是 `from { transform: scale(.2) }`，
 * 于是 4 个棋子量出来是 19×0.2 = 3.8px（看起来"棋子小到看不见"，
 * 其实真人浏览器里 0.3s 后就恢复 19px）。
 * 这里的做法：把所有 CSS 动画 cancel 掉，让元素落到**稳定态**再量。
 * 用 --no-freeze-anim 关掉（排查动画本身时才需要）。 */
const FREEZE_SRC = String.raw`
(function () {
  var before = 0, after = 0;
  try {
    var list = document.getAnimations ? document.getAnimations() : [];
    before = list.length;
    for (var i = 0; i < list.length; i++) { try { list[i].cancel(); } catch (e) {} }
    after = document.getAnimations ? document.getAnimations().length : 0;
  } catch (e) {}
  return JSON.stringify({ animationsBefore: before, animationsAfter: after });
})()
`;

/* ───────────────────────── 就绪判定 ─────────────────────────
 * ★ 必须等页面真的就绪再注入 act，否则会踩到竞态：
 * dist 单文件 1.9MB + headless 里多个浏览器抢 CPU 时，navigate 后 5 秒
 * 脚本可能还没跑完，注入的 `UI.g.pending = ...` 就直接 ReferenceError:
 * UI is not defined（实测在 1280×720 / 1024×768 的 buy-modal 上出现过）。
 * 判据：UI 已定义 + readyState complete + （对局模式下 40 个格子已经建好）。 */
const READY_SRC = String.raw`
(function () {
  var setup = document.getElementById('setup');
  var inSetup = !!(setup && !setup.classList.contains('hide'));
  var tiles = document.querySelectorAll('#board .tile').length;
  var ok = (typeof UI !== 'undefined') && document.readyState === 'complete' && (inSetup || tiles >= 40);
  return JSON.stringify({ ok: ok, ui: typeof UI !== 'undefined', state: document.readyState, tiles: tiles, inSetup: inSetup });
})()
`;

/* ───────────────────────── 布局抖动采样 ─────────────────────────
 * 回答"某个 animation 有没有把布局顶来顶去"：隔 150ms 连采 5 次关键元素的
 * getBoundingClientRect，报每个元素的最大位移。
 * 纯 box-shadow 动画（.tile.mono 的 monoPulse）应当位移 0；
 * .tk.cur 的 curBreath 用了 transform，本来就会动 —— 有数字正好量化它。 */
const JITTER_SRC = String.raw`
(function () {
  var sel = '#board .tile, #board .tk, #center-grid, #topbar, #bottom';
  var seq = 0;
  /* ★ 必须按"元素身份"配对，不能按下标：棋格/棋子是动态增删的，
     一旦某个格子上多了个 .tk，后面所有下标都会错位一格，
     于是"第 k 格"被拿去和"第 k+1 格"比，量出 272px 的假位移（实测踩过）。
     给元素打一个一次性标记属性，之后按标记配对；新出现的元素直接跳过。 */
  function snapshot() {
    var out = [], els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-jitk');
      if (!key) { key = 'j' + (++seq); el.setAttribute('data-jitk', key); }
      var r = el.getBoundingClientRect();
      var tag = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
      if (el.classList.contains('tile')) tag += '.tile' + (el.classList.contains('mono') ? '.mono' : '') + (el.classList.contains('has-tk') ? '.has-tk' : '');
      if (el.classList.contains('tk')) tag += '.tk' + (el.classList.contains('cur') ? '.cur' : '') + (el.classList.contains('me') ? '.me' : '');
      out.push({ key: key, tag: tag, box: [r.x, r.y, r.width, r.height] });
    }
    return out;
  }
  function same(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) for (var k = 0; k < 4; k++) if (a[i].box[k] !== b[i].box[k] || a[i].key !== b[i].key) return false;
    return true;
  }
  return new Promise(function (res) {
    var t0 = Date.now(), prev = snapshot(), stab = 0, baseline = null;
    (function gate() {
      if (Date.now() - t0 > 7000) return sample();
      var cur = snapshot();
      if (same(prev, cur)) { if (++stab >= 2) return sample(); } else stab = 0;
      prev = cur;
      setTimeout(gate, 120);
    })();
    function sample() {
      var first = snapshot(), worst = {}, n = 0;
      (function tick() {
        var cur = snapshot(), byKey = {};
        for (var i = 0; i < cur.length; i++) byKey[cur[i].key] = cur[i];
        for (var j = 0; j < first.length; j++) {
          var f = first[j], c = byKey[f.key];
          if (!c || c.tag !== f.tag) continue;            /* 元素没了 / 类型变了 → 跳过 */
          var d = 0;
          for (var k = 0; k < 4; k++) d = Math.max(d, Math.abs(f.box[k] - c.box[k]));
          if (!worst[f.tag] || d > worst[f.tag]) worst[f.tag] = d;
        }
        if (++n >= 10) {
          var mono = 0, other = 0, moved = [];
          Object.keys(worst).forEach(function (k) {
            if (worst[k] > 0.5) { moved.push(k + '=' + (+worst[k].toFixed(2)) + 'px'); if (k.indexOf('.mono') >= 0) mono++; else other++; }
          });
          res(JSON.stringify({ samples: 11, elements: first.length, monoMoved: mono, otherMoved: other, moved: moved.slice(0, 40), worst: worst }));
          return;
        }
        setTimeout(tick, 150);
      })();
    }
  });
})()
`;

/* ───────────────────────── 极简 CDP 客户端 ───────────────────────── */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    this.console_ = []; this.exceptions = []; this.logs = [];
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
      } else if (m.method) {
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
          this.console_.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
        }
        if (m.method === 'Runtime.exceptionThrown') {
          this.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        }
        if (m.method === 'Log.entryAdded') {
          const e = m.params.entry;
          if (e.level === 'error' || e.level === 'warning') this.logs.push(e.level + ': ' + e.text);
        }
        (this.handlers.get(m.method) || []).forEach(h => h(m.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 30000);
    });
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, []); this.handlers.get(ev).push(fn); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* Windows 上 proc.kill() 只杀父进程，Edge 的 gpu/renderer/utility 子进程会活下来
   （实测跑了几个场景就留下 80+ 个僵尸进程）。分两步收：
   1) taskkill /T /F 杀整棵进程树（spawnSync，必须同步，异步会在 node 退出后才执行）；
   2) 再按命令行里的 profile 目录名兜一次 —— Edge 的 crashpad-handler 等进程会被
      重新挂到别的父进程上，`/T` 自上而下的遍历会漏掉它们（实测每次都漏 7 个）。 */
let PROFILE_DIR = '';
function killTree(proc) {
  if (process.platform === 'win32') {
    if (proc && !proc.killed) {
      try { spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
    }
    if (PROFILE_DIR) {
      const pat = path.basename(PROFILE_DIR).replace(/'/g, "''");
      const cmd = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*" + pat + "*' } | " +
        "ForEach-Object { taskkill /F /PID $_.ProcessId }";
      try { spawnSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
    }
    return;
  }
  try { if (proc) proc.kill('SIGKILL'); } catch (e) {}
}

async function httpJson(url, method = 'GET') {
  const res = await fetch(url, { method });
  return res.json();
}

async function launchEdge() {
  /* ★ profile 目录必须按端口分开：两个 Edge 用同一个 --user-data-dir 时，
     第二个进程会把命令行甩给已有实例然后自己退出，远程调试端口永远不开。 */
  const profile = path.join(TMP, 'profile-' + PORT);
  PROFILE_DIR = profile;
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--allow-file-access-from-files', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--window-size=1920,1080',
    'about:blank',
  ];
  const proc = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true, detached: false });
  proc.on('error', e => { console.error('[edge] spawn failed:', e.message); });
  let info = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { info = await httpJson('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { /* retry */ }
  }
  if (!info) { try { killTree(proc); } catch (e) {} throw new Error('Edge 没起来（远程调试端口 ' + PORT + ' 无响应）'); }
  return { proc, info };
}

async function pickPageTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
      const p = list.find(t => t.type === 'page');
      if (p && p.webSocketDebuggerUrl) return p;
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  throw new Error('找不到 page target');
}

function openWs(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => res(ws));
    ws.addEventListener('error', (e) => rej(new Error('ws error')));
  });
}

/* ───────────────────────── 主流程 ───────────────────────── */
async function main() {
  if (hasFlag('list')) {
    console.log('场景：');
    SCENARIOS.forEach(s => console.log('  ' + s.id.padEnd(20) + s.label));
    console.log('\n分辨率（常规）：');
    VIEWPORTS_MAIN.forEach(v => console.log('  ' + v));
    console.log('\n分辨率（断点探针，配 --probe 用）：');
    VIEWPORTS.filter(v => v.probe).forEach(v => console.log('  ' + v.id + '   ' + v.probe));
    return;
  }
  if (!fs.existsSync(PAGE)) { console.error('找不到被测页面：' + PAGE); process.exit(1); }
  if (!fs.existsSync(EDGE)) { console.error('找不到 msedge.exe：' + EDGE + '\n可用 EDGE_PATH 环境变量覆盖'); process.exit(1); }

  const emit = arg('emit-js', null);
  if (emit) { fs.writeFileSync(String(emit), MEASURE, 'utf8'); console.log('测量脚本已导出：' + emit); return; }

  /* --eval=<js>：在某个场景加载完后跑一段自定义 JS 并打印结果，用来做定点诊断。
     例：node tools/audit-layout.mjs --eval="JSON.stringify(document.querySelector('.tile .nm').getBoundingClientRect())" */
  const evalJs = arg('eval', null);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('被测页面：' + PAGE);
  console.log('截图目录：' + OUT_DIR);

  const scen = ONLY_SCEN_LIST ? SCENARIOS.filter(s => ONLY_SCEN_LIST.includes(s.id))
    : (evalJs ? SCENARIOS.filter(s => s.id === 'play-roll')
      : (PROBE_MODE ? SCENARIOS.filter(s => PROBE_SCENARIOS.includes(s.id)) : SCENARIOS));
  const vps = ONLY_VP_LIST ? VIEWPORTS.filter(v => ONLY_VP_LIST.includes(v.id))
    : (evalJs ? VIEWPORTS.filter(v => v.id === '1280x720')
      : (PROBE_MODE ? VIEWPORTS.filter(v => v.probe) : VIEWPORTS.filter(v => !v.probe)));
  if (!scen.length) { console.error('没有匹配的场景：' + ONLY_SCEN); process.exit(1); }
  if (!vps.length) { console.error('没有匹配的分辨率：' + ONLY_VP); process.exit(1); }
  const { proc } = await launchEdge();
  const target = await pickPageTarget();
  const ws = await openWs(target.webSocketDebuggerUrl);
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  /* ★ 每次新文档加载前清空 localStorage：
     UI.toggleCenter() 会把折叠状态写进 localStorage('dgs-center-mini')，
     而 headless 用的是持久 profile —— 跑过一次 ?mini=1 之后，后面所有场景
     都会带着"中央面板已折叠"渲染，数据就被污染了。 */
  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "try{localStorage.removeItem('dgs-center-mini');}catch(e){}",
    });
  } catch (e) { console.log('（提示：清 localStorage 的注入没成功：' + e.message + '）'); }

  const runs = [];
  const pageUrl = 'file:///' + PAGE.replace(/\\/g, '/').replace(/ /g, '%20');
  try {
    for (const v of vps) {
      for (const s of scen) {
        const tag = s.id + '@' + v.id;
        cdp.console_.length = 0; cdp.exceptions.length = 0; cdp.logs.length = 0;
        const url = pageUrl + (s.url ? (s.url.includes('?') ? '&' : '?') + s.url : '');
        const run = { scenario: s.id, label: s.label, viewport: v.id, url, act: !!s.act };
        try {
          await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: v.w, height: v.h, deviceScaleFactor: 1, mobile: false,
          });
          await cdp.send('Page.navigate', { url });
          await sleep(900 + (s.settle || 3000) * SETTLE_SCALE);
          /* ★ 就绪闸门：UI 未定义 / 格子没建好就等，避免注入 act 时踩竞态 */
          let ready = null;
          for (let ri = 0; ri < 60; ri++) {
            try { ready = JSON.parse(await cdp.eval(READY_SRC)); } catch (e) { ready = null; }
            if (ready && ready.ok) break;
            await sleep(250);
          }
          run.ready = ready;
          await sleep(120);
          if (s.act) {
            await cdp.eval(s.act);
            await sleep(450);
          }
          /* 顺序：act → 抖动（要动画活着）→ 结算动画 → eval/测量（要稳定态） */
          if (JITTER) {
            try {
              const jr = await cdp.eval(JITTER_SRC, true);
              run.jitter = JSON.parse(jr);
            } catch (e) { run.jitter = { error: e.message }; }
          }
          if (!NO_FREEZE) {
            try { run.freeze = JSON.parse(await cdp.eval(FREEZE_SRC)); } catch (e) { run.freeze = { error: e.message }; }
          }
          if (evalJs) {
            const evOut = await cdp.eval(String(evalJs), true);
            console.log('\n[' + tag + '] eval =>\n' + (typeof evOut === 'string' ? evOut : JSON.stringify(evOut, null, 1)));
            runs.push(run);
            continue;
          }
          const json = await cdp.eval(MEASURE);
          const data = JSON.parse(json);
          if (run.jitter) data.jitter = run.jitter;
          data.freeze = run.freeze || null;
          run.data = data;
          run.console = cdp.console_.slice(0, 8);
          run.exceptions = cdp.exceptions.slice(0, 8);
          run.logs = cdp.logs.slice(0, 8);
          const shot = path.join(OUT_DIR, s.id + '_' + v.id + (CROP ? '_zoom' : '') + '.png');
          try {
            const capArgs = { format: 'png', captureBeyondViewport: false };
            if (CROP) {                       /* --crop=x,y,w,h 配 --crop-scale=N 放大局部，肉眼复核用 */
              const p4 = String(CROP).split(',').map(Number);
              capArgs.clip = { x: p4[0], y: p4[1], width: p4[2], height: p4[3], scale: CROP_SCALE };
            }
            const cap = await cdp.send('Page.captureScreenshot', capArgs);
            fs.writeFileSync(shot, Buffer.from(cap.data, 'base64'));
            run.shot = shot;
          } catch (e) { run.shot = null; }
          const c = data.counts;
          const jt = data.jitter && !data.jitter.error
            ? ' | 抖动:mono' + data.jitter.monoMoved + ' 其它' + data.jitter.otherMoved + '/' + data.jitter.elements : '';
          console.log('[' + tag + '] 溢出' + c.overflow + ' 裁剪' + c.clipped + ' 截断' + c.ellipsis +
            ' 文字压叠' + c.textOverlap + ' 遮挡' + c.boxOverlap + ' 出界' + c.offscreen +
            ' 不可达' + c.unreachable + jt +
            (run.ready && !run.ready.ok ? '  ⚠就绪超时' : '') +
            (run.exceptions.length ? '  ⚠页面异常' + run.exceptions.length : ''));
        } catch (e) {
          run.error = e.message;
          console.log('[' + tag + '] ✗ ' + e.message);
        }
        runs.push(run);
      }
    }
  } finally {
    if (!hasFlag('keep-open')) {
      try { ws.close(); } catch (e) {}
      killTree(proc);
    } else {
      console.log('\n--keep-open：浏览器留着，端口 ' + PORT + '，Ctrl+C 结束');
    }
  }

  /* ── 汇总：按缺陷签名分组 ── */
  if (evalJs) { try { ws.close(); } catch (e) {} killTree(proc); return; }

  /* 把 40 个棋格的 40 条同源缺陷收敛成一条：去掉 nth-of-type、把 .tile 的
     材质/朝向类收敛成 .tile，只保留最后 3 段路径。 */
  function normSel(sel) {
    if (!sel) return sel;
    let s = String(sel).replace(/:nth-of-type\(\d+\)/g, '');
    s = s.replace(/\.tile\.[A-Za-z0-9_.-]+/g, '.tile');
    s = s.replace(/(^|>)\s*div(\.|>|$)/g, '$1');
    const segs = s.split('>').map(x => x.trim()).filter(x => x && x !== 'div');
    return segs.slice(-3).join(' > ');
  }
  const groups = new Map();
  const add = (type, key, run, item) => {
    const k = type + '||' + key;
    if (!groups.has(k)) groups.set(k, { type, key, hits: [], sample: item, runs: new Set() });
    const g = groups.get(k);
    g.runs.add(run.scenario + '@' + run.viewport);
    if (g.hits.length < 6) g.hits.push(run.scenario + '@' + run.viewport);
    if (!g.sample) g.sample = item;
  };
  for (const r of runs) {
    if (!r.data) continue;
    const d = r.data;
    d.overflow.forEach(o => add('溢出(overflow)', normSel(o.sel) + ' [' + o.axis + ']', r, o));
    d.clipped.forEach(o => add('裁剪(clipped·文字被压没)', normSel(o.sel), r, o));
    d.ellipsis.forEach(o => add('截断(ellipsis)', normSel(o.sel), r, o));
    d.textOverlap.forEach(o => add('文字压叠(textOverlap) r=' + (o.ratioV >= 0.3 ? '高' : '擦边'), normSel(o.a) + ' × ' + normSel(o.b), r, o));
    d.boxOverlap.forEach(o => add('遮挡(boxOverlap)', normSel(o.a) + ' ⟂ ' + normSel(o.b), r, o));
    d.offscreen.forEach(o => add('出界(offscreen)', normSel(o.sel), r, o));
    d.unreachable.forEach(o => add('滚动不可达(unreachable)', normSel(o.sel), r, o));
  }
  const summary = ['溢出(overflow)'].concat(['裁剪(clipped·文字被压没)'], ['截断(ellipsis)'],
    ['文字压叠(textOverlap) r=高'], ['文字压叠(textOverlap) r=擦边'], ['遮挡(boxOverlap)'],
    ['出界(offscreen)'], ['滚动不可达(unreachable)'])
    .map(type =>
      [...groups.values()].filter(g => type.startsWith(g.type))
        .sort((a, b) => b.runs.size - a.runs.size)
        .map(g => ({ type: g.type, key: g.key, runCount: g.runs.size, runs: [...g.runs].slice(0, 12), sample: g.sample })));

  const flat = [];
  summary.forEach(arr => arr.forEach(g => flat.push(g)));
  console.log('\n================ 按缺陷签名分组（跨分辨率/场景去重） ================');
  let printed = 0;
  for (const g of flat) {
    if (printed++ > 80) { console.log('\n…（还有更多，见 JSON）'); break; }
    console.log('\n【' + g.type + '】' + g.key + '   ← 命中 ' + g.runCount + ' 个场景×分辨率');
    const s = g.sample || {};
    const nums = [];
    if (s.sh !== undefined) nums.push('sh' + s.sh + '/ch' + s.ch);
    if (s.sw !== undefined) nums.push('sw' + s.sw + '/cw' + s.cw);
    if (s.ov !== undefined) nums.push('超出' + s.ov + 'px');
    if (s.lost !== undefined) nums.push('被切掉' + s.lost + 'px');
    if (s.ovW !== undefined) nums.push('交叠' + s.ovW + 'x' + s.ovH);
    if (s.ratioV !== undefined) nums.push('ratioV=' + s.ratioV + '(占较矮行比例)');
    if (s.visPct !== undefined) nums.push('可见高度只剩' + s.visPct + '%');
    if (nums.length) console.log('    量到的数字：' + nums.join('  '));
    if (s.why) console.log('    判据：' + s.why);
    if (s.txt) console.log('    文本：' + JSON.stringify(s.txt));
    if (s.aRect) console.log('    aRect=' + JSON.stringify(s.aRect) + ' bRect=' + JSON.stringify(s.bRect));
    console.log('    命中：' + g.runs.join(', ') + (g.runCount > g.runs.length ? ' …' : ''));
  }

  const raw = {
    meta: { page: PAGE, edge: EDGE, when: new Date().toISOString(), viewports: vps.map(v => v.id), scenarios: scen.map(s => s.id) },
    runs,
    groups: flat,
  };

  /* ── 动画抖动汇总 ── */
  if (JITTER) {
    const jm = new Map();
    for (const r of runs) {
      const j = r.data && r.data.jitter;
      if (!j || j.error) continue;
      (j.moved || []).forEach(m => {
        const tag = m.split('=')[0];
        const px = parseFloat(m.split('=')[1]) || 0;
        if (!jm.has(tag)) jm.set(tag, { px: 0, runs: new Set(), sample: r.scenario + '@' + r.viewport });
        const e = jm.get(tag);
        e.px = Math.max(e.px, px); e.runs.add(r.scenario + '@' + r.viewport);
      });
    }
    console.log('\n================ 布局抖动（稳定后再采样 11 次，看动画有没有顶动布局） ================');
    if (!jm.size) console.log('  所有采样元素在 11 次采样里位移都 ≤ 0.5px —— 没有动画引起布局位移。');
    [...jm.entries()].sort((a, b) => b[1].px - a[1].px).slice(0, 25).forEach(([k, v]) => {
      console.log('  ' + k.padEnd(30) + ' 最大位移 ' + v.px + 'px   ← ' + v.runs.size + ' 个场景，例：' + v.sample);
    });
    const monoRuns = runs.filter(r => r.data && r.data.jitter && !r.data.jitter.error);
    if (monoRuns.length) {
      const bad = monoRuns.filter(r => (r.data.jitter.monoMoved || 0) > 0);
      console.log('  .tile.mono（垄断发光）参与采样的场景 ' + monoRuns.filter(r => (r.data.jitter.worst || {})['div.tile.mono'] !== undefined).length +
        ' 个，其中发生位移的 ' + bad.length + ' 个');
    }
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(raw, null, 1), 'utf8');
  console.log('\n原始数据：' + JSON_PATH);
  console.log('截图：' + OUT_DIR);
  console.log('总运行：' + runs.length + ' 次，页面异常 ' + runs.filter(r => (r.exceptions || []).length).length + ' 次');
}

main().catch(e => { console.error('FATAL: ' + e.stack); process.exit(1); });
