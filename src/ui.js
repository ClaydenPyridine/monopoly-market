/* ============================================================
 * 《地产股神》v0.1 — 界面与交互
 * ============================================================ */

const $ = (id) => document.getElementById(id);
let SPEED = 1;                       // 动画倍速，测试脚本会调快
const sleep = (ms) => new Promise(r => setTimeout(r, ms * SPEED));
function fmt(n) { return '¥' + Math.round(n).toLocaleString('en-US'); }
function fmtShort(n) {
  n = Math.round(n);
  if (n >= 100000) return (n / 10000).toFixed(0) + '万';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}
function gridPos(i) {
  if (i <= 10) return { r: 11, c: 11 - i };
  if (i <= 20) return { r: 11 - (i - 10), c: 1 };
  if (i <= 30) return { r: 1, c: 1 + (i - 20) };
  return { r: 1 + (i - 30), c: 11 };
}
/* 色组条朝向棋盘内侧：底边朝上、左边朝右、顶边朝下、右边朝左 */
function tileSide(i) {
  if (i < 10) return 'side-top';
  if (i < 20) return 'side-right';
  if (i < 30) return 'side-bottom';
  return 'side-left';
}

/* 骰子点数（3×3 网格里的位置编号） */
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieFace(v) {
  const on = PIPS[v] || [];
  let h = '';
  for (let k = 0; k < 9; k++) h += `<i class="${on.indexOf(k) >= 0 ? 'on' : ''}"></i>`;
  return h;
}
/* ★ 把一次掷骰画到骰子元素上。d12 模式只有一颗骰子，而且 7~12 用 6 面的点阵画不出来，
   所以直接显示数字（`.die.num` 是一个居中大数字的样式）。
   两个调用点（自己掷骰 / 联机收到服务端的掷骰事件）都走这里，避免只改一处。 */
function paintDice(d1, d2, dice, total) {
  const single = !dice || dice.length < 2;
  if (single) {
    d1.className = 'die num';
    d1.innerHTML = '<span>' + total + '</span>';
    d2.style.display = 'none';
  } else {
    d1.className = 'die';
    d2.style.display = '';
    d1.innerHTML = dieFace(dice[0]);
    d2.innerHTML = dieFace(dice[1]);
  }
}

