/* ============================================================
 * 联机层：大厅、SSE 收状态、POST 发操作
 * 权威状态在服务端，客户端只负责渲染 + 上报操作。
 * ============================================================ */

/* 掉线被电脑托管时，前端自动认回座位的节流：
   最多 5 秒试一次，单次 POST 最多等 8 秒 —— 认座请求再怎么卡，
   也不能把长轮询循环拖住。 */
const NET_RECLAIM_MS = 5000;
const NET_RECLAIM_TIMEOUT_MS = 8000;
/* 被托管时常驻的提示：说清谁在替我打、怎么拿回来 */
const NET_AI_TEXT = '🤖 你掉线太久了，电脑正在替你行动。点任意操作即可接管回来。';

const NET = {
  room: null,
  token: null,
  seat: -1,
  es: null,
  name: '',
  connected: false,
  /* 我自己这个座位当前是不是由电脑在托管（服务端状态里的 myAI，最近一次的判定） */
  myAI: false,
  /* 房间是否已开局（服务端状态里的 started）——开局后才谈得上「中途加入」 */
  started: false,
  /* 被「这局已经开打了」拒绝过的房间号：用它把「中途加入」入口显示出来 */
  hotRoom: null,

  /* ---------- 本地保存，刷新/断线后可回到原座位 ---------- */
  save() {
    try {
      localStorage.setItem('dgs-net', JSON.stringify({ room: this.room, token: this.token, name: this.name }));
    } catch (e) {}
  },
  load() {
    try { return JSON.parse(localStorage.getItem('dgs-net') || 'null'); } catch (e) { return null; }
  },
  clear() {
    try { localStorage.removeItem('dgs-net'); } catch (e) {}
    this.room = null; this.token = null; this.seat = -1;
    this.disconnect();
    this.connected = false;
    this.myAI = false;
    this.started = false;
    this.hotRoom = null;
    this.setBanner(false);
  },

  /* ---------- HTTP ---------- */
  /* timeoutMs 可选：认座那次 POST 必须能超时，否则它会把长轮询循环拖住 */
  async post(url, body, timeoutMs) {
    const opt = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    };
    const ctl = timeoutMs ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    if (ctl) opt.signal = ctl.signal;
    try {
      const r = await fetch(url, opt);
      return await r.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async createRoom(name) {
    const j = await this.post('/api/create', { name });
    if (!j.ok) return j;
    this.room = j.room; this.token = j.token; this.seat = j.seat; this.name = name;
    this.save();
    this.connect();
    return j;
  },

  async joinRoom(code, name) {
    const j = await this.post('/api/join', { room: code, name });
    if (!j.ok) return j;
    this.room = j.room; this.token = j.token; this.seat = j.seat; this.name = name;
    this.save();
    this.connect();
    return j;
  },

  async startGame(opts) {
    const j = await this.post('/api/start', Object.assign({ room: this.room, token: this.token }, opts || {}));
    return j;
  },

  /* ---------- 中途加入：顶替一台「本来就是电脑」的座位 ----------
     房间已经开局、但还有纯电脑座位时，后到的人可以直接坐下接着玩。
     ★ autoAI 的座位不算：那是原来那个真人掉线被临时托管，必须留给他回来认领，
       顶掉他就等于把人踢出局了。这条判断在服务端，前端只负责别把入口给他。
     不加 hotjoin 的普通 join 行为不变：已开局的房间照样拒绝。 */
  async hotJoin(code, name) {
    const nm = name || this.name || '玩家';
    const j = await this.post('/api/join', { room: code, name: nm, hotjoin: true });
    if (!j.ok) return j;
    this.room = j.room; this.token = j.token; this.seat = j.seat; this.name = nm;
    this.hotRoom = null;
    this.myAI = false;
    this.save();
    this.connect();              // 状态由长轮询推过来，UI.applyState 会接手
    return j;
  },

  /** 页面加载时尝试用上次的身份回到房间 */
  async tryReconnect() {
    const s = this.load();
    if (!s || !s.room || !s.token) return false;
    try {
      const j = await this.post('/api/join', { room: s.room, token: s.token, name: s.name || '' });
      if (!j.ok) { this.clear(); return false; }
      /* ★ 房间里的对局**已经打完了**就别重连 —— 否则玩家被拽回一个结束的局里，
         屏幕上只剩结算画面、回不到开局设置，用户看到的就是"结束后再来一局无法正常启动"。
         复现路径：结束后点「再来一局」→ location.reload() → 这里自动重连回旧房间。
         清掉身份，让他回到大厅/开局设置，自己开新房间。 */
      try {
        const r = await fetch('/api/state?room=' + encodeURIComponent(j.room) +
          '&token=' + encodeURIComponent(j.token));
        const st = await r.json();
        const gg = st && st.state && st.state.game ? JSON.parse(st.state.game) : null;
        if (gg && gg.over) { this.clear(); return false; }
      } catch (e) { /* 查不到就按老逻辑继续重连，别因为一次探测失败把人挡在外面 */ }
      this.room = j.room; this.token = j.token; this.seat = j.seat; this.name = s.name || '';
      this.save();
      this.connect();
      return true;
    } catch (e) { return false; }
  },

  /* ---------- 认回座位（唯一的重试出口，别在别处再写一套）----------
     两个入口都走这里：
       1) 长轮询回「身份无效」——多半是房主重启过服务端，老 token 没了；
       2) 状态里 myAI === true —— 掉线太久被电脑托管，要立刻抢回控制权。
     节流：最长每 5 秒一次（时间戳 _lastReclaim），同一时刻只允许一个请求在飞；
     否则长轮询一断一续就会变成对着服务端刷 POST。
     认不回来不报错（服务端本来就可能还没把座位还给你），静静地等下一轮。 */
  async reclaimSeat() {
    if (this._reclaiming || this._stopped || !this.room) return false;
    const now = Date.now();
    if (now - (this._lastReclaim || 0) < NET_RECLAIM_MS) return false;
    this._lastReclaim = now;
    this._reclaiming = true;
    try {
      /* 1) 优先 token：服务端没重启、只是把我的座位交给电脑时，token 还是原来那个 */
      if (this.token) {
        const rj = await this.post('/api/join',
          { room: this.room, token: this.token, name: this.name || '' }, NET_RECLAIM_TIMEOUT_MS);
        if (rj && rj.ok && this.applyRejoin(rj)) return true;
      }
      /* 2) token 已经失效 → 用「房间号 + 原来的名字」认回原座位 */
      if (this.name) {
        const rj = await this.post('/api/join',
          { room: this.room, name: this.name }, NET_RECLAIM_TIMEOUT_MS);
        if (rj && rj.ok && this.applyRejoin(rj)) return true;
      }
      return false;
    } catch (e) {
      return false;              // 网络抖一下很正常，交给下一次重试
    } finally {
      this._reclaiming = false;
    }
  },
  /** 认回座位成功后的统一收尾：换新 token、恢复真人身份、关掉提示横幅 */
  applyRejoin(rj) {
    if (this._stopped || !this.room) return false;   // 认回来之前玩家已经离开房间，别把他拽回来
    if (rj.token) this.token = rj.token;
    if (typeof rj.seat === 'number') this.seat = rj.seat;
    this.connected = true;
    this.myAI = false;           // 服务端已经把我恢复成真人了
    this.save();
    this.setBanner(false);
    return true;
  },

  /* ---------- 收状态：长轮询 ----------
     ★ 这里刻意不用 SSE（EventSource）：Cloudflare Quick Tunnel 会把 SSE 缓冲住
       （实测公网地址 20 秒 0 字节，本机回环立刻到），朋友那边会永远停在加载中。
       长轮询是一个普通的完整 HTTP 响应，任何隧道/代理都能过。
       服务端有变化就立刻返回、没变化就挂起 25 秒，所以延迟和 SSE 一样是"即时"的。 */
  /** 断线横幅：房主关掉服务端 / 网络抖动时，玩家至少知道发生了什么 */
  setBanner(on, text) {
    const el = document.getElementById('net-banner');
    if (!el) return;
    if (on) {
      el.textContent = text || '与服务器的连接断开了，正在自动重连…（房主的黑窗口还开着吗？）';
      el.classList.remove('hide');
    } else {
      el.classList.add('hide');
    }
  },
  /* ---------- 掉线托管：看得见 + 自动抢回控制权 ----------
     服务端在我掉线超过一段时间后会把座位交给电脑，状态里 myAI 变成 true。
     电脑可能已经替我花过钱、做过决定，所以这里必须：
       1) 挂一个常驻提示，别让玩家一头雾水地看着"自己"在自动操作；
       2) 自动用 /api/join 认回座位（节流在 reclaimSeat 里），成功就收掉提示。
     ★ 这个函数跑在长轮询循环里：任何异常都必须就地吞掉，抛出去整个轮询会断，
       玩家就真掉线了。 */
  syncMyAI(st) {
    try {
      if (st && typeof st.myAI === 'boolean') this.myAI = st.myAI;
      if (this.myAI === true) {
        this.setBanner(true, NET_AI_TEXT);
        /* 不 await：认座是一次额外的 POST，它卡住也不能拖住长轮询。
           失败不提示、不报错，下一轮再试。 */
        this.reclaimSeat().then(ok => {
          if (ok) this.setBanner(false);
        }).catch(() => {});
      } else if (st && st.myAI === false) {
        this.setBanner(false);     // 服务端把我变回真人了 → 关掉托管提示
      }
    } catch (e) { /* 只是提示和认座，绝不能影响长轮询 */ }
  },
  connect() {
    this.disconnect();
    this._stopped = false;
    this.ver = -1;
    this.pollLoop();
  },
  disconnect() {
    this._stopped = true;
    if (this.es) { this.es.close(); this.es = null; }
  },
  async pollLoop() {
    while (!this._stopped && this.room && this.token) {
      let j = null;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 40000);   // 比服务端 25 秒挂起留足余量
        const url = '/api/wait?room=' + encodeURIComponent(this.room)
          + '&token=' + encodeURIComponent(this.token) + '&since=' + this.ver;
        const r = await fetch(url, { signal: ctl.signal });
        clearTimeout(timer);
        if (!r.ok) throw new Error('http ' + r.status);
        j = await r.json();
      } catch (e) {
        if (this._stopped) return;
        this.connected = false;
        if (UI.g && !UI.g.over) this.setBanner(true);
        else if (NET && document.getElementById('lobby') && !document.getElementById('lobby').classList.contains('hide')) this.renderLobby();
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      if (this._stopped) return;
      if (!j.ok) {
        /* 身份失效（多半是房主重启过服务端、老 token 没了）
           → 认回自己的座位，玩家不需要做任何事。
           ★ 认座只有 reclaimSeat() 这一个出口：它同时服务「身份失效」和
             「掉线被电脑托管」两种场景，这里不要再写第二套重试。 */
        if (/身份无效|没有这个房间号/.test(j.msg || '') && this.name) {
          try {
            if (await this.reclaimSeat()) continue;
          } catch (e) { /* reclaimSeat 自己吞异常，这里只是双保险 */ }
        }
        this.connected = false;
        this.setBanner(true, j.msg || '连接被服务端拒绝了');
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      this.connected = true;
      this.setBanner(false);
      this.ver = typeof j.ver === 'number' ? j.ver : this.ver;
      if (j.state) {
        this.seat = j.state.mySeat;
        UI.applyState(j.state);
      } else if (document.getElementById('lobby') && !document.getElementById('lobby').classList.contains('hide')) {
        this.renderLobby();          // 没变化时也刷新一下大厅的连接状态
      }
      /* ★ 掉线托管：myAI === true 就是"我现在由电脑在替我打"。
         必须放在最后 —— 上面的 setBanner(false) 已经清掉了「断线」横幅，
         这里要把托管提示重新顶上去；没带状态的轮询（unchanged）也得重画一遍，
         否则长达 25 秒的挂起会让提示闪一下就没了。 */
      this.syncMyAI(j.state);
    }
  },

  /* ---------- 发操作（超时重试 + 幂等 reqId）----------
     公网隧道实测约 8% 的 POST 会丢，所以这里超时自动重试；
     重试用同一个 reqId，服务端认得，不会把同一步执行两次。 */
  nextReqId() {
    this._reqSeq = (this._reqSeq || 0) + 1;
    this._clientId = this._clientId || Math.random().toString(36).slice(2, 8);
    return this._clientId + '-' + this._reqSeq;
  },
  async send(action, payload) {
    if (!this.room) return { ok: false, msg: '没有联机' };
    const reqId = this.nextReqId();
    const body = { room: this.room, token: this.token, action, payload: payload || {}, reqId };
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        res = await fetch('/api/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        clearTimeout(timer);
      } catch (e) {
        if (attempt === 2) { UI.toast('网络卡住了，这一步没送出去，请再点一次'); return { ok: false, netError: true }; }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      let j;
      try { j = await res.json(); } catch (e) { j = { ok: false, msg: '服务端返回异常' }; }
      if (!j.ok && j.msg) UI.toast(j.msg);
      return j;
    }
    return { ok: false, netError: true };
  },

  /* ---------- 大厅界面 ---------- */
  renderLobby() {
    const box = document.getElementById('lobby-body');
    if (!box) return;
    if (location.protocol === 'file:') {
      box.innerHTML = `
        <p class="sub" style="color:#fbbf24">联机需要从服务端打开页面，直接用 file:// 打开是不行的。</p>
        <div class="lobby-note">
          1. 在任意一台电脑上跑：<code>node server.mjs</code><br>
          2. 那台电脑的浏览器打开 <code>http://127.0.0.1:8787/</code><br>
          3. 同 WiFi 的朋友打开 <code>http://房主的内网IP:8787/</code>（启动时终端里会打印出来）<br>
          4. 房主「创建房间」→ 把 4 位房间号发给大家 → 「开始游戏」
        </div>
        <div class="lobby-btns"><button class="btn ghost big" id="lobby-back">返回</button></div>`;
      document.getElementById('lobby-back').onclick = () => {
        document.getElementById('lobby').classList.add('hide');
        document.getElementById('setup').classList.remove('hide');
      };
      return;
    }
    if (!this.room) {
      box.innerHTML = `
        <p class="sub">3~4 人，各看各的屏幕。房主创建房间后把 4 位房间号发给大家。</p>
        <div class="lobby-row">
          <input id="lobby-name" maxlength="12" placeholder="你的名字" value="${this.name || ''}">
        </div>
        <div class="lobby-btns">
          <button class="btn big" id="lobby-create">创建房间</button>
        </div>
        <div class="lobby-sep">或者</div>
        <div class="lobby-row">
          <input id="lobby-code" maxlength="4" placeholder="房间号" style="text-transform:uppercase;letter-spacing:4px;text-align:center;font-size:18px">
        </div>
        <div class="lobby-btns">
          <button class="btn ghost big" id="lobby-join">加入房间</button>
        </div>
        ${this.hotRoom ? `
        <div class="lobby-btns">
          <button class="btn big ok" id="lobby-hotjoin">中途加入（顶替电脑座位）</button>
        </div>
        <p class="tip">房间 <b>${this.hotRoom}</b> 已经开打了；只要还有电脑座位就能顶替进去。
          掉线被托管的座位会留给本人，不会让给别人。</p>` : ''}
        <p class="tip">服务端没启动的话先在那台机器上跑：<code>node server.mjs</code></p>`;
      const nm = () => (document.getElementById('lobby-name').value || '').trim() || '玩家';
      document.getElementById('lobby-create').onclick = async () => {
        const j = await this.createRoom(nm());
        if (!j.ok) UI.toast(j.msg || '创建失败');
        this.renderLobby();
      };
      document.getElementById('lobby-join').onclick = async () => {
        const code = (document.getElementById('lobby-code').value || '').trim().toUpperCase();
        if (code.length !== 4) { UI.toast('房间号是 4 位'); return; }
        const j = await this.joinRoom(code, nm());
        if (!j.ok) {
          UI.toast(j.msg || '加入失败');
          this.name = nm();        // 名字留住：重画大厅会重建输入框，不然玩家还得再打一遍
          /* 已经开打的房间会被拒 —— 这时给出「中途加入」入口；
             到底有没有可顶替的座位由服务端说了算，试了才知道。 */
          this.hotRoom = /已经开打/.test(j.msg || '') ? code : null;
        }
        this.renderLobby();
      };
      const hotBtn = document.getElementById('lobby-hotjoin');
      if (hotBtn) hotBtn.onclick = async () => {
        try {
          const j = await this.hotJoin(this.hotRoom, nm());
          /* 失败（比如电脑座位已经被别人顶完 / 只剩托管座位）就收起入口，别让按钮骗人 */
          if (!j.ok) { UI.toast(j.msg || '加入失败'); this.hotRoom = null; }
        } catch (e) { UI.toast('网络异常，没进得去'); }
        this.renderLobby();
      };
      return;
    }

    /* 房间里 */
    const seats = this.seats || [];
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const s = seats[i];
      const me = i === this.seat;
      rows.push(`<div class="lobby-seat${s ? '' : ' empty'}${me ? ' me' : ''}">
        <span class="dot" style="background:${PLAYER_COLORS[i]}"></span>
        <b>${s ? s.name : '空位'}</b>
        ${me ? '<em>你</em>' : ''}
        ${s && !s.isAI && !s.connected ? '<em class="off">掉线</em>' : ''}
        ${s && s.isAI ? '<em class="ai">电脑</em>' : ''}
        ${!s ? '<em class="ai">开局时自动补电脑</em>' : ''}
      </div>`);
    }
    const isHost = this.seat === 0;
    /* 开局后还能进人的情况：房里还有「本来就是电脑」的座位。
       ★ autoAI === true 的座位不算 —— 那是原来那个真人掉线被临时托管，
         必须留给他回来认领，让别人顶掉就等于把人踢出局了。 */
    const replaceable = seats.filter(s => s && s.isAI && !s.autoAI).length;
    const canHotJoin = !isHost && this.started === true && replaceable > 0;
    /* 还没连上的真人（正在加载页面 / 刚输完房间号）——提醒房主别急着开始 */
    const waiting = seats.filter(s => s && !s.isAI && !s.connected).length;
    const humans = seats.filter(s => s && !s.isAI).length;
    const warn = isHost && waiting > 0
      ? `<p class="lobby-warn">⚠ 还有 ${waiting} 位真人没连上（正在加载页面），等他们变成「已连接」再点开始，
          不然他们可能进不来。</p>`
      : '';
    box.innerHTML = `
      <div class="lobby-code">${this.room}</div>
      <p class="sub">把上面这 4 位房间号发给朋友，让他们在「加入房间」里输入。<br>
        状态：${this.connected ? '<b style="color:#34d399">已连接</b>' : '<b style="color:#fbbf24">连接中…</b>'}
        ｜已入座真人 ${humans} 位</p>
      <div class="lobby-seats">${rows.join('')}</div>
      ${warn}
      ${isHost ? `
        <div class="lobby-row" style="justify-content:center;gap:18px;margin-top:14px">
          <label>人数
            <select id="lobby-players">
              <option value="4" selected>4 人</option>
              <option value="3">3 人</option>
              <option value="2">2 人</option>
            </select>
          </label>
          <label>时长
            <select id="lobby-quarters">
              <option value="25">25 季度（约 1 小时）</option>
              <option value="50" selected>50 季度（约 2 小时）</option>
              <option value="75">75 季度（约 3 小时）</option>
            </select>
          </label>
        </div>
        <div class="lobby-btns"><button class="btn big ok" id="lobby-start">${waiting > 0 ? `开始游戏（还有 ${waiting} 人没连上）` : '开始游戏'}</button></div>
        <p class="tip">空位会在开局时自动补上电脑。<b>开始后就不能再进人了</b>，所以要等人齐。</p>`
        : canHotJoin ? `
        <p class="tip">这局已经开打了。房里还有 <b>${replaceable}</b> 个电脑座位，可以顶替一个坐进去。</p>
        <div class="lobby-btns"><button class="btn big ok" id="lobby-hotjoin">中途加入（顶替电脑座位）</button></div>`
        : '<p class="tip">等房主开始游戏…</p>'}
      <div class="lobby-btns"><button class="btn ghost" id="lobby-leave">离开房间</button></div>`;

    const startBtn = document.getElementById('lobby-start');
    if (startBtn) startBtn.onclick = async () => {
      const players = parseInt(document.getElementById('lobby-players').value, 10);
      const quarters = parseInt(document.getElementById('lobby-quarters').value, 10);
      const j = await this.startGame({ players, quarters });
      if (!j.ok) UI.toast(j.msg || '开始失败');
    };
    const hotBtn2 = document.getElementById('lobby-hotjoin');
    if (hotBtn2) hotBtn2.onclick = async () => {
      try {
        const j = await this.hotJoin(this.room, this.name || '玩家');
        if (!j.ok) UI.toast(j.msg || '加入失败');
      } catch (e) { UI.toast('网络异常，没进得去'); }
      this.renderLobby();
    };
    document.getElementById('lobby-leave').onclick = () => {
      this.clear();
      document.getElementById('lobby').classList.add('hide');
      document.getElementById('setup').classList.remove('hide');
      this.renderLobby();
    };
  },

  /** 服务端推来的座位表更新时刷新大厅 */
  onSeats(seats, started) {
    this.seats = seats;
    this.started = !!started;      // 开局后才允许「中途加入」的判定
    if (!started) this.renderLobby();
  },
};