/* 四角格的图标（内联 SVG，不依赖图片） */
const ICONS = {
  go: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5l8 9h-4.6V21H8.6v-9.5H4z" fill="currentColor"/></svg>',
  jail: '<svg viewBox="0 0 24 24" fill="none"><rect x="4.5" y="3.5" width="15" height="17" rx="1.6" stroke="currentColor" stroke-width="1.8"/><path d="M9.5 3.5v17M14.5 3.5v17" stroke="currentColor" stroke-width="1.5"/></svg>',
  gotojail: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4.5" width="9" height="15" rx="1.4" stroke="currentColor" stroke-width="1.7"/><path d="M13 12h7.5M17.5 8.5L21 12l-3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  parking: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l2.2 4.9 5.3.6-4 3.6 1.1 5.2L12 14.7 7.4 17.3l1.1-5.2-4-3.6 5.3-.6z" fill="currentColor"/><path d="M6 21h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

/* 元素徽记：地块头像槽里的占位图（放上真头像就自动被替换） */
const ELEM_ICON = {
  anemo: '<path d="M12 3.5a8.5 8.5 0 00-8.5 8.5c0 2.6 1.2 5 3 6.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12 20.5a8.5 8.5 0 008.5-8.5c0-2.2-.8-4.2-2.2-5.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  pyro: '<path d="M12 2.6c3.2 4.2 6.4 6.8 6.4 11a6.4 6.4 0 11-12.8 0c0-2.2 1-3.8 2.2-5 .5 1.6 1.5 2.2 2.6 2.2.5-3.2-.6-6.4-1.6-8.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  electro: '<path d="M12 2.6l7.4 9.4-7.4 9.4-7.4-9.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13.2 7.5l-4 6h3.2l-1.6 4.5 4.2-6.2h-3.1z" fill="currentColor"/>',
  dendro: '<path d="M20.5 3.5C10 3.5 4.5 7 4.5 13c0 2.8 1.6 5 4 6.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M20.5 3.5c0 9.5-4.5 13.5-10 13.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M4 21c1.2-3.4 3.4-6.2 6.5-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  hydro: '<path d="M12 2.8s6.3 7 6.3 11.4a6.3 6.3 0 11-12.6 0C5.7 9.8 12 2.8 12 2.8z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M9.5 14.6a2.6 2.6 0 002.6 2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>',
  geo: '<path d="M12 2.8l7.2 6.4L12 21.2 4.8 9.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4.8 9.2h14.4" stroke="currentColor" stroke-width="1.4"/>',
  cryo: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 6.6L9.6 4.2M12 6.6l2.4-2.4M12 17.4l-2.4 2.4M12 17.4l2.4 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  moon: '<path d="M15.5 2.8a9.2 9.2 0 11-8.4 14.8A9.6 9.6 0 0015.5 2.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
};

/* 头像：把 png 丢进 assets/avatars/ 就会自动替换掉徽记。
   单文件打包时 tools/build-single.mjs 会把这些图内联成 AVATAR_DATA。 */
const AVATAR_DATA = (typeof window !== 'undefined' && window.AVATAR_DATA) ? window.AVATAR_DATA : {};
const AVATAR_DIR = 'assets/avatars/';
function avatarSrc(key) { return AVATAR_DATA[key] || (AVATAR_DIR + key + '.png'); }

/* 元素徽记：assets/elements/<key>.png（原神官方 UI 资源，非商业同人使用）。
   有就用官方图标，没有就回退到代码里那套手写 SVG。 */
const ELEM_DATA = (typeof window !== 'undefined' && window.ELEM_DATA) ? window.ELEM_DATA : {};
const ELEM_DIR = 'assets/elements/';
function elemSrc(key) { return ELEM_DATA[key] || (ELEM_DIR + key + '.png'); }

/* 各行业的标识色（行情面板左侧竖条） */
const SECTOR_COLOR = {
  estate: '#f5c451', bank: '#5aa9e6', tech: '#a06cd5',
  utility: '#7dd3fc', rail: '#cbd5e1', retail: '#f4a259',
};

let sparkSeq = 0;
function sparkline(values, color, area) {
  const v = (values && values.length > 1) ? values : [0, 0];
  const w = 100, h = 30;
  const min = Math.min.apply(null, v), max = Math.max.apply(null, v);
  const span = (max - min) || 1;
  const pts = v.map((x, i) => {
    const px = (i / (v.length - 1)) * w;
    const py = h - ((x - min) / span) * (h - 6) - 3;
    return px.toFixed(2) + ',' + py.toFixed(2);
  });
  let s = '';
  if (area) {
    const id = 'spk' + (++sparkSeq);
    s += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="${color}" stop-opacity=".4"/>` +
      `<stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
      `<polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="url(#${id})"/>`;
  }
  s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.7" ` +
    `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${s}</svg>`;
}

/* 地产指数走势：带 100 基准虚线和渐变面积 */
function reiChart(values, color) {
  const v = (values && values.length > 1) ? values.slice() : [100, values && values[0] || 100];
  const w = 100, h = 40;
  let min = Math.min.apply(null, v), max = Math.max.apply(null, v);
  const pad = Math.max(2.5, (max - min) * 0.18);
  min -= pad; max += pad;
  const span = (max - min) || 1;
  const Y = val => h - ((val - min) / span) * h;
  const pts = v.map((val, i) => ((i / (v.length - 1)) * w).toFixed(2) + ',' + Y(val).toFixed(2));
  const id = 'rei' + (++sparkSeq);
  let s = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${color}" stop-opacity=".45"/>` +
    `<stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
  if (100 > min && 100 < max) {
    const y = Y(100).toFixed(2);
    s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#7d90ad" stroke-width="1" ` +
      `stroke-dasharray="4 4" opacity=".6" vector-effect="non-scaling-stroke"/>`;
  }
  s += `<polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="url(#${id})"/>`;
  s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${s}</svg>`;
}

const UI = {
  g: null,
  qty: 1,
  busy: false,
  tileEls: [],

  /* ================= 初始化 ================= */
  init() {
    this.board = $('board');
    this.avatarOK = {};
    this.elemOK = {};
    this.buildBoard();
    this.probeAvatars();
    $('die1').innerHTML = dieFace(1);
    $('die2').innerHTML = dieFace(1);
    $('qty-select').addEventListener('change', e => { this.qty = parseInt(e.target.value, 10); });

    /* 事件日志展开/收起（展开后占满整屏，不会被棋盘挡住） */
    const logBtn = $('log-expand');
    if (logBtn) logBtn.addEventListener('click', () => this.toggleLogPanel());

    /* 二级面板：股市 / 玩家 / 金融 / 交易 / 顶栏菜单 抽屉 */
    $('btn-menu').addEventListener('click', () => this.toggleDrawer('menu'));
    $('btn-market').addEventListener('click', () => this.toggleDrawer('market'));
    $('btn-players').addEventListener('click', () => this.toggleDrawer('players'));
    $('btn-cards').addEventListener('click', () => this.toggleDrawer('cards'));
    $('btn-trade').addEventListener('click', () => this.toggleDrawer('trade'));
    Array.prototype.forEach.call(document.querySelectorAll('.drawer-close'), b =>
      b.addEventListener('click', () => this.closeDrawers()));

    /* 中央面板折叠 */
    this.centerMini = false;
    try { this.centerMini = localStorage.getItem('dgs-center-mini') === '1'; } catch (e) {}
    $('ct-toggle').addEventListener('click', () => this.toggleCenter());
    this.applyCenterMode();

    document.addEventListener('keydown', e => {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.code === 'KeyM') { this.toggleDrawer('market'); return; }
      if (e.code === 'KeyP') { this.toggleDrawer('players'); return; }
      if (e.code === 'KeyF') { this.toggleDrawer('cards'); return; }
      if (e.code === 'KeyT') { if (this.net) this.toggleDrawer('trade'); return; }
      if (e.code === 'KeyC') { this.toggleCenter(); return; }
      if (e.code === 'Escape') {
        const bottom = $('bottom');
        if (bottom && bottom.classList.contains('expanded')) { this.toggleLogPanel(false); return; }
        this.closeDrawers(); return;
      }
      if (e.code === 'Space' && !$('modal-root').firstChild) {
        e.preventDefault();
        const g = this.g;
        if (!g || g.over || this.busy || g.cur().isAI) return;
        if (g.phase === 'awaiting-roll') this.doRoll();
        else if (g.phase === 'awaiting-trade') this.onEndTurn();
      }
    });
  },

  /* 头像探测：文件存在就用真图，不存在就用元素徽记 */
  probeAvatars() {
    const keys = [];
    TILES.forEach(t => { if (t.avatar && keys.indexOf(t.avatar) < 0) keys.push(t.avatar); });
    if (!keys.length) return;
    const done = () => this.renderAll();
    keys.forEach(k => {
      if (AVATAR_DATA[k]) { this.avatarOK[k] = true; return; }
      const im = new Image();
      im.onload = () => { this.avatarOK[k] = true; done(); };
      im.onerror = () => { this.avatarOK[k] = false; done(); };
      im.src = avatarSrc(k);
    });
    /* 元素徽记也探一遍（源码版从磁盘读，单文件版已经在 ELEM_DATA 里直接用） */
    Object.keys(ELEMENTS).forEach(k => {
      if (ELEM_DATA[k]) { this.elemOK[k] = true; return; }
      const im = new Image();
      im.onload = () => { this.elemOK[k] = true; done(); };
      im.onerror = () => { this.elemOK[k] = false; };
      im.src = elemSrc(k);
    });
  },

  /* 中央面板：折叠成一条紧凑状态条 */
  toggleCenter() {
    this.centerMini = !this.centerMini;
    try { localStorage.setItem('dgs-center-mini', this.centerMini ? '1' : '0'); } catch (e) {}
    this.applyCenterMode();
  },
  applyCenterMode() {
    const el = $('center-grid');
    if (el) el.classList.toggle('mini', !!this.centerMini);
  },

  /* ================= 联机 =================
     ★ 关键：这是一个 getter，联机时返回 NET 对象、单机时返回 null。
       整个 UI 里 20 多处 `if (this.net)` 全靠它区分"本地跑"还是"发指令给服务端"。
       （早先漏了赋值，导致联机时按钮照样本地执行——主机能替别人操作，就是这个原因。） */
  get net() {
    return (typeof NET !== 'undefined' && NET && NET.room && NET.token) ? NET : null;
  },
  isMyTurn() {
    if (!this.net) return true;
    return !!(this.g && this.g.current === this.net.seat);
  },
  /** 当前操作者（我）。联机时是我的座位，单机时是当前回合的人。
   *  ★ 炒股解绑回合之后，"现在是谁在操作"和"现在轮到谁"不再是同一件事，
   *    凡是跟钱有关的计算都必须用它，不能再用 g.cur()。 */
  meNow() {
    const g = this.g;
    if (!g) return null;
    if (this.net) return g.players[this.net.seat] || null;
    return g.cur();
  },
  /** 现在能不能炒股。★ 不绑回合：任何人的回合都能买卖（股票是跟银行成交，
   *  不是抢同一个东西，所以不存在"比谁快"的零和）。
   *  只排除两种情况：① 自己在坐牢；② 场上正有未决的买地决策。 */
  canTradeNow() {
    const g = this.g, p = this.meNow();
    if (!g || g.over || !p || p.isAI) return false;
    if (p.jailTurns > 0) return false;
    if (g.pending && g.pending.type === 'buy') return false;
    return true;
  },
  send(action, payload) {
    if (!this.net) return;
    NET.send(action, payload).then(() => {});
  },

  /** 服务端推来一份新状态 */
  applyState(st) {
    if (!st) return;
    this.remote = st;
    if (typeof st.mySeat === 'number') this._mySeat = st.mySeat;
    if (NET.onSeats) NET.onSeats(st.seats, st.started);
    if (!st.started || !st.game) { this.renderLobbyIfOpen(); return; }
    document.getElementById('setup').classList.add('hide');
    document.getElementById('lobby').classList.add('hide');
    try { this.g = Game.deserialize(st.game); } catch (e) { return; }
    const ev = st.event;
    if (ev && ev.seq !== this._lastSeq) {
      this._lastSeq = ev.seq;
      this.playRemoteEvent(ev);
      return;
    }
    this.renderAll();
    this.syncRemoteModal();
  },
  renderLobbyIfOpen() {
    if (NET.room && !document.getElementById('lobby').classList.contains('hide')) NET.renderLobby();
  },

  /** 把服务端发来的掷骰/移动事件演一遍 */
  async playRemoteEvent(ev) {
    const g = this.g;
    if (!g) { this.renderAll(); return; }
    this.renderAll();
    if (ev.kind === 'roll' && ev.path && ev.path.length) {
      const p = g.players[ev.seat];
      const d1 = $('die1'), d2 = $('die2');
      d1.classList.add('rolling'); d2.classList.add('rolling');
      for (let i = 0; i < 5; i++) {
        d1.innerHTML = dieFace(1 + Math.floor(Math.random() * 6));
        d2.innerHTML = dieFace(1 + Math.floor(Math.random() * 6));
        await sleep(50);
      }
      d1.classList.remove('rolling'); d2.classList.remove('rolling');
      paintDice(d1, d2, ev.dice, ev.total);
      $('dice-total').textContent = '= ' + ev.total;
      if (p) {
        p.pos = (ev.path[0] + 39) % 40;
        this.syncTokens();
        for (const step of ev.path) {
          p.pos = step;
          this.syncTokens();
          await sleep(105);
        }
        p.pos = ev.path[ev.path.length - 1];
        this.syncTokens();
      }
    }
    this.renderAll();
    this.syncRemoteModal();
  },

  /** 轮到我、且有需要决策的事时才弹窗 */
  syncRemoteModal() {
    const g = this.g;
    if (!g) return;
    if (g.over) { this.showResult(); return; }
    if (!this.isMyTurn()) { this._pendingKey = null; return; }
    if (g.pending && g.pending.type === 'buy') {
      const key = 'buy:' + g.pending.tileId + ':' + g.quarter + ':' + g.players.filter(p => p.alive).length;
      if (this._pendingKey !== key) { this._pendingKey = key; this.buyModal(); }
    } else if (g.pending && g.pending.type === 'event') {
      const key = 'ev:' + g.pending.event.title + ':' + g.quarter;
      if (this._pendingKey !== key) { this._pendingKey = key; this.eventModal(); }
    } else {
      this._pendingKey = null;
    }
  },

  /* ================= 二级面板 ================= */
  toggleDrawer(name) {
    const app = $('app');
    const el = $('drawer-' + name);
    const btn = $('btn-' + name);
    const wasOpen = el.classList.contains('open');
    this.closeDrawers();
    btn.classList.remove('hint');
    if (wasOpen) return;
    el.classList.add('open');
    btn.classList.add('on');
    app.classList.add('drawer-open');
  },
  /** 展开/收起事件日志。展开后日志占满顶栏以下的整屏，
   *  彻底解决"日志被中间那块面板挡住"的问题。 */
  toggleLogPanel(force) {
    const el = $('bottom');
    if (!el) return;
    const on = (force === undefined) ? !el.classList.contains('expanded') : !!force;
    el.classList.toggle('expanded', on);
    const b = $('log-expand');
    if (b) b.textContent = on ? '✕ 收起' : '⤢ 展开';
    if (on) { this.renderLog(); const box = $('log'); if (box) box.scrollTop = box.scrollHeight; }
  },

  closeDrawers() {    Array.prototype.forEach.call(document.querySelectorAll('#drawers .drawer'), d => d.classList.remove('open'));
    Array.prototype.forEach.call(document.querySelectorAll('.rail-btn'), b => b.classList.remove('on'));
    const mb = $('btn-menu');                    // 顶栏「菜单」按钮的高亮也在这里复位
    if (mb) mb.classList.remove('on');
    const app = $('app');
    if (app) app.classList.remove('drawer-open');
  },
  isDrawerOpen(name) {
    const el = $('drawer-' + name);
    return !!(el && el.classList.contains('open'));
  },
  openDrawer(name) {
    if (!this.isDrawerOpen(name)) this.toggleDrawer(name);
  },

  buildBoard() {
    this.board.querySelectorAll('.tile').forEach(e => e.remove());
    this.tileEls = [];
    TILES.forEach((t, i) => {
      const el = document.createElement('div');
      const { r, c } = gridPos(i);
      el.style.gridArea = `${r} / ${c} / ${r + 1} / ${c + 1}`;
      el.className = 'tile' + (i % 10 === 0 ? ' corner' : '');
      el.dataset.id = i;
      el.addEventListener('click', () => this.tileModal(i));
      this.board.appendChild(el);
      this.tileEls.push(el);
    });
  },

  /* ================= 渲染 ================= */
  renderAll() {
    if (!this.g) return;
    this.syncBoard();
    this.renderTop();
    this.renderCenter();
    this.renderTimer();
    this.renderMarket();
    this.renderPlayers();
    this.renderCards();
    this.renderRail();
    this.renderTrade();
    /* ★ 破产地产拍卖：单机（this.net 为 null）时它什么都不做 */
    this.renderAuction();
    this.renderLog();
  },

  /* ================= 回合倒计时 =================
     deadline 是服务端权威的 Unix 毫秒时间戳，timeoutSec 是本阶段的总秒数。
     两件事都要守住：
       1) 只在「联机 + 轮到我 + deadline 有值」时显示，单机永远不显示；
       2) 每秒刷新的 interval 必须复用（this._timerId），不能每次状态推送都新建一个。 */
  renderTimer() {
    const el = $('turn-timer');
    if (!el) return;
    const g = this.g;
    const st = this.remote;
    const dl = (st && typeof st.deadline === 'number' && isFinite(st.deadline)) ? st.deadline : null;
    if (!this.net || !g || g.over || dl === null || !this.isMyTurn()) {
      this.stopTimer();
      el.classList.add('hide');
      el.textContent = '';
      return;
    }
    this._deadline = dl;
    this._timerTotal = (st && st.timeoutSec > 0) ? st.timeoutSec : 0;
    el.classList.remove('hide');
    if (!this._timerId) this._timerId = setInterval(() => this.tickTimer(), 1000);
    this.tickTimer();                     // 状态一到就先画一帧，不用等满 1 秒
  },

  /* 每秒重算一次剩余秒数：只读 deadline，绝不碰任何游戏状态 */
  tickTimer() {
    const el = $('turn-timer');
    const g = this.g;
    if (!el || this._deadline == null) return;
    if (!this.net || !g || g.over || !this.isMyTurn()) {   // 掉线 / 换人 / 结束 → 自己收摊，不留野 interval
      this.stopTimer();
      el.classList.add('hide');
      return;
    }
    const sec = Math.max(0, Math.ceil((this._deadline - Date.now()) / 1000));
    el.textContent = sec <= 10 ? `⏱ 剩余 ${sec} 秒（即将自动处理）` : `⏱ 剩余 ${sec} 秒`;
    el.classList.toggle('warn', sec <= 30);          // 过期（0）也落在 warn 里
    const pct = this._timerTotal ? Math.max(0, Math.min(1, sec / this._timerTotal)) * 100 : 100;
    el.style.setProperty('--tt', pct.toFixed(1) + '%');
    this.timerWarn(sec);
  },

  /* 剩余 30 秒时轻提示一次；key = 回合 + 阶段，换了回合自然重置 */
  timerWarn(sec) {
    const g = this.g;
    if (!g || sec > 30 || sec <= 0) return;
    const key = (g.turnsTaken || 0) + ':' + g.phase;
    if (this._timerWarnKey === key) return;
    this._timerWarnKey = key;
    this.toast('还剩 30 秒，超时后系统会替你执行最保守的操作');
  },

  /* 隐藏 / 退出时一定要清掉，否则会留下野 interval */
  stopTimer() {
    if (this._timerId) { clearInterval(this._timerId); this._timerId = null; }
    this._deadline = null;
  },

  /* 右侧竖排按钮上的实时小字 */
  renderRail() {
    const g = this.g;
    if (!g) return;
    const s = g.stockByCode('001');
    const h = s.hist;
    const prev = h.length > 1 ? h[h.length - 2] : s.price;
    const chg = prev ? (s.price - prev) / prev : 0;
    const el = $('rail-market-sub');
    el.textContent = (chg >= 0 ? '+' : '') + (chg * 100).toFixed(1) + '%';
    el.className = 'rsub ' + (chg > 0.0001 ? 'up' : chg < -0.0001 ? 'down' : '');
    const alive = g.alivePlayers().length;
    $('rail-players-sub').textContent = alive + ' / ' + g.players.length;
    const p = g.cur();
    let n = 0;
    if (p) for (const k in p.products) if (p.products[k]) n++;
    const cs = $('rail-cards-sub');
    cs.textContent = n ? n + ' 张' : '无';
    cs.className = 'rsub' + (n ? ' up' : '');
  },

  /* ================= 玩家间交易 =================
     服务端权威，这里只做界面（单机没有这个玩法，按钮直接藏起来）。
     协议：proposeTrade{ to, give, want } / respondTrade{ accept } / cancelTrade{}
     读状态：g.trade = { from, to, give, want, status, q }
       give = 发起方拿出来，"want" = 发起方索要；两边形如
       { cash, tiles:[地块id], stocks:{代码:股数}, rentShares:[{tileId, pct}] }
     分红权：地主把某块地收租的 N%（10~50）分给买家，一块地只能卖一次。 */
  /** 我的座位号；单机返回 -1 */
  _tradeSeat() {
    return (this.net && this.g) ? this.net.seat : -1;
  },

  renderTrade() {
    const g = this.g;
    const btn = $('btn-trade'), body = $('trade-body');
    if (!btn || !body) return;

    /* 单机（热座）没有玩家间交易：按钮藏起来，抽屉里只留一句说明 */
    if (!this.net || !g) {
      btn.classList.add('hide');
      btn.classList.remove('hint');
      const b0 = $('rail-trade-badge');
      if (b0) b0.classList.add('hide');
      const bar0 = $('trade-submit-bar');
      if (bar0) bar0.classList.add('hide');
      this._tradeToastKey = null;
      if (body.dataset.mode !== 'single') {
        body.dataset.mode = 'single';
        body.innerHTML = '<div class="trade-note">单机（热座）模式没有玩家间交易。<br>开一局「联机对战」，才能和真人谈价换地、卖分红权。</div>';
      }
      return;
    }
    btn.classList.remove('hide');

    const me = this.meNow();
    const seat = this._tradeSeat();
    const tr = (g.trade && g.trade.status === 'pending') ? g.trade : null;
    const mine = !!(tr && me && tr.to === seat);          // 有人报价给我，等我回应
    const iSent = !!(tr && me && tr.from === seat);       // 我报的价，等对方回应
    const involved = mine || iSent;

    /* 交易对象：默认挑第一个还活着的别人 */
    const others = me ? g.players.filter(p => p.alive && p.id !== me.id) : [];
    if (me && (this._tradeTo == null || !others.some(p => p.id === this._tradeTo))) {
      this._tradeTo = others.length ? others[0].id : null;
    }

    /* 竖排按钮：待我回应 → 小红点 + 呼吸提示 */
    const sub = $('rail-trade-sub'), badge = $('rail-trade-badge');
    if (mine) {
      if (sub) { sub.textContent = '待回应'; sub.className = 'rsub wait'; }
      if (badge) { badge.textContent = '1'; badge.classList.remove('hide'); }
    } else if (tr) {
      if (sub) { sub.textContent = involved ? '等回应' : '有人谈'; sub.className = 'rsub'; }
      if (badge) badge.classList.add('hide');
    } else {
      if (sub) { sub.textContent = '自由谈'; sub.className = 'rsub'; }
      if (badge) badge.classList.add('hide');
    }
    if (mine && !this.isDrawerOpen('trade')) btn.classList.add('hint');
    else btn.classList.remove('hint');

    /* 有新报价指向我 → 轻提示一次（key = 季度 + 发起人；这笔结束后下一笔会再提醒） */
    if (mine) {
      const key = tr.q + ':' + tr.from;
      if (this._tradeToastKey !== key) {
        this._tradeToastKey = key;
        const from = g.players[tr.from] ? g.players[tr.from].name : '对方';
        this.toast(from + ' 给你发了一笔交易报价，去「交易」面板看看');
      }
    } else this._tradeToastKey = null;

    if (body.dataset.mode !== 'net') {
      body.dataset.mode = 'net';
      body.innerHTML = '<div id="trade-pending"></div><div id="trade-form"></div>';
      this._tradeSig = null;                 // 骨架重建了，表单必须重画
    }

    /* 待处理区每次都重画（内容随推送变），按钮重新绑 */
    const pend = $('trade-pending');
    pend.innerHTML = this.tradePendingHTML(tr, seat);
    const acc = $('t-accept'), rej = $('t-reject'), can = $('t-cancel');
    if (acc) acc.addEventListener('click', () => this.send('respondTrade', { accept: true }));
    if (rej) rej.addEventListener('click', () => this.send('respondTrade', { accept: false }));
    if (can) can.addEventListener('click', () => this.send('cancelTrade', {}));

    /* 发起报价的表单只在"结构变了"时重画，免得状态推送把正在填的内容冲掉 */
    const sig = this.tradeFormSig(me, tr);
    if (sig !== this._tradeSig) {
      this._tradeSig = sig;
      $('trade-form').innerHTML = this.tradeFormHTML(me, tr);
      this.bindTradeForm();
    }

    /* 提交条：抽屉底部的固定条（不在滚动区里，所以列表再长也压不到它） */
    const bar = $('trade-submit-bar');
    if (bar) {
      const usable = !!(me && CONFIG.trade.enabled && others.length);
      bar.classList.toggle('hide', !usable);
      if (usable && bar.dataset.sig !== sig) {
        bar.dataset.sig = sig;
        bar.innerHTML = '<span class="trade-hint" id="trade-hint"></span>' +
          '<button class="btn ok" id="t-propose" disabled>发出报价</button>';
        const pb = $('t-propose');
        if (pb) pb.addEventListener('click', () => this.onProposeTrade());
      }
      if (usable) this.updateTradeHint();
    }
  },

  /* 待处理报价：按"这笔和我什么关系"分三种口径 */
  tradePendingHTML(tr, seat) {
    const g = this.g;
    if (!tr) return '<div class="tsec-h">待处理的报价</div><div class="trade-note">现在没有待处理的报价，可以自由发起。</div>';
    const nm = i => (g.players[i] ? g.players[i].name : ('座位 ' + i));
    const who = i => (i === seat ? '你' : nm(i));
    const mine = tr.to === seat, iSent = tr.from === seat;
    let line, acts = '';
    if (mine) {
      line = `<b class="tq-from">${nm(tr.from)}</b> 想用左边这些，换你右边的这些：`;
      acts = '<div class="tbtn-row"><button class="btn ok" id="t-accept">接受</button><button class="btn ghost" id="t-reject">拒绝</button></div>';
    } else if (iSent) {
      line = `你已报价给 <b class="tq-from">${nm(tr.to)}</b>，等对方回应。`;
      acts = '<div class="tbtn-row"><button class="btn ghost" id="t-cancel">撤回报价</button></div>';
    } else {
      line = `<b class="tq-from">${nm(tr.from)}</b> 正在和 <b class="tq-from">${nm(tr.to)}</b> 谈（和你无关）。`;
    }
    return `<div class="tsec-h">待处理的报价</div>
      <div class="trade-quote">
        <div class="tq-line">${line}</div>
        <div class="tcols">
          <div class="tcol"><div class="tcol-h">${who(tr.from)} 拿出</div>${this.tradeSideHTML(tr.give)}</div>
          <div class="tcol"><div class="tcol-h">${who(tr.to)} 拿出</div>${this.tradeSideHTML(tr.want)}</div>
        </div>
        ${acts}
      </div>`;
  },

  /* 把 give / want 列成清单：现金 → 地块 → 股票 → 分红权 */
  tradeSideHTML(side) {
    const g = this.g;
    const s = side || {};
    const rows = [];
    if ((s.cash || 0) > 0) rows.push(`<div class="trow"><span class="tamt">${fmt(s.cash)}</span> 现金</div>`);
    for (const id of (s.tiles || [])) {
      const t = g.tile(id);
      rows.push(`<div class="trow">🏠 ${t ? t.name : '地块 ' + id}${t && t.mortgaged ? '<em class="twarn">抵押中</em>' : ''}</div>`);
    }
    for (const code in (s.stocks || {})) {
      if ((s.stocks[code] | 0) > 0) rows.push(`<div class="trow">${this.tradeStockLabel(code)} <b>×${s.stocks[code] | 0}</b></div>`);
    }
    for (const r of (s.rentShares || [])) {
      const t = g.tile(r.tileId);
      rows.push(`<div class="trow">📜 ${t ? t.name : '地块 ' + r.tileId} <b>${r.pct | 0}%</b> 分红权</div>`);
    }
    return rows.length ? rows.join('') : '<div class="trow tempty">（什么也不给）</div>';
  },
  /* 股票代码翻成人名：001 → "001 提瓦特地产" */
  tradeStockLabel(code) {
    const s = (this.g && this.g.stockByCode) ? this.g.stockByCode(code) : null;
    return `<span class="tcode">${code}</span> ${s ? s.name : '未知股票'}`;
  },

  /* 表单结构签名：只有它变了才重画表单（不然推送一来就把填的一半清掉） */
  tradeFormSig(me, tr) {
    const g = this.g;
    if (!me || !g) return 'none';
    const other = g.players[this._tradeTo];
    const tiles = own => g.tiles.filter(t => t.owner === own)
      .map(t => t.id + (t.mortgaged ? 'M' : '') + (t.rentShare ? 'R' : '') + t.level).join(',');
    return [
      this._tradeTo, me.jailTurns,
      tiles(me.id), JSON.stringify(me.stocks || {}),
      other ? tiles(other.id) : '', other ? JSON.stringify(other.stocks || {}) : '',
      tr ? 'T' : '-', CONFIG.trade.enabled ? 1 : 0, g.over ? 'O' : '-',
    ].join('|');
  },

  tradeFormHTML(me, tr) {
    const g = this.g;
    const C = CONFIG.trade;
    if (!C.enabled) return '<div class="tsec-h">发起报价</div><div class="trade-note">本局关闭了玩家间交易。</div>';
    if (!me) return '';
    const others = g.players.filter(p => p.alive && p.id !== me.id);
    const toBtns = others.map(p =>
      `<button class="tplayer${this._tradeTo === p.id ? ' on' : ''}" data-to="${p.id}"><i style="background:${p.color}"></i>${p.name}</button>`).join('');
    const head = `<div class="tsec-h">发起报价</div>
      <div class="trade-target">${toBtns || '<span class="trade-note">场上没有其他存活玩家</span>'}</div>`;
    if (!others.length) return head + '<div class="trade-note">没有可交易的对象了。</div>';
    const other = g.players[this._tradeTo];
    if (!other) return head + '<div class="trade-note">先选一个交易对象。</div>';

    let lock = '';
    if (tr) lock = '已经有一笔待回应的报价了，等它结束（或撤回）再发新的。';
    else if (me.jailTurns > 0) lock = '你在坐牢，不能谈生意（和炒股一样）。';
    else if (g.over) lock = '对局已经结束。';
    const dis = lock ? ' disabled' : '';

    /* 表单草稿：重画时把已经填的值带回来，别把玩家正在输入的东西冲掉 */
    const d = this._tfDraft || {};
    const dg = d.give || {}, dw = d.want || {};
    const dCash = side => Math.max(0, Math.round((side === 'give' ? dg.cash : dw.cash) || 0));
    const dTiles = side => (side === 'give' ? dg.tiles : dw.tiles) || [];
    const dStocks = side => (side === 'give' ? dg.stocks : dw.stocks) || {};
    const dShare = id => {
      for (const r of (dg.rentShares || [])) if (r.tileId === id) return r.pct;
      return null;
    };

    const myTiles = g.tiles.filter(t => t.owner === me.id);
    const otherTiles = g.tiles.filter(t => t.owner === other.id);

    /* 地块勾选：抵押中的置灰禁选（服务端也会拒），「我要」栏一并禁掉 */
    const tileRow = (t, side) => {
      const off = !!t.mortgaged;
      const on = !off && dTiles(side).indexOf(t.id) >= 0;
      return `<label class="tchk${off ? ' off' : ''}">
        <input type="checkbox" data-side="${side}" data-tile="${t.id}"${on ? ' checked' : ''}${off || dis ? ' disabled' : ''}>
        <span>${t.name}</span>${off ? '<em class="twarn">抵押中</em>' : ''}
      </label>`;
    };
    /* 分红权：只有地主本人能挂出来卖，一块地只能卖一次 */
    const shareRow = t => {
      const sold = !!t.rentShare;
      const off = sold || !!t.mortgaged;
      const why = sold ? '已卖分红权' : (t.mortgaged ? '抵押中' : '');
      const pct = off ? 30 : (dShare(t.id) == null ? 30 : dShare(t.id));
      const on = !off && dShare(t.id) != null;
      return `<label class="tchk${off ? ' off' : ''}">
        <input type="checkbox" data-rs="${t.id}"${on ? ' checked' : ''}${off || dis ? ' disabled' : ''}>
        <span>${t.name}</span>${why ? `<em class="twarn">${why}</em>` : ''}
        <input type="number" class="tpct" data-rspct="${t.id}" min="${C.minRentSharePct}" max="${C.maxRentSharePct}" value="${pct}"${off || dis ? ' disabled' : ''}><em>%</em>
      </label>`;
    };
    const stockRows = (p, side) => {
      const codes = Object.keys(p.stocks || {}).filter(c => (p.stocks[c] | 0) > 0);
      if (!codes.length) return '<div class="trow tempty">没有股票</div>';
      const ds = dStocks(side);
      return codes.map(c => {
        const held = p.stocks[c] | 0;
        const v = Math.max(0, Math.min(held, ds[c] | 0));
        return `<div class="trow">${this.tradeStockLabel(c)}
          <input type="number" data-side="${side}" data-stock="${c}" min="0" max="${held}" value="${v}"${dis}>
          <em>/ ${held} 股</em></div>`;
      }).join('');
    };
    const list = (rows, empty) => rows.length ? rows.join('') : `<div class="trow tempty">${empty || '没有地块'}</div>`;

    return `${head}
      ${lock ? `<div class="trade-note warn">${lock}</div>` : ''}
      <div class="tcols">
        <div class="tcol">
          <div class="tcol-h">我出</div>
          <div class="trow tlab">现金</div>
          <input type="number" class="tcash" data-side="give" min="0" value="${dCash('give')}"${dis}>
          <div class="trow tlab">地块</div>${list(myTiles.map(t => tileRow(t, 'give')))}
          <div class="trow tlab">股票</div>${stockRows(me, 'give')}
          <div class="trow tlab">卖分红权</div>${list(myTiles.map(shareRow), '没有可卖分红权的地块')}
        </div>
        <div class="tcol">
          <div class="tcol-h">我要（${other.name}）</div>
          <div class="trow tlab">现金</div>
          <input type="number" class="tcash" data-side="want" min="0" value="${dCash('want')}"${dis}>
          <div class="trow tlab">地块</div>${list(otherTiles.map(t => tileRow(t, 'want')))}
          <div class="trow tlab">股票</div>${stockRows(other, 'want')}
          <div class="trow tlab">分红权</div>
          <div class="trow tempty">分红权只能由地主自己挂出来卖</div>
        </div>
      </div>`;
  },

  bindTradeForm() {
    const form = $('trade-form');
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll('.tplayer[data-to]'), b =>
      b.addEventListener('click', () => {
        const to = parseInt(b.dataset.to, 10);
        if (to !== this._tradeTo) {
          this._tradeTo = to;
          /* 换对手：我出的东西留着，我要的东西清掉（那是冲着上一个人要的） */
          const d = this._tfDraft || {};
          this._tfDraft = { give: d.give || null, want: null };
        }
        this._tradeSig = null;                 // 换对象 → 强制重画
        this.renderTrade();
      }));
    Array.prototype.forEach.call(form.querySelectorAll('input'), i =>
      i.addEventListener('input', () => this.updateTradeHint()));
    Array.prototype.forEach.call(form.querySelectorAll('input[type=checkbox]'), i =>
      i.addEventListener('change', () => this.updateTradeHint()));
    this.updateTradeHint();          // 提交按钮在 #trade-submit-bar 里，由 renderTrade 绑定
  },

  /* 提交按钮可用性 + 一句提醒：两边都空着不让发 */
  updateTradeHint() {
    const s = this.readTradeForm();
    this._tfDraft = { give: s.give, want: s.want };    // 先存草稿，重画表单时不丢
    const btn = $('t-propose');
    if (!btn) return;
    const hasGive = this.tradeSideHas(s.give), hasWant = this.tradeSideHas(s.want);
    btn.disabled = !(hasGive || hasWant);
    const hint = $('trade-hint');
    if (!hint) return;
    let txt = '两边都空着，先填点东西。', warn = false;
    if (hasGive || hasWant) {
      if (!hasGive) { txt = '「我出」是空的——只拿不给，对方多半不会答应。'; warn = true; }
      else if (!hasWant) { txt = '你没要对方任何东西——等于白送。'; warn = true; }
      else txt = '发出去等对方回应；同时只能有一笔待回应的报价。';
    }
    hint.textContent = txt;
    hint.className = 'trade-hint' + (warn ? ' warn' : '');
  },

  /* 读表单 → proposeTrade 的 give / want */
  readTradeForm() {
    const form = $('trade-form');
    const out = {
      to: this._tradeTo,
      give: { cash: 0, tiles: [], stocks: {}, rentShares: [] },
      want: { cash: 0, tiles: [], stocks: {}, rentShares: [] },
    };
    if (!form) return out;
    Array.prototype.forEach.call(form.querySelectorAll('input.tcash[data-side]'), i => {
      out[i.dataset.side].cash = Math.max(0, Math.floor(Number(i.value) || 0));
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[type=checkbox][data-tile]'), i => {
      if (i.checked) out[i.dataset.side].tiles.push(parseInt(i.dataset.tile, 10));
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[type=checkbox][data-rs]'), i => {
      if (!i.checked) return;
      const id = parseInt(i.dataset.rs, 10);
      const el = form.querySelector('input[data-rspct="' + id + '"]');
      const C = CONFIG.trade;
      let pct = Math.round(Number(el && el.value) || 0);
      pct = Math.max(C.minRentSharePct, Math.min(C.maxRentSharePct, pct));
      out.give.rentShares.push({ tileId: id, pct });
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[data-stock]'), i => {
      const q = Math.floor(Number(i.value) || 0);
      if (q > 0) out[i.dataset.side].stocks[i.dataset.stock] = q;
    });
    return out;
  },

  /* 一边是不是"有东西"（和引擎的 _sideEmpty 同一口径） */
  tradeSideHas(s) {
    if (!s) return false;
    if ((s.cash || 0) > 0) return true;
    if ((s.tiles || []).length) return true;
    if ((s.rentShares || []).length) return true;
    for (const c in (s.stocks || {})) if ((s.stocks[c] | 0) > 0) return true;
    return false;
  },

  onProposeTrade() {
    const g = this.g;
    if (!this.net || !g || g.over) return;
    const me = this.meNow();
    if (!me) return;
    if (g.trade && g.trade.status === 'pending') { this.toast('已经有一笔待回应的报价了'); return; }
    if (me.jailTurns > 0) { this.toast('你在坐牢，不能谈生意'); return; }
    const s = this.readTradeForm();
    const to = s.to;
    if (to == null || !g.players[to] || !g.players[to].alive) { this.toast('先选一个交易对象'); return; }
    if (to === me.id) { this.toast('不能和自己交易'); return; }
    if (!this.tradeSideHas(s.give) && !this.tradeSideHas(s.want)) { this.toast('报价两边都是空的'); return; }
    this.send('proposeTrade', { to, give: s.give, want: s.want });
    this._tfDraft = null;                 // 发出去了就清空表单
    this._tradeSig = null;
    this.renderTrade();
    this.toast('报价已发出，等对方回应');
  },

  /* 金融产品面板 */
  renderCards() {
    const g = this.g;
    if (!g) return;
    /* ★ 面板显示"我"的金融产品，而不是当前行动那个人的 —— 别人的回合也要能看自己的仓位 */
    const p = this.meNow();
    if (!p) return;
    /* 买卖仍然绑回合（这次只解绑了炒股）：掷骰前和交易阶段都能买 */
    const tradePhase = g.phase === 'awaiting-roll' || g.phase === 'awaiting-trade';
    const canBuy = !g.over && !p.isAI && tradePhase && this.isMyTurn();
    const C = CONFIG.cards;
    const pr = p.products;
    const hot = g.highRiskHeld(p);
    const optTile = pr.option ? g.tile(pr.option.tileId) : null;
    const money2 = n => (n ? fmt(n) : '血本无归');

    const rows = [
      {
        k: 'venture', n: '风险投资卡', cost: C.ventureCost, tag: '高风险 · 即开',
        d: '一掷千金，瞬间改变阶级。买完立刻掷 2 颗骰：' +
           C.ventureTable.map(r => `${r.min === r.max ? r.min : r.min + '-' + r.max}点 ${money2(r.pay)}`).join('　'),
        s: '', ok: canBuy && p.cash >= C.ventureCost,
      },
      {
        k: 'junk', n: '垃圾债券', cost: C.junkCost, tag: '高风险 · 持有',
        d: `每圈经过起点额外领 ${fmt(C.junkPayment)}，直到骰子把你炸飞（每圈 1/6 概率爆雷作废）`,
        s: pr.junk ? `持有中 · 已领 ${pr.junk.laps} 圈` : (hot ? '与地产期权互斥' : ''),
        ok: canBuy && !hot && p.cash >= C.junkCost,
      },
      {
        k: 'option', n: '地产期权合约', cost: C.optionCost, tag: '高风险 · 持有',
        d: `花小钱锁定一块无主地 ${C.optionMarks} 圈：自己踩到半价买下，别人踩到要多付 ${fmt(C.optionFee)} 给你`,
        s: pr.option ? `锁定中：${optTile ? optTile.name : '?'} · 剩 ${pr.option.marks} 圈` : (hot ? '与垃圾债券互斥' : ''),
        ok: canBuy && !hot && p.cash >= C.optionCost,
      },
      {
        k: 'insurance', n: '租金保险', cost: C.insuranceCost, tag: '低风险 · 一次性',
        d: `下次付租金时只付 ${Math.round(C.insuranceSelfRate * 100)}%，其余由银行补给房东（单次上限 ${fmt(C.insuranceBankCap)}）`,
        s: pr.insurance ? '已投保，等待触发' : '',
        ok: canBuy && !pr.insurance && p.cash >= C.insuranceCost,
      },
      {
        k: 'deposit', n: `${C.depositMarks} 圈定期存单`, cost: C.depositAmount, tag: '低风险 · 持有',
        d: `零风险：到期拿回 ${fmt(Math.round(C.depositAmount * C.depositRate))}（+${Math.round((C.depositRate - 1) * 100)}%）。提前赎回净亏 ${fmt(C.depositPenalty)}`,
        s: pr.deposit ? `还剩 ${pr.deposit.marks} 圈到期` : '',
        ok: canBuy && !pr.deposit && p.cash >= C.depositAmount,
      },
    ];

    $('card-list').innerHTML = rows.map(r => `
      <div class="card-row${r.s ? ' held' : ''}">
        <div class="cr-head">
          <b>${r.n}</b>
          <span class="cr-tag">${r.tag}</span>
          <span class="cr-cost">${fmt(r.cost)}</span>
        </div>
        <div class="cr-desc">${r.d}</div>
        <div class="cr-foot">
          <span class="cr-state">${r.s || (p.cash < r.cost ? '现金不足' : '可以购买')}</span>
          <button class="cr-buy" data-card="${r.k}" ${r.ok ? '' : 'disabled'}>购买</button>
        </div>
      </div>`).join('') +
      (pr.deposit ? `<div class="card-row"><div class="cr-foot" style="justify-content:flex-end">
          <button class="cr-buy" data-card="redeem" ${canBuy ? '' : 'disabled'}>提前赎回存单</button></div></div>` : '');

    Array.prototype.forEach.call($('card-list').querySelectorAll('button[data-card]'), b => {
      b.addEventListener('click', () => this.onCard(b.dataset.card));
    });
  },

  onCard(kind) {
    const g = this.g, p = g.cur();
    if (!g || g.over || !p || p.isAI || (g.phase !== 'awaiting-roll' && g.phase !== 'awaiting-trade')) { this.toast('只能在自己的回合里操作'); return; }
    if (this.net) {
      if (!this.isMyTurn()) { this.toast('还没轮到你'); return; }
      if (kind === 'option') { this.optionPickModal(true); return; }
      const map = { venture: 'venture', junk: 'junk', insurance: 'insurance', deposit: 'deposit', redeem: 'redeemDeposit' };
      this.send('card', { kind: map[kind] || kind });
      return;
    }
    if (kind === 'option') { this.optionPickModal(); return; }
    const fn = {
      venture: () => {
        const r = g.buyVenture(p);
        if (!r.ok) { this.toast(r.msg); return; }
        this.modal({
          title: '风险投资卡 · 开奖',
          sub: `${p.name} 付出了 ${fmt(CONFIG.cards.ventureCost)}`,
          body: `<div class="card-face chance"><div class="cf-k">VENTURE</div>
            <div class="cf-t">${r.dice[0]} + ${r.dice[1]} = ${r.total}</div>
            <div class="cf-d">${r.text}<br><b style="font-size:16px;color:${r.delta >= 0 ? '#86efac' : '#fca5a5'}">${r.delta >= 0 ? '+' : ''}${fmt(r.delta)}</b></div></div>`,
          actions: [{ label: '知道了', cls: 'ok' }],
          auto: p.isAI ? 1600 : 0,
        });
      },
      junk: () => { const r = g.buyJunkBond(p); if (!r.ok) this.toast(r.msg); },
      insurance: () => { const r = g.buyInsurance(p); if (!r.ok) this.toast(r.msg); },
      deposit: () => { const r = g.buyDeposit(p); if (!r.ok) this.toast(r.msg); },
      redeem: () => { const r = g.redeemDeposit(p); if (!r.ok) this.toast(r.msg); },
    }[kind];
    if (fn) fn();
    this.renderAll();
  },

  optionPickModal(netMode) {
    const g = this.g, p = g.cur();
    const free = g.tiles.filter(t => t.type === 'land' && t.owner < 0 && !g.optionOn(t.id));
    if (!free.length) { this.toast('没有可锁定的无主地块了'); return; }
    free.sort((a, b) => b.basePrice - a.basePrice);
    const body = free.map(t => {
      const prog = g.groupProgress(p.id, t.group);
      return `<div class="kv"><span>${t.name} <em style="color:#5f7392;font-style:normal">${GROUPS[t.group].name}${prog.have ? ' · 你已有 ' + prog.have + '/' + prog.total : ''}</em></span>
        <b>${fmt(g.landPrice(t))} <button class="mini-buy" data-tile="${t.id}">锁定</button></b></div>`;
    }).join('');
    const box = this.modal({
      title: '选择要锁定的地块',
      sub: `花 ${fmt(CONFIG.cards.optionCost)} 锁定 ${CONFIG.cards.optionMarks} 圈。优先锁你差一块就垄断的地区，或者最贵的地。`,
      body,
      actions: [{ label: '取消', cls: 'ghost' }],
    });
    Array.prototype.forEach.call(box.querySelectorAll('button[data-tile]'), b => {
      b.addEventListener('click', () => {
        const id = parseInt(b.dataset.tile, 10);
        if (netMode) this.send('card', { kind: 'option', tileId: id });
        else {
          const r = g.buyOption(id, p);
          if (!r.ok) this.toast(r.msg);
        }
        $('modal-root').innerHTML = '';
        this.renderAll();
      });
    });
  },

  syncBoard() {
    const g = this.g;
    const cur = g.over ? null : g.cur();
    const here = cur ? cur.pos : -1;
    TILES.forEach((t, i) => {
      const s = g.tile(i);
      const el = this.tileEls[i];
      const corner = i % 10 === 0;
      const owned = s.owner >= 0;
      const owner = owned ? g.players[s.owner] : null;
      /* ★ 地区色单独提出来：原来它只用在顶部一根 5px 细条上，玩家基本看不见。
         现在整格都能引用 --gc（描边、底纹、垄断发光），"这是哪个地区"一眼可辨。 */
      const groupColor = s.group && GROUPS[s.group] ? GROUPS[s.group].color
        : (s.type === 'rail' ? '#cbd5e1' : s.type === 'utility' ? '#7dd3fc' : null);
      /* ★ 垄断：一个人独占整个地区。以前棋盘上**完全没有**这个标识，
         明明是最重要的翻盘点却看不见。 */
      const mono = !!(s.group && s.type === 'land' && owner && g.ownsGroup(owner.id, s.group));
      el.className = 'tile t-' + s.type + (corner ? ' corner' : ' ' + tileSide(i)) +
        (owned ? ' owned' : '') + (s.mortgaged ? ' mortgaged' : '') +
        (mono ? ' mono' : '') + (i === here ? ' here' : '');
      el.style.setProperty('--own', owner ? owner.color : 'transparent');
      el.style.setProperty('--gc', groupColor || '#30425f');
      if (cur) el.style.setProperty('--here', cur.color);

      let priceTxt = '';
      if (t.basePrice) priceTxt = owned ? fmtShort(g.assetValue(s)) : fmtShort(g.landPrice(s));
      const pips = (s.type === 'land' && s.level >= 1) ? `<div class="lv">${'<i></i>'.repeat(s.level)}</div>` : '';
      const opt = g.optionOn ? g.optionOn(i) : null;
      const badge = s.mortgaged
        ? `<div class="badge${s.marginCall ? ' call' : ''}">${s.marginCall ? '追缴' : '抵押'}</div>`
        : (opt ? `<div class="badge opt">期权</div>` : '');

      if (corner) {
        el.innerHTML = `<div class="body"><div class="icon">${ICONS[s.type] || ''}</div>` +
          `<div class="nm">${s.short}</div></div>${badge}<div class="tokens"></div>`;
      } else {
        const elem = s.group && GROUPS[s.group] ? GROUPS[s.group].elem : null;
        const ec = elem && ELEMENTS[elem] ? ELEMENTS[elem].color : (groupColor || '#5f7392');
        let ava = '';
        if (elem) {
          const img = (t.avatar && this.avatarOK[t.avatar])
            ? `<img class="ch" src="${avatarSrc(t.avatar)}" alt="${t.char || ''}" draggable="false">` : '';
          /* 没有角色头像时用官方元素徽记（assets/elements/），没有再回退到内置 SVG */
          const elImg = (!img && this.elemOK[elem])
            ? `<img class="el" src="${elemSrc(elem)}" alt="${ELEMENTS[elem] ? ELEMENTS[elem].name : ''}" draggable="false">` : '';
          ava = `<div class="ava${img ? ' has-img' : ''}${elImg ? ' elem-img' : ''}" style="--ec:${ec}" title="${t.char ? t.char + ' · ' : ''}${GROUPS[s.group] ? GROUPS[s.group].name : ''}">` +
            `<svg viewBox="0 0 24 24" fill="none">${ELEM_ICON[elem] || ''}</svg>${elImg}${img}</div>`;
        }
        el.innerHTML =
          `<div class="bar"${groupColor ? ` style="background:${groupColor}"` : ''}></div>` +
          ava +
          `<div class="body">` +
          `<div class="nm">${s.short}</div>` +
          `<div class="meta"><span class="pr">${priceTxt || ''}</span>${pips}</div>` +
          `</div>${badge}<div class="tokens"></div>`;
      }
    });
    this.syncTokens();
  },
  syncTokens() {
    const g = this.g;
    const me = this.meNow();
    const meId = me ? me.id : -1;
    const curId = g.over ? -1 : g.current;
    this.tileEls.forEach((el, i) => {
      const box = el.querySelector('.tokens');
      if (!box) return;
      const here = g.players.filter(p => p.alive && p.pos === i);
      /* ★ 只有真的有棋子的格子才让出底部轨道高度（给 .body 加 has-tk），
         空格子把空间全留给地名——否则小分辨率下文字会被压没。 */
      el.classList.toggle('has-tk', here.length > 0);
      /* ⚠️ 这里**绝对不能**加"内容没变就跳过重绘"的缓存。
         syncBoard() 每次状态推送都会重写整格的 innerHTML（棋子一起被抹掉），
         如果再按签名跳过重绘，棋子就永远补不回来——表现是"只有玩家移动那一瞬间
         才看得见棋子"，这是个真实发生过的 bug。所以每次都老老实实重画。 */
      box.innerHTML = here
        .map(p => {
          const cls = 'tk' + (p.id === curId ? ' cur' : '') + (p.id === meId ? ' me' : '');
          return `<i class="${cls}" style="--c:${p.color}" title="${p.name}">${p.id + 1}</i>`;
        }).join('');
    });
  },

  renderTop() {
    const g = this.g;
    const total = g.config && g.config.maxQuarters ? g.config.maxQuarters : CONFIG.maxQuarters;
    $('ts-quarter').textContent = Math.min(g.quarter || 1, total) + ' / ' + total;
    $('ts-rei').textContent = g.rei.toFixed(1);
    const prev = g.reiHist.length > 1 ? g.reiHist[g.reiHist.length - 2] : g.rei;
    const d = g.rei - prev;
    const dEl = $('ts-rei-delta');
    dEl.textContent = (d >= 0 ? '+' : '') + d.toFixed(1);
    dEl.className = 'delta ' + (d >= 0 ? 'up' : 'down');
    const p = g.cur();
    $('ts-current').textContent = p ? p.name + (p.isAI ? '（电脑）' : '') : '—';
  },

  renderCenter() {
    const g = this.g;
    const p = g.cur();
    $('rei-value').textContent = g.rei.toFixed(1);
    $('rei-mult').textContent = Math.round(g.rei) + '%';
    const cl = g.cycleLabel();
    const cy = $('rei-cycle');
    if (cy) {
      cy.textContent = cl.name;
      cy.style.color = cl.cls === 'up' ? '#34d399' : cl.cls === 'down' ? '#fb7185' : '#93a7c4';
    }
    /* 折叠状态下中央显示实时排行榜 */
    if ($('mini-rank')) {
      const board = g.players.slice().sort((a, b) => g.netWorth(b) - g.netWorth(a));
      const top = Math.max(1, g.netWorth(board[0]));
      $('mini-rank').innerHTML =
        `<div class="mr-head">净资产排行 · 第 ${Math.min(g.quarter, g.totalQuarters())} / ${g.totalQuarters()} 季度</div>` +
        board.map((pl, i) => {
          const net = g.netWorth(pl);
          return `<div class="mr-row${i === 0 && pl.alive ? ' lead' : ''}${pl.alive ? '' : ' dead'}">
            <span class="mr-i">${i + 1}</span>
            <i class="mr-dot" style="background:${pl.color};color:${pl.color}"></i>
            <span class="mr-n">${pl.name}${pl.isAI ? '' : ''}${pl.alive ? '' : ' · 出局'}</span>
            <span class="mr-bar"><i style="width:${Math.max(0, net) / top * 100}%;background:${pl.color}"></i></span>
            <b class="mr-v">${fmt(net)}</b>
          </div>`;
        }).join('');
    }
    const prev = g.reiHist.length > 1 ? g.reiHist[g.reiHist.length - 2] : g.rei;
    const d = g.rei - prev;
    const rEl = $('rei-delta');
    rEl.textContent = (d >= 0 ? '▲ +' : '▼ ') + d.toFixed(1);
    rEl.className = 'rei-delta ' + (d >= 0 ? 'up' : 'down');
    $('rei-chart').innerHTML = reiChart(g.reiHist, d >= 0 ? '#34d399' : '#fb7185');

    $('turn-player').textContent = p ? p.name + (p.isAI ? '（电脑）' : '') : '—';
    $('turn-player').style.color = p ? p.color : '#fff';
    $('turn-box').style.borderLeftColor = p ? p.color : '#1f304c';

    /* 局面速览 */
    const lands = g.tiles.filter(t => t.type === 'land');
    const unsold = lands.filter(t => t.owner < 0).length;
    const mortgages = g.tiles.filter(t => t.owner >= 0 && t.mortgaged).length;
    const rank = g.players.filter(x => x.alive).sort((a, b) => g.netWorth(b) - g.netWorth(a));
    const myRank = p ? rank.findIndex(x => x.id === p.id) + 1 : 0;
    let taxBase = 0;
    if (p) {
      for (const t of g.tiles) {
        if (t.owner !== p.id) continue;
        taxBase += g.assetValue(t) * (t.mortgaged ? CONFIG.propertyTaxMortgagedFactor : 1);
      }
    }
    const nextTax = Math.round(taxBase * CONFIG.propertyTaxRate / 100) * 100;
    $('mini-stats').innerHTML =
      `<div class="ms-item"><span>未售地块</span><b>${unsold} / ${lands.length}</b></div>` +
      `<div class="ms-item"><span>抵押中</span><b>${mortgages} 处</b></div>` +
      `<div class="ms-item"><span>本季物业税</span><b style="color:${nextTax > (p ? p.cash : 0) ? '#fb7185' : '#e9f0fb'}">${fmt(nextTax)}</b></div>` +
      `<div class="ms-item"><span>净资产排名</span><b>${myRank ? myRank + ' / ' + rank.length : '—'}</b></div>` +
      `<div class="ms-item wide"><span>${p ? p.name : '—'} 净资产</span><b>${p ? fmt(g.netWorth(p)) : '—'}</b></div>`;

    /* 资产构成 */
    const cash = Math.max(0, p ? p.cash : 0);    const landVal = p ? g.ownedTiles(p.id).reduce((a, t) => a + g.assetValue(t) - (t.mortgaged ? t.loan : 0), 0) : 0;
    const stockVal = p ? g.stocks.reduce((a, s) => a + (p.stocks[s.code] || 0) * g.stockPrice(s), 0) : 0;
    const total = (cash + landVal + stockVal) || 1;
    const pct = v => (Math.max(0, v) / total * 100).toFixed(2) + '%';
    $('asset-split').innerHTML =
      `<div class="as-head"><span>资产构成</span><b>合计 ${fmt(total)}</b></div>` +
      `<div class="as-bar">` +
      `<i style="width:${pct(cash)};background:#4cc2f1"></i>` +
      `<i style="width:${pct(landVal)};background:#f0b73c"></i>` +
      `<i style="width:${pct(stockVal)};background:#b48cf2"></i>` +
      `</div>` +
      `<div class="as-legend">` +
      `<span><em style="background:#4cc2f1"></em>现金 ${fmt(cash)}</span>` +
      `<span><em style="background:#f0b73c"></em>地产 ${fmt(landVal)}</span>` +
      `<span><em style="background:#b48cf2"></em>股票 ${fmt(stockVal)}</span>` +
      `</div>`;

    const hints = {
      'awaiting-roll': '轮到你行动了，掷骰子吧。',
      'awaiting-jail': '你在梅洛彼得堡里：交保释金立刻行动，或者放弃本回合。',
      'awaiting-buy': '这块地还没主人，考虑一下要不要买。',
      'awaiting-event': '抽到一张卡，看看是什么。',
      'awaiting-trade': '交易阶段：可以买卖股票、升级/抵押自己的地块，然后结束回合。',
      'over': '游戏结束。',
    };
    $('turn-hint').textContent = g.over ? '游戏结束' : (hints[g.phase] || '');

    const acts = $('center-actions');
    acts.innerHTML = '';    const addBtn = (label, cls, fn, disabled) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || '');
      b.textContent = label;
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      acts.appendChild(b);
      return b;
    };

    if (g.over) {
      addBtn('查看结算', 'ok', () => this.showResult());
      /* ★ 联机下"再来一局"必须先**退掉当前房间的身份**再刷新。
         只 reload 的话，net.js 的 tryReconnect 会在刷新后又把玩家接回这个已结束的房间，
         屏幕上还是结算画面、回不到开局设置 —— 这就是"结束后再来一局无法正常启动"。 */
      addBtn('再来一局', '', () => {
        try { if (NET && NET.clear) NET.clear(); } catch (e) {}
        location.reload();
      });
      return;
    }
    const isAI = p && p.isAI;
    const my = this.isMyTurn();
    if (g.phase === 'awaiting-roll') {
      addBtn(!my ? '等待 ' + (p ? p.name : '') + ' 行动…' : (isAI ? '电脑思考中…' : '掷骰子'), '',
        () => this.doRoll(), isAI || this.busy || !my);
    } else if (g.phase === 'awaiting-jail') {
      addBtn('交保释金 ' + fmt(CONFIG.jailFine), 'ok', () => {
        if (this.net) { this.send('payJail'); return; }
        const r = g.payJail();
        if (!r.ok) this.toast(r.msg);
        this.renderAll();
      }, isAI || !my);
      addBtn('蹲着（放弃本回合）', 'ghost', () => {
        if (this.net) { this.send('stayJail'); return; }
        g.stayInJail(); this.afterStateChange();
      }, isAI || !my);
    } else if (g.phase === 'awaiting-trade') {
      addBtn(!my ? '等待 ' + (p ? p.name : '') + ' 行动…' : (isAI ? '电脑操作中…' : '结束回合'), 'ok',
        () => this.onEndTurn(), isAI || this.busy || !my);
      if (my && !isAI) addBtn('股市交易', 'gold', () => this.openDrawer('market'));
      if (my && !isAI) addBtn('金融产品', 'gold', () => this.openDrawer('cards'));
      addBtn('盘点资产', 'ghost', () => this.openDrawer('players'));
    } else if (this.net && g.pending && g.pending.type === 'buy' && my && !isAI) {
      addBtn('买下 ' + fmt(g.pending.price + (g.pending.optionFee || 0)), 'ok', () => this.buyModal());
    } else if (this.net && g.pending && g.pending.type === 'event' && my && !isAI) {
      addBtn('查看卡片', 'ok', () => this.eventModal());
    } else if (this.net && !my) {
      addBtn('等待 ' + (p ? p.name : '') + ' …', 'ghost', () => {}, true);
    }
    if (this.busy) $('dice-total').textContent = '…';
  },

  renderMarket() {
    const g = this.g;
    const p = this.meNow();          // ★ "我"的持仓，不是当前回合那个人的
    /* ★ 炒股已解绑回合：任何人的回合都能买卖，只排除"坐牢中"和"有人正在决定买地" */
    const canTrade = this.canTradeNow();
    $('market-list').innerHTML = g.stocks.map(s => {
      const price = g.stockPrice(s);
      const h = s.hist;
      const prev = h.length > 1 ? h[h.length - 2] : price;
      const chg = prev ? (price - prev) / prev : 0;
      const hold = p ? (p.stocks[s.code] || 0) : 0;
      const cls = chg > 0.0001 ? 'up' : chg < -0.0001 ? 'down' : '';
      const col = chg > 0.0001 ? '#34d399' : chg < -0.0001 ? '#fb7185' : '#64748b';
      return `<div class="stock${s.delisted ? ' dead' : ''}" style="--sc:${SECTOR_COLOR[s.sector] || '#2a3c58'}">
        <div class="s-head">
          <div>
            <div class="s-name">${s.name}<span class="s-code">${s.code}</span></div>
            <div class="s-desc">${s.desc}</div>
          </div>
          <div class="s-price">
            <b>${price.toFixed(1)}</b>
            <span class="delta ${cls}">${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(1)}%</span>
          </div>
        </div>
        <div class="s-spark">${sparkline(h, col, true)}</div>
        <div class="s-foot">
          <div class="s-hold">${hold ? `持 ${hold} 股 · ${fmt(hold * price)}` : '未持有'}</div>
          <div class="s-act">
            <button class="buy" data-code="${s.code}" data-side="buy" ${canTrade && !s.delisted ? '' : 'disabled'}>买</button>
            <button class="sell" data-code="${s.code}" data-side="sell" ${canTrade && hold > 0 ? '' : 'disabled'}>卖</button>
          </div>
        </div>
      </div>`;
    }).join('');
    $('market-list').querySelectorAll('button[data-code]').forEach(b => {
      b.addEventListener('click', () => this.onTrade(b.dataset.code, b.dataset.side));
    });
  },

  renderPlayers() {
    const g = this.g;
    const me = this.meNow();
    const meId = me ? me.id : -1;
    $('player-list').innerHTML = g.players.map(p => {
      const lands = g.ownedTiles(p.id).length;
      const shares = Object.values(p.stocks).reduce((a, b) => a + b, 0);
      const stockVal = g.stocks.reduce((a, s) => a + (p.stocks[s.code] || 0) * g.stockPrice(s), 0);
      const isCur = g.cur() && g.cur().id === p.id && !g.over;
      const isMe = p.id === meId;
      return `<div class="pcard${isCur ? ' active' : ''}${isMe ? ' mine' : ''}${p.alive ? '' : ' dead'}" style="--pc:${p.color}">
        <div class="pc-top"><span style="color:${p.color}">●</span>${p.name}
          ${isMe ? '<span class="pc-tag me">我</span>' : ''}
          <span class="pc-tag">${p.isAI ? '电脑' : '玩家'}</span>
          ${p.jailTurns > 0 ? '<span class="pc-tag" style="color:#fca5a5">狱中</span>' : ''}
        </div>
        <div class="pc-cash">${fmt(p.cash)}</div>
        <div class="pc-net">净资产 ${fmt(g.netWorth(p))}</div>
        <div class="pc-meta">地产 ${lands} 处 · 股票 ${shares} 股（${fmt(stockVal)}）</div>
      </div>`;
    }).join('');
  },

  renderLog() {
    const g = this.g;
    const box = $('log');
    const near = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = g.logs.slice(-160).map(l =>
      `<div class="log-line ${l.kind}"><span class="q">Q${l.q}</span>${l.msg}</div>`).join('');
    if (near) box.scrollTop = box.scrollHeight;
  },

  /* ================= 流程 ================= */
  startTurn() {
    if (this.net) return;
    const g = this.g;
    if (!g) return;
    if (g.over) { this.renderAll(); this.showResult(); return; }
    const p = g.cur();
    g.phase = p.jailTurns > 0 ? 'awaiting-jail' : 'awaiting-roll';
    this.renderAll();
    if (!p.isAI) return;
    if (p.jailTurns > 0) {
      setTimeout(() => {
        if (AI.decideJail(g, p)) { const r = g.payJail(); if (!r.ok) g.stayInJail(); }
        else g.stayInJail();
        this.afterStateChange();
      }, 800);
    } else {
      setTimeout(() => this.doRoll(), 850);
    }
  },

  async doRoll() {
    const g = this.g;
    if (!g || g.over || this.busy) return;
    if (g.phase !== 'awaiting-roll') return;
    if (this.net) { if (this.isMyTurn()) this.send('roll'); return; }
    const p = g.cur();
    if (p.isAI && this._aiRolling) return;
    this.busy = true;
    this.renderCenter();
    const r = g.rollDice();
    await this.animateDice(r);
    const mv = g.movePlayer(p, r.total);
    await this.animateMove(mv.path);
    const res = g.resolveLanding(r.total);
    this.busy = false;
    this.renderAll();
    this.afterLanding(res);
  },

  async animateDice(r) {
    const d1 = $('die1'), d2 = $('die2');
    d1.classList.add('rolling'); d2.classList.add('rolling');
    for (let i = 0; i < 8; i++) {
      d1.innerHTML = dieFace(1 + Math.floor(Math.random() * 6));
      d2.innerHTML = dieFace(1 + Math.floor(Math.random() * 6));
      await sleep(55);
    }
    d1.classList.remove('rolling'); d2.classList.remove('rolling');
    paintDice(d1, d2, r.dice, r.total);
    $('dice-total').textContent = '= ' + r.total + (r.doubles ? ' · 双数' : '');
    this.renderLog();
  },

  async animateMove(path) {
    const g = this.g;
    const p = g.cur();
    const start = p.pos;
    for (const step of path) {
      p.pos = step;
      this.syncTokens();
      await sleep(110);
    }
    p.pos = path.length ? path[path.length - 1] : start;
    this.syncTokens();
  },

  afterLanding(res) {
    if (this.net) return;
    const g = this.g;
    if (!g || g.over) { this.renderAll(); if (g && g.over) this.showResult(); return; }
    const p = g.cur();
    if (g.pending && g.pending.type === 'buy') {
      if (p.isAI) {
        const want = AI.decideBuy(g, p);
        setTimeout(() => {
          const t = g.tile(g.pending.tileId);
          if (want) g.buyLand(t.id, p);
          else g.log(`${p.name} 放弃购买 ${t.name}`, 'info');
          g.clearPending();
          this.renderAll();
          this.tradePhase();
        }, 700);
        return;
      }
      this.buyModal();
      return;
    }
    if (g.pending && g.pending.type === 'event') { this.eventModal(); return; }
    this.tradePhase();
  },

  tradePhase() {
    if (this.net) return;
    const g = this.g;
    if (!g) return;
    if (g.over) { this.renderAll(); this.showResult(); return; }
    const p = g.cur();
    if (!p.alive) { g.endTurn(); this.afterStateChange(); return; }
    g.phase = 'awaiting-trade';
    this.renderAll();
    if (!p.isAI) {
      const btn = $('btn-market');
      if (btn) btn.classList.toggle('hint', !this.isDrawerOpen('market'));
      return;
    }
    const acts = AI.planActions(g, p);
    let i = 0;
    const step = () => {
      if (g.over) { this.renderAll(); this.showResult(); return; }
      if (i >= acts.length) { setTimeout(() => { g.endTurn(); this.afterStateChange(); }, 500); return; }
      const fn = acts[i++];
      try { fn(); } catch (err) { console.error(err); }
      this.renderAll();
      setTimeout(step, 300);
    };
    setTimeout(step, 600);
  },

  onEndTurn() {
    const g = this.g;
    if (!g || g.over || this.busy) return;
    if (g.phase !== 'awaiting-trade') return;
    if (this.net) { if (this.isMyTurn()) this.send('endTurn'); return; }
    if (g.cur().isAI) return;
    g.endTurn();
    this.afterStateChange();
  },

  afterStateChange() {
    if (this.net) return;
    if (!this.g) return;
    this.renderAll();
    if (this.g.over) { this.showResult(); return; }
    this.startTurn();
  },

  /** 读档 / 导入后接着玩 */
  resume() {
    const g = this.g;
    if (!g) return;
    this.renderAll();
    if (g.over) { this.showResult(); return; }
    const p = g.cur();
    if (g.phase === 'awaiting-trade') { if (p.isAI) this.tradePhase(); return; }
    if (g.phase === 'awaiting-buy' || g.phase === 'awaiting-event') {
      g.clearPending();
      this.renderAll();
      if (p.isAI) this.tradePhase();
      return;
    }
    this.startTurn();
  },

  onTrade(code, side) {
    const g = this.g;
    if (!g || g.over) return;
    const p = this.meNow();                 // ★ 用"我"，不能用 g.cur()（炒股已解绑回合）
    if (!p || p.isAI) return;
    if (!this.canTradeNow()) {
      this.toast(p.jailTurns > 0 ? '你在坐牢，不能炒股'
        : (g.pending && g.pending.type === 'buy') ? '正在决定买地，稍后再交易' : '现在不能交易');
      return;
    }
    const s = g.stockByCode(code);
    const price = g.stockPrice(s);
    let qty = this.qty;
    if (qty === 0) qty = side === 'buy' ? Math.floor(p.cash / price) : (p.stocks[code] || 0);
    qty = Math.floor(qty);
    if (qty <= 0) { this.toast(side === 'buy' ? '现金不够买 1 股' : '没有持仓'); return; }
    if (this.net) { this.send(side === 'buy' ? 'buyStock' : 'sellStock', { code, qty }); return; }
    const r = side === 'buy' ? g.buyStock(code, qty, p) : g.sellStock(code, qty, p);
    if (!r.ok) this.toast(r.msg);
    this.renderAll();
  },

  /* ================= 破产地产拍卖 =================
     ★ 只在联机出现：this.net 为 null（单机热座）时 renderAuction() 直接返回，
       不画弹窗、不起计时器、不看日志，和没有这段代码一样。

     协议（冻结）：
       读状态  g.pendingAuction = null 或 { deadId, deadName, creditor, q }
       拍卖地块 g.tiles.filter(t => t.owner === g.pendingAuction.deadId)
       出价    UI.send('bidAuction', { bids: { 地块id: 金额 } })   ← 一次提交全部，提交后不能改
     服务端规则（这里只做界面体现，不在本地结算）：
       出价 ≤ 自己现金；低于 CONFIG.auction.minBid(100) 算弃权；
       从高到低依次结算、边结算边扣现金（所以合计可以超现金，只是买不到那么多）；
       窗口 CONFIG.auction.windowMs(25000)；出局者不能出价。 */

  /** 名字来自玩家输入（联机），一律转义再拼进 HTML */
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /* 每次 renderAll() 都跑一遍。要守住四件事：
       1) 单机绝不显示（第一行的 early return）；
       2) **出价窗口只认 state.auction**：破产挂起到窗口开启之间隔着一次看门狗扫描
          （服务端最多 500ms），这段空窗期出价会被服务端拒掉，所以这里宁可先禁用；
       3) 倒计时只读服务端的 deadline，不自己从 25000 开始估（重连回来也能接上）；
       4) 揭晓（pendingAuction 变回 null）只用日志播报一次，绝不重复弹。 */
  renderAuction() {
    /* ★ 单机没有拍卖：不只是"不画"，还要把已经画出来的收掉。
       退房间/掉线之后 UI.net 会变回 null，这时如果只 return，
       上一次渲染留下的拍卖弹窗会一直挂在屏幕上（幽灵弹窗），还带着计时器。 */
    if (!this.net) { this.clearAuctionUI(); return; }
    const g = this.g;
    if (!g) { this.clearAuctionUI(); return; }
    const pa = g.pendingAuction;
    if (!pa) { this.endAuctionReveal(); return; }
    if (g.over) return;

    const key = 'auc:' + pa.deadId + ':' + pa.q + ':' + pa.deadName;
    if (this._seenLogId == null) this._seenLogId = this.loadSeenLogId();
    const isNew = this._aucKey !== key;
    if (isNew) {                                 // 新一场拍卖：清掉上一场的所有痕迹
      this._aucKey = key;
      this._aucSentLocal = false;
      this._aucToast = null;
      this._aucIgnore = false;
      this._aucOpenSeen = false;
      this._aucFallbackAt = Date.now();           // 窗口一直没开的话，本地兜底倒计时从这儿算
      /* 播报基线 = 看到这场拍卖那一刻的最大日志号。
         引擎「🔨 XXX 的 N 块地产进入拍卖」这条就在这一批推送里，于是被吞掉，
         不会跑进揭晓结果；更早的历史日志（上一场拍卖的）同样在它之下。
         跨页面刷新靠 localStorage 记住，免得重连后把旧的一场当新揭晓再弹一次。 */
      this._aucSince = Math.max(this._seenLogId || 0, this.logMaxId());
    } else if (!this._aucDoneKey && !this._aucOpenSeen && this.auctionState()) {
      /* ★ 窗口刚开的这一次推送：把基线推到"开票之前"。
         逐次推进会把"引擎先写拍得、服务端下一批才补清偿"那种分两批推来的结算日志漏掉，
         所以只在窗口从未开→开的这一下推一次，之后冻结。
         （本机已看过这一场时 _seenLogId 已经越过它，max 保证基线不会倒退。） */
      this._aucSince = Math.max(this._aucSince || 0, this._seenLogId || 0);
    }
    if (this._aucDoneKey === key) return;        // 这一场已经播报过结果了（正常不会走到）
    const auc = this.auctionState();
    if (auc && auc.open) {
      this._aucOpenSeen = true;
      /* 本机彻底"看过"这一场，直到结算前的日志：记下来，刷新后不会重复播报 */
      this._seenLogId = this.logMaxId();
      this.saveSeenLogId(this._seenLogId);
    }
    /* 服务端的 mySubmitted 是权威：重连/刷新后本地标志没了，它还在。
       反过来（本地 true、服务端还没有）是刚提交那一瞬，不能把它抹掉。 */
    if (auc && auc.open && auc.mySubmitted === false && this._aucSentLocal && this._aucOpenSeen) {
      this._aucSentLocal = false;
    }
    this.renderAuctionModal(pa, this.auctionLeft());
    if (!this._aucTimer) this._aucTimer = setInterval(() => this.tickAuction(), 1000);
  },

  /** 服务端的拍卖窗口状态（state.auction）。没有就返回 null —— 此时不能出价。 */
  auctionState() {
    const st = this.remote;
    const a = st && st.auction;
    return (a && a.open) ? a : null;
  },
  /* 当前状态里最大的日志号（用来划"这一次推送之前就已经见过的日志"这条线）。
     注意不能读 g.uid：联机推来的日志被截断过（只带最后 N 条），g.uid 比能看到的大得多。 */
  logMaxId() {
    const g = this.g;
    if (!g || !g.logs) return 0;
    let m = 0;
    for (const l of g.logs) if (l && l.id > m) m = l.id;
    return m;
  },
  /* 跨刷新记住"已经看到过的最大日志号"：页面重载后不该把上一场拍卖的旧日志当新结果弹一遍。
     只在这台机器上、这个浏览器里有效；读不到（隐私模式等）就退化成不记忆。 */
  loadSeenLogId() {
    try { return parseInt(localStorage.getItem('dgs-auction-seen') || '0', 10) || 0; } catch (e) { return 0; }
  },
  saveSeenLogId(id) {
    try { localStorage.setItem('dgs-auction-seen', String(id || 0)); } catch (e) {}
  },
  /* 这一场拍卖还没播报过的**结算**日志：
     ① 晚于播报基线（基线 = 看到这场拍卖那一刻的最大日志号）
     ② 是 🔨 开头的结算/归属日志 —— 明确排除两类非结算的催场日志：
        「🔨 X 的 N 块地产进入拍卖」（开拍，就在基线上）和
        「🔨 X 已提交 N 块地的报价」（服务端每次收票都写，跟结果无关）
     ③ 没在之前任何一场里播过（_aucShown 整局累积，重复推送不会再弹） */
  auctionRevealLogs() {
    const g = this.g;
    const since = this._aucSince || 0;
    const shown = this._aucShown || (this._aucShown = {});
    return (g.logs || []).filter(l =>
      l.id > since && /^🔨/.test(String(l.msg || '')) &&
      !/进入拍卖|已提交/.test(String(l.msg || '')) && !shown[l.id]);
  },
  auctionWindowMs() {
    const st = this.remote;
    const a = st && st.auction;
    const ms = (a && a.windowMs) || (typeof CONFIG !== 'undefined' && CONFIG.auction && CONFIG.auction.windowMs) || 25000;
    return ms > 0 ? ms : 25000;
  },
  /** 窗口一共几秒（服务端给了就用它，进度条才不会错） */
  auctionTotalSec() {
    const st = this.remote;
    const a = st && st.auction;
    if (a && a.deadline && a.windowMs) return Math.max(1, Math.round(a.windowMs / 1000));
    return Math.max(1, Math.round(this.auctionWindowMs() / 1000));
  },
  /* 还能出价吗：窗口开着 + 我活着 + 我还没交票 */
  canBidAuction() {
    const g = this.g;
    if (!g || g.over || !g.pendingAuction) return false;
    const me = g.players[this.net.seat];
    if (!me || !me.alive) return false;
    if (g.pendingAuction.deadId === this.net.seat) return false;
    const auc = this.auctionState();
    if (!auc) return false;                      // ★ 窗口还没开（或已结束）一律不许出价
    return !this.auctionSubmitted();
  },
  auctionSubmitted() {
    const auc = this.auctionState();
    if (auc && auc.mySubmitted === true) return true;
    return !!this._aucSentLocal;
  },
  /* 剩余秒数：以服务端 deadline 为准。只有窗口还没开（空窗期）才退回本地窗口估一个，
     免得弹出"剩余 0 秒"这种吓人的假象。 */
  auctionLeft() {
    const auc = this.auctionState();
    const now = Date.now();
    if (auc && typeof auc.deadline === 'number' && isFinite(auc.deadline)) {
      return Math.max(0, Math.ceil((auc.deadline - now) / 1000));
    }
    if (!this._aucOpenSeen) {
      const at = this._aucFallbackAt || now;
      return Math.max(0, Math.ceil((at + this.auctionWindowMs() - now) / 1000));
    }
    return 0;
  },
  /** 已交票人数 / 场上还活着的真人（含自己） */
  auctionVotes() {
    const auc = this.auctionState();
    const g = this.g;
    let humans = 0;
    if (g) humans = g.players.filter(p => p.alive && !p.isAI).length;
    return { done: auc ? (auc.submittedCount | 0) : 0, total: humans };
  },

  /** 倒计时每秒走一格：只改文本/进度条，**绝不重画输入框**（否则会把正在填的数字冲掉） */
  tickAuction() {
    if (!this.net || !this.g || !this.g.pendingAuction) { this.stopAuction(); return; }
    const t = document.getElementById('auc-timer');
    if (!t) return;                                     // 弹窗被别人顶掉了，等 renderAll 重画
    const left = this.auctionLeft();
    this._aucLeft = left;
    t.textContent = this.auctionTimerText(left);
    t.classList.toggle('warn', left <= 10);
    t.style.setProperty('--auc', (Math.max(0, Math.min(1, left / this.auctionTotalSec())) * 100).toFixed(1) + '%');
    /* 窗口还没开时按钮还是禁用的，这时候提醒"还剩几秒"只会添乱 */
    if (this.auctionState() && left <= 5 && left > 0 && this._aucToast !== left) {
      this._aucToast = left;
      this.toast('拍卖还剩 ' + left + ' 秒，提交后不能改');
    }
  },

  auctionTimerText(left) {
    if (!this.auctionState()) {
      return this._aucOpenSeen ? '⏱ 已截止，等待揭晓…' : '⏳ 正在开票…';
    }
    return left > 0 ? '⏱ 剩余 ' + left + ' 秒' : '⏱ 已截止，等待揭晓…';
  },

  stopAuction() {
    if (this._aucTimer) { clearInterval(this._aucTimer); this._aucTimer = null; }
    this._aucFallbackAt = null;
  },

  /** 退出单机 / 掉线 / 离开房间：把拍卖相关的界面和计时器全收干净（不留幽灵弹窗） */
  clearAuctionUI() {
    this.stopAuction();
    this._aucKey = null;
    this._aucSentLocal = false;
    this._aucIgnore = false;
    const box = document.querySelector('#modal-root .modal.auction');
    if (box && box.parentNode && box.parentNode.parentNode) box.parentNode.parentNode.removeChild(box.parentNode);
    const rev = document.querySelector('#modal-root .modal.auc-reveal');
    if (rev && this._revealOpen) {
      this._revealOpen = false;
      if (rev.parentNode && rev.parentNode.parentNode) rev.parentNode.parentNode.removeChild(rev.parentNode);
    }
  },

  /** 拍卖收摊：清计时器 + 按日志播报结果（去重，每次拍卖只播一次） */
  endAuctionReveal() {
    const g = this.g;
    if (!this.net || !g) return;
    /* 对局已经结束：结算面板在播报了，这一场让位。顺手把"已看到"推到最新，
       否则重连/刷新后会把这一场的旧日志再当成新结果弹一次。 */
    if (g.over) {
      this._aucKey = null; this._aucSentLocal = false; this.stopAuction();
      const id = this.logMaxId();
      this._seenLogId = id; this.saveSeenLogId(id);
      return;
    }
    if (this._revealOpen) {            // 揭晓面板还开着：状态推送冲掉它就补回来
      if (!this.g.pendingAuction && !document.querySelector('#modal-root .modal.auc-reveal')) this.showAuctionResult(this._revealKey);
      return;
    }
    if (!this._aucKey) return;         // 从没见过拍卖（比如中途加入），不弹任何东西
    const key = this._aucKey;
    this._aucKey = null;
    this._aucSentLocal = false;
    this._aucIgnore = false;
    this.stopAuction();
    if (this._aucDoneKey === key) return;
    this._aucDoneKey = key;
    const hits = this.auctionRevealLogs();
    if (!hits.length) {
      /* 日志还没跟上（结算和日志分了两批推）：把基线冻结在这儿，等下一批推送再播。
         这里**不能**推进 _seenLogId，否则下一批的结算日志就永远看不到了。 */
      this._aucPendingReveal = true;
      return;
    }
    this.showAuctionResult(hits.map(l => l.id).join(','));
  },

  /* 拍卖结果：列表 + 我这边的得失。只用"还没播过"的日志，所以状态推多少次都只弹一次。 */
  showAuctionResult(key) {
    const g = this.g;
    if (!g) return;
    const hits = this.auctionRevealLogs();
    if (!hits.length) return;
    const shown = this._aucShown || (this._aucShown = {});
    for (const l of hits) shown[l.id] = 1;       // 记成"已播过"，重复推送不会再弹
    this._aucPendingReveal = false;
    /* 播报成功 = 这些日志我已经看到过了：推进"已看到"游标，刷新页面后不会再弹一遍 */
    const id = this.logMaxId();
    this._seenLogId = id;
    this.saveSeenLogId(id);
    this._revealOpen = true;
    this._revealKey = key;
    const seat = (this.net && this.net.seat >= 0) ? this.net.seat : -1;
    const myName = (g.players[seat] && g.players[seat].name) || '你';
    let got = 0;
    for (const l of hits) if (String(l.msg).indexOf('被 ' + myName + ' 以') >= 0) got++;
    const body = '<div class="auc-res-list">' + hits.map(l =>
      '<div class="auc-res-row ' + (l.kind || 'info') + '">' + this.esc(l.msg) + '</div>').join('') + '</div>'
      + '<div class="auc-foot"><span>本轮拍得</span><b class="' + (got ? 'ok' : '') + '">'
      + (got ? got + ' 块' : '没有拍到') + '</b></div>';
    this.modal({
      title: '🔨 拍卖揭晓',
      sub: '报价同时揭晓、从高到低依次结算；出局者的地产已经易主或收回银行。',
      cls: 'auc-reveal',
      body,
      onClose: () => { this._revealOpen = false; },
      actions: [{ label: '知道了', cls: 'ok', fn: () => this.dismissAuctionResult() }],
    });
  },

  /* 弹窗骨架：只在"这一场还没画过"时建一次，之后每次状态推送只**补数据**，
     这样输入框里正在填的数字不会被状态推送冲掉。
     出价能力由 state.auction 决定（窗口没开时输入框是禁用的）。 */
  renderAuctionModal(pa, left) {
    if (!this.net || !this.g || !this.g.pendingAuction) return;   // 兜底：没联机/没拍卖就不许画
    const box = document.querySelector('#modal-root .modal.auction');
    if (box && box.isConnected) {
      /* 已经画过这一场：地块数没变就只补数据（保住正在填的输入框） */
      if (box.dataset.lots === String(this.auctionLots().length)) {
        this.updateAuctionModal(pa, left);
        return;
      }
      box.remove();
    }
    if (this._aucIgnore) return;              // 玩家主动「放弃这次拍卖」，本场不再自动弹
    const g = this.g, seat = this.net.seat;
    const me = g.players[seat];
    const lots = this.auctionLots();
    const canBid = this.canBidAuction();
    const A = (CONFIG.auction && CONFIG.auction.minBid) || 100;
    const cred = (pa.creditor >= 0 && g.players[pa.creditor] && g.players[pa.creditor].alive)
      ? g.players[pa.creditor].name : '';
    const rows = lots.map(t => this.auctionRowHTML(t, me, canBid, A)).join('');
    const votes = this.auctionVotes();
    let body = '<div class="auc-top">';
    if (votes.total > 1) {
      body += '<span class="auc-votes" id="auc-votes">已交票 ' + votes.done + '/' + votes.total + '</span>';
    }
    body += '<span class="auc-count">共 ' + lots.length + ' 块地产待拍</span>'
      + '<span id="auc-timer" class="auc-timer">' + this.auctionTimerText(left) + '</span>'
      + '</div>';
    body += '<div class="auc-rules">一轮密封报价、同时揭晓，最高者得。出价上限是当前现金，'
      + '低于 ' + fmt(A) + ' 视为弃权；<b>提交后不能改</b>。报价从高到低依次结算、边结算边扣现金，'
      + '所以合计出价可以超出现金（只是买不到那么多地）。'
      + (cred ? '成交款作为清偿付给 ' + this.esc(cred) + '。' : '本场没有债权人，成交款收归银行。')
      + '</div>';
    if (!lots.length) body += '<div class="trade-note">这一轮没有待拍的地产。</div>';
    else if (!me || !me.alive) body += '<div class="trade-note">你已经出局，只能旁观这场拍卖。</div>';
    else body += '<div class="auc-list">' + rows + '</div>';
    body += '<div class="auc-total" id="auc-total">'
      + '<button class="btn ghost auc-fill" id="auc-fill"' + (canBid ? '' : ' disabled') + '>按现金均摊</button>'
      + '<div class="auc-sum"><span>合计出价</span><b id="auc-sum-bid">¥0</b>'
      + '<span class="sep">/</span><span>我的现金</span><b id="auc-sum-cash">' + fmt(me ? me.cash : 0) + '</b></div>'
      + '<span class="trade-hint" id="auc-hint"></span>'
      + '</div>';
    const actions = (me && me.alive)
      ? [
        { label: '放弃这次拍卖', cls: 'ghost', id: 'auc-abandon', fn: () => this.abandonAuction() },
        { label: '提交报价', cls: 'ok', id: 'auc-submit', disabled: !canBid, fn: () => this.onAuctionSubmit() },
      ]
      : [{ label: '知道了', cls: 'ok', fn: () => { this._aucIgnore = true; } }];
    const built = this.modal({
      title: '🔨 破产拍卖 · ' + this.esc(pa.deadName) + ' 的资产',
      sub: '第 ' + pa.q + ' 季度 · ' + (me && me.alive ? '你的座位是 ' + (seat + 1) + ' 号' : '旁观'),
      cls: 'auction', body, actions,
      onClose: () => { this._aucIgnore = true; },
    });
    if (built) built.dataset.lots = String(lots.length);
    const input = document.getElementById('auc-bid-0');
    if (input && input.focus && !input.disabled) input.focus();
    this.bindAuction();
    this.refreshAuctionGate();
    this.updateAuctionTotal();
    this.tickAuctionPaint();
    return built;
  },

  /* 状态推送后的补数据：地块归属/等级随时可能被别人买走或被扣款，只改变化的部分 */
  updateAuctionModal(pa, left) {
    const g = this.g, seat = this.net.seat;
    const me = g.players[seat];
    const lots = this.auctionLots();
    const box = document.querySelector('#modal-root .modal.auction');
    if (!box) return;
    const list = box.querySelector('.auc-list');
    const h2 = box.querySelector('h2');
    if (h2) h2.textContent = '🔨 破产拍卖 · ' + pa.deadName + ' 的资产';
    const cnt = box.querySelector('.auc-count');
    if (cnt) cnt.textContent = '共 ' + lots.length + ' 块地产待拍';
    const votes = this.auctionVotes();
    const vEl = document.getElementById('auc-votes');
    if (vEl) vEl.textContent = '已交票 ' + votes.done + '/' + votes.total;
    if (list) {
      for (const t of lots) {
        const nm = list.querySelector('.auc-nm[data-tile="' + t.id + '"]');
        if (nm) nm.textContent = t.name;
        const lv = list.querySelector('.auc-lv[data-tile="' + t.id + '"]');
        if (lv) lv.textContent = this.levelLabel(t);
        const row = list.querySelector('.auc-row[data-tile="' + t.id + '"]');
        if (row) row.classList.toggle('mortgaged', !!t.mortgaged);
      }
    }
    const cash = document.getElementById('auc-sum-cash');
    if (cash) cash.textContent = fmt(me ? me.cash : 0);
    if (me && !this.auctionSubmitted()) {
      /* 现金可能在出价窗口里变了（别人收租/拍卖扣款），把输入框的上限跟着更新 */
      const inputs = document.querySelectorAll('#modal-root .auc-bid');
      const cap = Math.max(0, Math.floor(me.cash));
      for (let i = 0; i < inputs.length; i++) {
        inputs[i].max = String(cap);
        if (this.digits(inputs[i].value) > cap) inputs[i].value = cap > 0 ? String(cap) : '';
      }
    }
    this.refreshAuctionGate();
    this.updateAuctionTotal();
    this.tickAuctionPaint();
  },

  /* 出价闸门：窗口开着 + 没交过票才放行。窗口没开时给一句"正在开票"，
     因为服务端在破产挂起到窗口开启之间会拒掉出价（空窗期 ≤500ms）。 */
  refreshAuctionGate() {
    const box = document.querySelector('#modal-root .modal.auction');
    if (!box) return;
    const auc = this.auctionState();
    const sent = this.auctionSubmitted();
    const me = this.g ? this.g.players[this.net.seat] : null;
    const canBid = this.canBidAuction();
    const inputs = document.querySelectorAll('#modal-root .auc-bid');
    for (let i = 0; i < inputs.length; i++) inputs[i].disabled = !canBid;
    const sub = document.getElementById('auc-submit');
    if (sub) {
      sub.disabled = !canBid;
      sub.textContent = sent ? '已提交，等待揭晓' : (auc ? '提交报价' : '等待开票…');
    }
    const fill = document.getElementById('auc-fill');
    if (fill) fill.disabled = !canBid;
    const hint = document.getElementById('auc-hint');
    if (hint) {
      hint.textContent = !auc ? '服务端正在开启出价窗口…'
        : sent ? '密封报价只能提交一次，等待揭晓。'
          : (me && me.alive ? '' : '你已出局，只能旁观。');
    }
    const tip = box.querySelector('.auc-lock');
    const wantTip = sent ? (auc ? '已提交，等待揭晓（提交后不能改）。' : '已提交，等待揭晓。')
      : (!auc ? '服务端正在开启出价窗口，稍等一下就可以出价。' : '');
    if (!wantTip) { if (tip) tip.remove(); return; }
    if (tip) { tip.textContent = wantTip; return; }
    const d = document.createElement('div');
    d.className = 'trade-note warn auc-lock';
    d.textContent = wantTip;
    const t = box.querySelector('.auc-total');
    if (t && t.parentNode) t.parentNode.insertBefore(d, t);
  },

  auctionLots() {
    const g = this.g, pa = g && g.pendingAuction;
    if (!pa) return [];
    return g.tiles.filter(t => t.owner === pa.deadId);
  },

  levelLabel(t) {
    if (t.type !== 'land') return t.type === 'rail' ? '锚点' : '设施';
    return 'Lv' + (t.level || 0) + ' ' + ((CONFIG.levels && CONFIG.levels[t.level]) || '空地');
  },

  /* 一行 = 地块名 / 等级 / 地区 / 该地区垄断进度 / 出价框 / 参考价 */
  auctionRowHTML(t, me, canBid, A) {
    const g = this.g;
    const v = Math.max(0, Math.round(g.assetValue(t)));
    const grp = t.group && typeof GROUPS !== 'undefined' ? GROUPS[t.group] : null;
    const prog = t.group ? g.groupProgress((me && me.alive) ? me.id : (this.net.seat), t.group) : null;
    const full = prog && prog.total > 0 && prog.have >= prog.total;
    const tagn = grp ? '<span class="auc-gdot" style="background:' + (grp.color || '#5f7392') + '"></span>' + this.esc(grp.name)
      : (t.type === 'rail' ? '传送锚点' : '公共设施');
    const sent = this.auctionSubmitted();
    const myBid = (sent && this._aucBids && this._aucBids[t.id] != null) ? this._aucBids[t.id] : '';
    const cap = Math.max(0, Math.floor(me ? me.cash : 0));
    const field = (me && me.alive)
      ? '<input class="auc-bid" type="text" inputmode="numeric" autocomplete="off" data-tile="' + t.id + '"'
        + ' id="auc-bid-' + t.id + '" max="' + cap + '"'
        + ' value="' + (myBid === '' ? '' : myBid) + '" placeholder="弃权"'
        + (canBid ? '' : ' disabled') + '>'
      : '<span class="auc-nobid">—</span>';
    return '<div class="auc-row' + (t.mortgaged ? ' mortgaged' : '') + '" data-tile="' + t.id + '">'
      + '<div class="auc-main">'
      + '<div class="auc-nm" data-tile="' + t.id + '">' + this.esc(t.name) + '</div>'
      + '<div class="auc-meta">'
      + '<span class="auc-lv" data-tile="' + t.id + '">' + this.levelLabel(t) + '</span>'
      + '<span class="auc-tag">' + tagn + '</span>'
      + (prog ? '<span class="auc-prog' + (full ? ' full' : '') + '">' + this.esc(grp ? grp.name : '') + ' '
        + prog.have + '/' + prog.total + (full ? ' 垄断' : '') + '</span>' : '')
      + (t.mortgaged ? '<span class="auc-mg">抵押中</span>' : '')
      + '</div></div>'
      + '<div class="auc-bidbox">'
      + '<span class="auc-cur">¥</span>' + field
      + '<span class="auc-min">起 ' + fmt(A) + '</span>'
      + '</div>'
      + '<div class="auc-ref"><span>参考价</span><b>' + fmt(v) + '</b></div>'
      + '</div>';
  },

  /* 只把输入框留成数字：非数字直接删掉，超过现金自动压到现金上限 */
  onAuctionInput(e) {
    const el = e.target;
    const got = this.digits(el.value);
    const n = Math.floor(got);
    const cap = Math.max(0, Math.floor(this.auctionCash()));
    let out = got;
    if (got > cap) { out = cap; this.toast('出价不能超过你的现金 ' + fmt(cap)); }
    const s = String(out);
    if (s !== el.value) {
      const pos = s.length;
      el.value = s;
      if (el.setSelectionRange) { try { el.setSelectionRange(pos, pos); } catch (err) {} }
    }
    this.updateAuctionTotal();
  },

  digits(v) {
    const s = String(v == null ? '' : v).replace(/[^\d]/g, '').slice(0, 12);
    return s === '' ? 0 : parseInt(s, 10);
  },

  auctionCash() {
    const g = this.g;
    const me = this.net && g ? g.players[this.net.seat] : null;
    return (me && me.alive) ? me.cash : 0;
  },

  /* 合计 = 所有目标地块的出价之和。超出现金只警告、不拦（协议允许超，服务端按高价依次结算） */
  updateAuctionTotal() {
    let sum = 0, over = 0;
    const inputs = document.querySelectorAll('#modal-root .auc-bid');
    for (let i = 0; i < inputs.length; i++) {
      const b = this.digits(inputs[i].value);
      sum += b;
      if (b > 0) over++;
    }
    const cash = this.auctionCash();
    const s = document.getElementById('auc-sum-bid');
    if (s) {
      s.textContent = fmt(sum);
      /* ★ 超出现金：变色警告，但仍然允许提交（协议允许总额超现金，服务端按高价依次结算） */
      s.classList.toggle('over', sum > cash);
    }
    const box = document.querySelector('#modal-root .modal.auction');
    if (box) {
      const t = box.querySelector('.auc-total');
      if (t) t.classList.toggle('over', sum > cash);
    }
    const hint = document.getElementById('auc-hint');
    /* 待出价时才显示"已报几块"；窗口没开/已交票时这句话由 refreshAuctionGate 负责 */
    if (hint && this.canBidAuction()) {
      hint.textContent = over ? '已对 ' + over + ' 块地出价' : '没有出价的地块会直接算弃权';
    }
    return { sum, cash, over };
  },

  onAuctionFill() {
    if (!this.canBidAuction()) return;
    const me = this.g ? this.g.players[this.net.seat] : null;
    const cash = me ? Math.max(0, Math.floor(me.cash)) : 0;
    const lots = this.auctionLots();
    const inputs = document.querySelectorAll('#modal-root .auc-bid');
    if (!inputs.length || !lots.length) return;
    /* 均摊："按现金均摊"只是把现金铺到每块地上，省得手填。
       注意服务端是从高价往低结算，均摊不代表每块都能买到。 */
    const per = Math.floor(cash / lots.length);
    for (let i = 0; i < inputs.length; i++) {
      const v = i === inputs.length - 1 ? cash - per * (inputs.length - 1) : per;
      inputs[i].value = v > 0 ? String(v) : '';
    }
    this.updateAuctionTotal();
    this.toast('已按现金均摊，可自行调整；提交后不能改');
  },

  /* 提交：一次把所有出价发上去（协议 UI.send('bidAuction', { bids })）。
     ★ 必须先过 canBidAuction()：窗口还没开就提交会被服务端拒（"拍卖还没开始收票"）。 */
  onAuctionSubmit() {
    if (!this.net) return;
    if (this.auctionSubmitted()) { this.toast('你已经交过报价了，密封报价不能改'); return; }
    if (!this.canBidAuction()) {
      this.toast(this.auctionState() ? '现在还不能出价' : '服务端正在开启出价窗口，稍等一下');
      return;
    }
    const g = this.g, pa = g && g.pendingAuction;
    if (!pa) return;
    const me = g.players[this.net.seat];
    if (!me || !me.alive) { this.toast('你已经出局，不能出价'); return; }
    const inputs = document.querySelectorAll('#modal-root .auc-bid');
    const bids = {};
    let n = 0, sum = 0;
    for (let i = 0; i < inputs.length; i++) {
      const id = parseInt(inputs[i].getAttribute('data-tile'), 10);
      const b = this.digits(inputs[i].value);
      if (!(b > 0)) continue;                    // 空 / 0 = 弃权这块地
      bids[id] = b;
      n++;
      sum += b;
    }
    this.send('bidAuction', { bids });
    this._aucSentLocal = true;
    this._aucBids = bids;
    /* 按"已提交"原地重画成锁定态。返回 false 是告诉 modal()：这个弹窗别关
       （否则提交完弹窗直接消失，连"已提交，等待揭晓"和揭晓结果都看不到）。 */
    this.renderAuctionModal(pa, this.auctionLeft());
    this.updateAuctionTotal();
    this.toast(n ? '已提交 ' + n + ' 笔报价，合计 ' + fmt(sum) + '，等待揭晓' : '已提交（没有出价，等于全部弃权）');
    return false;
  },

  abandonAuction() {
    this._aucIgnore = true;                      // 本场不再自动弹（开拍中仍可从底部事件日志看到进程）
    if (this.auctionSubmitted()) this.toast('报价已提交，仍然有效；揭晓结果会从底部「事件日志」播报');
    else this.toast('已放弃这次拍卖（没有提交任何报价）');
  },
  /** 揭晓面板上的"知道了"：关掉它。如果对局里又开了一场拍卖，把出价弹窗画回来
      （否则"知道了"会把新的拍卖弹窗一起带走，直到下一次状态推送才回来）。 */
  dismissAuctionResult() {
    this._revealOpen = false;
    const g = this.g;
    if (g && g.pendingAuction) this.renderAuction();
    this.toast('完整明细在底部「事件日志」里');
  },

  bindAuction() {
    const inputs = document.querySelectorAll('#modal-root .auc-bid');
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', e => this.onAuctionInput(e));
      inputs[i].addEventListener('focus', e => { e.target.select(); });
      /* 回车快速提交（提交按钮本身由 modal() 的 actions 管，这里**不能**再挂一个 click，
         否则点了会跑两遍：第一遍把 DOM 清掉，第二遍读到的出价是空的）。 */
      inputs[i].addEventListener('keydown', e => {
        if (e.code === 'Enter') { e.preventDefault(); this.onAuctionSubmit(); }
      });
    }
    const fill = document.getElementById('auc-fill');
    if (fill) fill.addEventListener('click', () => this.onAuctionFill());
  },

  /* 首次画完立刻补一帧倒计时（不用等满 1 秒才显示进度条） */
  tickAuctionPaint() {
    const t = document.getElementById('auc-timer');
    if (!t) return;
    const left = this.auctionLeft();
    this._aucLeft = left;
    t.textContent = this.auctionTimerText(left);
    t.classList.toggle('warn', left <= 10);
    t.style.setProperty('--auc', (Math.max(0, Math.min(1, left / this.auctionTotalSec())) * 100).toFixed(1) + '%');
  },

  /* ================= 弹窗 =================
     opt.cls     —— 追加到 .modal 上的自定义类（拍卖弹窗靠它判定"这一场已经画过了"）
     opt.onClose —— 弹窗被关掉时回调（点遮罩也算）。拍卖用它记住"玩家主动放弃"，不再自动弹。 */
  modal(opt) {
    const root = $('modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const box = document.createElement('div');
    box.className = 'modal' + (opt.cls ? ' ' + opt.cls : '');
    box.innerHTML =
      (opt.title ? `<h2>${opt.title}</h2>` : '') +
      (opt.sub ? `<div class="m-sub">${opt.sub}</div>` : '') +
      `<div class="m-body">${opt.body || ''}</div>`;
    const acts = document.createElement('div');
    acts.className = 'm-actions';
    /* 按钮 = 弹窗的正常出口：先清 DOM，再跑动作。
       ★ 例外：动作返回 false 表示"这个弹窗还要留着"（拍卖提交后要原地变成锁定态），
         这时跳过清 DOM，让动作自己把弹窗重画出来。
       先清后跑的顺序对别的弹窗是必须的——比如买地的动作会 renderAll()，
       如果弹窗还在 DOM 里，它会和新的界面打架。 */
    const close = () => { root.innerHTML = ''; };
    (opt.actions || []).forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.id = a.id || ('m-act-' + i);          // 拍卖靠 id 找"提交报价"这个按钮
      b.textContent = a.label;
      b.disabled = !!a.disabled;
      b.addEventListener('click', () => {
        const keep = a.fn ? (a.fn() === false) : false;
        if (!keep) close();
      });
      acts.appendChild(b);
    });
    box.appendChild(acts);
    mask.appendChild(box);
    root.innerHTML = '';
    root.appendChild(mask);
    /* 点弹窗外的暗色遮罩 = 把弹窗关掉（只有带 onClose 的弹窗需要这个，其它弹窗行为不变） */
    if (opt.onClose) mask.addEventListener('click', e => {
      if (e.target !== mask) return;
      root.innerHTML = '';
      opt.onClose();
    });
    if (opt.auto) {                     // 电脑玩家抽到卡时自动翻开，不阻塞流程
      setTimeout(() => {
        if (!box.isConnected) return;
        const b = acts.querySelector('button');
        if (b) b.click();
      }, opt.auto * SPEED);
    }
    return box;
  },

  buyModal() {
    const g = this.g, p = g.cur();
    const t = g.tile(g.pending.tileId);
    const price = g.pending.price;
    const after = p.cash - price;
    let body = `<div class="kv"><span>类型</span><b>${t.type === 'land' ? (GROUPS[t.group] ? GROUPS[t.group].name + '地产' : '地产') : t.type === 'rail' ? '传送锚点' : '公共设施'}</b></div>`;
    body += `<div class="kv"><span>当前地价（随地产指数浮动）</span><b>${fmt(price)}</b></div>`;
    if (t.type === 'land') {
      const prog = g.groupProgress(p.id, t.group);
      body += `<div class="kv"><span>地区进度</span><b>${prog.have} / ${prog.total}${prog.have + 1 === prog.total ? ' · 买下即垄断！' : ''}</b></div>`;
      body += `<div class="kv"><span>买下后每级租金</span><b></b></div>`;
      body += `<div class="rent-table">` + CONFIG.levels.slice(1).map((nm, k) =>
        `<span class="${k === 0 ? 'now' : ''}">${nm}</span><span>${k === 0 ? '（现状）' : ''}</span><span>${fmt(g.rentOf({ ...t, level: k + 1 }, 7))}</span>`
      ).join('') + `</div>`;
    } else if (t.type === 'rail') {
      body += `<div class="kv"><span>租金（按持有锚点数）</span><b>${fmt(g.rentOf({ ...t, owner: p.id }, 7))} 起</b></div>`;
    } else {
      body += `<div class="kv"><span>租金</span><b>骰子点数 × ${CONFIG.utilityRentPerPip}（当前 ${fmt(g.rentOf({ ...t, owner: p.id }, 7))}）</b></div>`;
    }
    const total = price + (g.pending.optionFee || 0);
    body += `<div class="kv"><span>买下后现金</span><b style="color:${p.cash - total >= 0 ? '#4ade80' : '#f87171'}">${fmt(p.cash - total)}</b></div>`;
    this.modal({
      title: '购买 ' + t.name,
      sub: g.pending.halfPrice ? '你持有这块地的期权合约，半价买下。'
        : (g.pending.optionFee ? `这块地被 ${g.players[g.pending.optionHolder].name} 的期权锁定，要额外付 ${fmt(g.pending.optionFee)}。`
          : '买地会推高地产指数（+0.5），别人的地也会跟着涨。'),
      body,
      actions: [
        {
          label: '放弃', cls: 'ghost', fn: () => {
            if (this.net) { this.send('decline'); return; }
            g.log(`${p.name} 放弃购买 ${t.name}`, 'info'); g.clearPending(); this.renderAll(); this.tradePhase();
          }
        },
        {
          label: '买下 ' + fmt(total), cls: 'ok', disabled: p.cash < total,
          fn: () => {
            if (this.net) { this.send('buy'); return; }
            g.buyLand(t.id, p); g.clearPending(); this.renderAll(); this.tradePhase();
          }
        },
      ],
    });
  },

  eventModal() {
    const g = this.g, p = g.cur();
    const ev = g.pending.event, ct = g.pending.cardType;
    this.modal({
      title: ct === 'chance' ? '机会' : '命运',
      auto: p.isAI ? 1500 : 0,
      body: `<div class="card-face ${ct}">
          <div class="cf-k">${ct === 'chance' ? 'OPPORTUNITY' : 'FATE'}</div>
          <div class="cf-t">${ev.title}</div>
          <div class="cf-d">${ev.text}</div>
        </div>`,
      actions: [{
        label: '接受', cls: 'ok', fn: () => {
          if (this.net) { this.send('eventAck'); return; }
          g.applyEvent(ev, p);
          g.clearPending();
          this.renderAll();
          if (p.alive) this.tradePhase();
          else { g.endTurn(); this.afterStateChange(); }
        }
      }],
    });
  },

  tileModal(i) {
    const g = this.g;
    if (!g) return;
    const t = g.tile(i);
    const p = g.cur();
    const canAct = p && !p.isAI && !g.over && g.phase === 'awaiting-trade' && this.isMyTurn();
    const owner = t.owner >= 0 ? g.players[t.owner] : null;
    let body = '';
    /* 角色头牌：地块的代表角色与元素 */
    if (t.group && GROUPS[t.group]) {
      const elem = GROUPS[t.group].elem;
      const ec = ELEMENTS[elem] ? ELEMENTS[elem].color : '#5f7392';
      const img = (t.avatar && this.avatarOK[t.avatar])
        ? `<img src="${avatarSrc(t.avatar)}" alt="${t.char}">` : '';
      body += `<div class="tc-head" style="--ec:${ec}">
        <div class="ava big${img ? ' has-img' : ''}" style="--ec:${ec}">
          <svg viewBox="0 0 24 24" fill="none">${ELEM_ICON[elem] || ''}</svg>${img}
        </div>
        <div>
          <div class="tc-name">${t.char || GROUPS[t.group].name}</div>
          <div class="tc-sub">${GROUPS[t.group].name} · ${ELEMENTS[elem] ? ELEMENTS[elem].name + '元素 · ' : ''}${t.name}</div>
        </div>
      </div>`;
    }
    if (t.basePrice) {
      body += `<div class="kv"><span>基准地价</span><b>${fmt(t.basePrice)}</b></div>`;
      body += `<div class="kv"><span>当前地价（基准 × ${Math.round(g.rei)}%）</span><b>${fmt(g.landPrice(t))}</b></div>`;
      if (owner) body += `<div class="kv"><span>市值</span><b>${fmt(g.assetValue(t))}</b></div>`;
      body += `<div class="kv"><span>持有者</span><b style="color:${owner ? owner.color : '#8fa3bf'}">${owner ? owner.name + (t.mortgaged ? '（抵押中）' : '') : '无主'}</b></div>`;
    }
    if (t.type === 'land') {
      body += `<div class="kv"><span>地区</span><b>${GROUPS[t.group].name}</b></div>`;
      if (owner) {
        const prog = g.groupProgress(owner.id, t.group);
        body += `<div class="kv"><span>该持有人的地区进度</span><b>${prog.have} / ${prog.total}${prog.have === prog.total ? ' · 垄断 ×1.5' : ''}</b></div>`;
      }
      body += `<div class="kv"><span>当前等级</span><b>${t.level >= 1 ? CONFIG.levels[t.level] : '未开发'}</b></div>`;
      body += `<div class="rent-table">` + CONFIG.levels.slice(1).map((nm, k) => {
        const lv = k + 1;
        const rt = g.rentOf(Object.assign({}, t, { level: lv, owner: t.owner >= 0 ? t.owner : p.id }), 7);
        return `<span class="${t.level === lv ? 'now' : ''}">${nm}</span><span>${lv <= (t.level || 1) ? '' : '升级 ' + fmt(floor100(g.landPrice(t) * CONFIG.upgradeCostRate[lv]))}</span><span>${fmt(rt)}</span>`;
      }).join('') + `</div>`;
    } else if (t.type === 'rail') {
      body += `<div class="rent-table">` + [1, 2, 3, 4].map(n =>
        `<span class="${owner && g.countType(owner.id, 'rail') === n ? 'now' : ''}">持有 ${n} 个锚点</span><span></span><span>${fmt(round10(CONFIG.railRent[n] * g.rei / 100))}</span>`).join('') + `</div>`;
    } else if (t.type === 'utility') {
      body += `<div class="kv"><span>租金</span><b>骰子点数 × ${CONFIG.utilityRentPerPip} × ${(g.rei / 100).toFixed(2)}</b></div>`;
    } else {
      const desc = {
        go: '冒险家协会：经过或停在起点领取委托报酬 ' + fmt(CONFIG.salary) + '。',
        jail: '梅洛彼得堡，路过无事（探监）。',
        gotojail: '被通缉：停在这里直接进梅洛彼得堡。',
        parking: '七天神像：在这里歇一歇，什么也不会发生。',
        tax: '摩拉税为现金的 10%（上限 ' + fmt(CONFIG.incomeTaxCap) + '），奢侈税固定 ' + fmt(CONFIG.luxuryTax) + '。',
        chance: '开一个宝箱，看看里面是什么。',
        fate: '深渊的凝视，多半不是好事。',
      }[t.type] || '';
      body += `<div class="kv"><span>说明</span><b style="font-weight:500">${desc}</b></div>`;
    }

    if (t.mortgaged && t.marginCall) {
      body = `<div class="kv"><span style="color:#fca5a5">⚠ 银行追缴中</span><b style="color:#fca5a5">本回合结束前不赎回就会被收回</b></div>` + body;
    }

    const actions = [];
    if (canAct && owner && owner.id === p.id) {
      if (t.type === 'land' && t.level < 5 && !t.mortgaged) {
        const cost = g.upgradeCost(t);
        actions.push({
          label: `升级为${CONFIG.levels[t.level + 1]} ${fmt(cost)}`, cls: 'ok', disabled: p.cash < cost,
          fn: () => {
            if (this.net) { this.send('upgrade', { tileId: t.id }); return; }
            const r = g.upgrade(t.id, p); if (!r.ok) this.toast(r.msg); this.renderAll(); this.tileModal(i);
          }
        });
      }
      if (!t.mortgaged) {
        actions.push({
          label: `抵押换 ${fmt(floor100(g.assetValue(t) * CONFIG.mortgageLtv))}`, cls: '',
          fn: () => {
            if (this.net) { this.send('mortgage', { tileId: t.id }); return; }
            const r = g.mortgage(t.id, p); if (!r.ok) this.toast(r.msg); this.renderAll(); this.tileModal(i);
          }
        });
        actions.push({
          label: `卖给银行 ${fmt(Math.round(g.assetValue(t) * CONFIG.sellToBankRate / 100) * 100)}`, cls: 'danger',
          fn: () => {
            if (this.net) { this.send('sellToBank', { tileId: t.id }); return; }
            const r = g.sellToBank(t.id, p); if (!r.ok) this.toast(r.msg); this.renderAll();
          }
        });
      } else {
        const cost = Math.round(t.loan * (1 + CONFIG.mortgageInterest));
        actions.push({
          label: `赎回 ${fmt(cost)}`, cls: 'ok', disabled: p.cash < cost,
          fn: () => {
            if (this.net) { this.send('redeem', { tileId: t.id }); return; }
            const r = g.redeem(t.id, p); if (!r.ok) this.toast(r.msg); this.renderAll(); this.tileModal(i);
          }
        });
      }
    }
    actions.push({ label: '关闭', cls: 'ghost' });
    this.modal({ title: t.name, sub: t.type === 'land' ? GROUPS[t.group].name + ' 地区' : '', body, actions });
  },

  assetsModal() {
    /* ★ "盘点资产"看的是我自己的，不是当前行动那个人的 */
    const g = this.g, p = this.meNow();
    const lands = g.ownedTiles(p.id).map(t =>
      `<div class="kv"><span>${t.name}${t.mortgaged ? '（抵押中）' : ''} · ${t.type === 'land' ? CONFIG.levels[t.level] : t.type === 'rail' ? '锚点' : '公共设施'}</span><b>${fmt(g.assetValue(t))}</b></div>`).join('') || '<div class="kv"><span>还没有地产</span><b>—</b></div>';
    const stocks = g.stocks.filter(s => (p.stocks[s.code] || 0) > 0).map(s =>
      `<div class="kv"><span>${s.name} × ${p.stocks[s.code]}</span><b>${fmt(p.stocks[s.code] * g.stockPrice(s))}</b></div>`).join('') || '<div class="kv"><span>还没有股票</span><b>—</b></div>';
    this.modal({
      title: p.name + ' 的资产',
      body: `<div class="kv"><span>现金</span><b>${fmt(p.cash)}</b></div>
        <div class="kv"><span>净资产</span><b style="color:#fbbf24">${fmt(g.netWorth(p))}</b></div>
        <div style="margin-top:8px;color:#8fa3bf">地产</div>${lands}
        <div style="margin-top:8px;color:#8fa3bf">股票</div>${stocks}`,
      actions: [{ label: '关闭', cls: 'ghost' }],
    });
  },
  showResult() {
    const g = this.g;
    if (!g || !g.ranking) return;
    if ($('modal-root').firstChild && this._resultShown) return;
    this._resultShown = true;
    const rows = g.ranking.map((r, i) =>
      `<tr class="${i === 0 ? 'win' : ''}">
        <td><span style="color:${r.color}">●</span> ${r.name}${r.alive ? '' : '（破产）'}</td>
        <td>${fmt(r.cash)}</td><td>${r.lands}</td><td>${r.stocks}</td><td>${fmt(r.net)}</td>
      </tr>`).join('');
    this.modal({
      title: '🏁 游戏结束',
      sub: `${g.winner.name} 获胜 · 共进行了 ${Math.min(g.quarter, g.totalQuarters())} 个季度`,
      body: `<table class="rank">
        <tr><th>玩家</th><th>现金</th><th>地产</th><th>股票</th><th>净资产</th></tr>
        ${rows}</table>
        <div style="margin-top:10px;color:#64748b;font-size:11.5px">
          净资产 = 现金 + 地产市值 + 股票市值 − 抵押负债。地产市值随地产指数（最终 ${g.rei.toFixed(1)}）浮动。
        </div>`,
      actions: [{
        label: '再来一局', cls: 'ok', fn: () => {
          /* 同 lobby 里那个按钮：先退掉房间身份再刷新，否则会被 tryReconnect 接回已结束的局 */
          try { if (NET && NET.clear) NET.clear(); } catch (e) {}
          location.reload();
        },
      }],
    });
  },

  rulesModal() {
    /* 规则速览随时可能被打开（可能还没开局），所以这里没有 g 可用，
       只能读全局 CONFIG —— 它此时就是"本局开局时用的值"。 */
    const total = CONFIG.maxQuarters || 10;
    this.modal({
      title: '规则速览',
      body: `
      <div class="kv"><span>目标</span><b>${total} 个季度后净资产最高者胜</b></div>
      <div class="kv"><span>走格</span><b>2 颗骰子，经过冒险家协会领 ${fmt(CONFIG.salary)}</b></div>
      <div class="kv"><span>买地</span><b>停在无主地按「当前地价」买下</b></div>
      <div class="kv"><span>盖楼</span><b>Lv1 空地 → Lv2 小屋 → Lv3 公寓 → Lv4 写字楼 → Lv5 地标</b></div>
      <div class="kv"><span>垄断</span><b>集齐一整个地区（蒙德 / 璃月 / 至冬 …），该区租金 ×${CONFIG.groupRentBonus}</b></div>
      <div class="kv"><span>地产指数</span><b>地价 = 基准 × REI%。涨则全线升值，跌则缩水</b></div>
      <div class="kv"><span>炒股</span><b>随时买卖，买入推动股价 +0.5%/股，卖出 −0.8%/股</b></div>
      <div class="kv"><span>地产 ETF</span><b>001 提瓦特地产的价格就是地产指数，买卖它会直接推动地价</b></div>
      <div class="kv"><span>分红</span><b>别人为某行业地块付租时，该行业股票持有人从银行拿分红</b></div>
      <div class="kv"><span>抵押</span><b>贷出市值 50%，赎回还 110%，抵押期间不收租且拖累指数</b></div>
      <div class="kv"><span>破产</span><b>变卖股票、抵押地产仍还不清就出局</b></div>
      <div class="kv"><span>破产拍卖</span><b>联机时出局者的地产会开一场密封报价拍卖，最高者得</b></div>
      <div style="margin-top:10px;color:#64748b;font-size:11.5px">
        快捷键：空格 = 掷骰子 / 结束回合。点棋盘格可以看地价、租金、升级和抵押。
      </div>`,
      actions: [{ label: '知道了', cls: 'ok' }],
    });
  },

  toast(msg) {
    const d = document.createElement('div');
    d.textContent = msg;
    d.className = 'toast';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1600);
  },
};

UI.setSpeed = function (v) { SPEED = v; };

if (typeof module !== 'undefined' && module.exports) module.exports = { UI };
