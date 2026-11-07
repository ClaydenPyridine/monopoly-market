/* ============================================================
 * 《地产股神》v0.1 — 数据与数值配置
 * 所有可调数值都在这里，改这个文件就能改游戏手感。
 * ============================================================ */

const CONFIG = {
  /* ── 以下数值由 tools/tune.mjs 跑了 160 轮自动调参定下来，
        目标是"一局约 2 小时、领先反复易手、真的会有人破产、现金不囤积"。
        改之前建议先跑一次 node tools/tune.mjs --games 200 看看评分卡。 ── */
  startingCash: 40000,      // 初始现金
  salary: 1800,             // 经过/到达起点工资
  maxQuarters: 35,          // 季度上限（每人行动一次 = 一个季度）
  /* ★ 50 → 35：真人实测 3.5 分钟/季度（AI 只要 0.02 秒），50 季度要 2.9 小时，超出设计目标。
     而且 AI 平均 Q34.9 才出现第一个出局——50 季度时真人根本打不到高潮。
     35 季度 ≈ 1.9 小时，正好把"破产/追缴/垄断"这些高潮拉进真人能打到的范围。 */
  jailFine: 1500,           // 保释金
  jailSkipTurns: 1,         // 入狱后强制停留的回合数
  incomeTaxRate: 0.10,      // 摩拉税：现金的 10%
  incomeTaxCap: 3000,       // 摩拉税上限
  luxuryTax: 2000,          // 奢侈税固定额

  mortgageLtv: 0.60,        // 抵押可贷出市值的比例
  mortgageInterest: 0.10,   // 赎回时的利息
  marginCallRatio: 1.10,    // 市值跌破「贷款 × 该比例」→ 触发追缴，一个回合内不赎回就被银行收走
  sellToBankRate: 0.70,     // 主动把地卖给银行的回收比例
  venturePerTurn: 1,        // ★ 风险投资卡每回合限买几张（原来不限，被刷过 304 张）
  groupRentBonus: 1.5,      // 集齐同一地区的租金加成
  /* ★ 走格子用哪种骰子。
     '2d6' = 经典钟形（2~12），**6/7/8 占 44.4%**，2 和 12 各只占 2.8%
     'd12' = 等概率 1~12，每点 8.33%
     实测反馈（群聊）：2d6 下"都一直走 678，导致有些格子几乎走不到，
     玩了两小时还有不少地没买"。d12 让格子覆盖均匀得多。
     风险投资卡仍然用 2d6 开奖（那张卡的赔率表就是按 2d6 设计的，不能动）。 */
  diceMode: 'd12',
  /* ★ 破产地产拍卖。
     原来破产时地产只有两个去向：整包白送给债权人（赢家滚雪球）或凭空回归银行（通缩）。
     两种都**没有价格发现** —— 而一块"买过来就能凑垄断"的地，对买方价值是市值的 2.4 倍，
     这个价值差原本被白白浪费。拍卖把它榨出来，而且让"凑垄断"从私下交易变成公开竞争。
     触发：破产时自动开拍；一轮密封报价，最高者得。 */
  auction: {
    enabled: true,
    minBid: 100,          // 低于这个价的报价算弃权
    windowMs: 25000,      // 联机时的出价窗口（超时就按已收到的票结算）
  },
  /* ★ 玩家间交易。所有人任何时候都能报价（和炒股一样不绑回合），
     但**同时只允许一笔待回应的报价**，避免几个人同时乱报把界面淹没。 */
  trade: {
    enabled: true,
    minRentSharePct: 10,   // 地租分红权最少卖 10%
    maxRentSharePct: 50,   // 最多卖 50%（留一半给地主，防止"卖了就完全不管这块地"）
  },
  /* ★ 地产 ↔ 股票的联动加强：垄断一个地区时，该地区收租触发的股票分红翻倍系数。
     原来股票分红只跟"哪个地区 + 租金够不够高"有关，跟"谁把这块地做成了垄断"完全无关。
     现在垄断会让对应股票分红更肥，逼玩家"左手买地、右手持股"。 */
  dividendMonopolyMult: 1.5,
  /* ★ 每回合最多盖几次楼。群里反馈"不能一次性堆叠"：原来没有限制，
     有钱就能把一块地一口气顶到 5 级，等于瞬间造出一个"踩到就死"的格子。
     远程升级（不站在那块地上也能盖）本来就是允许的，这条只限次数。 */
  upgradesPerTurn: 1,

  /* ★ 垄断门槛：持有该地区多少比例的地块算垄断。1 = 必须全拿（旧值）。
     降到 2/3 的理由：真人实测三局一次垄断都没发生，而多组地块已经卡在 2/3
     （NFYD 璃月 2-1-2、EW85 蒙德 3-0）。全持在 25 个季度内基本做不到。 */
  monopolyShare: 2 / 3,

  /* ★ 2026-10 修正：原 0.035 的物业税高到离谱——实测「收租 ÷ 物业税 = 0.34」，
     也就是囤地的人交出去的税是收回来的租的三倍，地产纯粹是负资产，
     玩家自然会退化成只炒股票。降到 0.012 后比值回到 2.5 左右，地产重新值得持有。
     详见 docs/地租经济学分析.md（tools/rent-audit.mjs / tools/rent-sweep.mjs 生成）。 */
  propertyTaxRate: 0.012,   // 每季度按地产市值收取的物业税（抵押中的地按一半计）
  propertyTaxMortgagedFactor: 0.5,
  /* ⚠️ 后期加压：**实测失败，已关闭**（保留代码与参数作为记录）。
     想法：局末物业税递增，逼囤地的人吐出现金 → 追缴 → 收地 → 破产，把高潮提前。
     配对 A/B（3 种子 × 150 局，其余参数相同）结果：
       总分 0.9001 vs 0.9176（**−0.0175**）
       首次淘汰 29.13 vs 29.50 季度（只提前 0.37，几乎没动）
       追缴 0.56 vs 0.66、强制收回 0.09 vs 0.12（**反而更少**）
       收租÷物业税 2.30 vs 3.39（**地产经济性被打回原形**）
     原因：加税让玩家主动抵押/卖地，课税基数反而缩小；而且 2.2 倍不足以在 6 个季度内压垮谁，
     再调高就会彻底毁掉地产经济。
     → **税是错的杠杆。真正能让人破产的是财富转移（租金），不是持有成本。**
     下次要试就试"局末租金加成"，而不是加税。 */
  propertyTaxLateFrom: 0.55,
  propertyTaxLateMult: 1,      // 1 = 关闭（实测 2.2 倍是负收益）

  reiStart: 100,            // 地产指数起点
  reiMin: 30,               // 下限（触底强反弹）
  reiMax: 400,              // 上限（触顶回调）
  reiRegression: 0.06,      // 每季度向"合理值"回归的速度
  /* ★ 活跃度项的"正常值"基线（每季度从 ΔREI 里扣掉）。
     实测每季度平均：买地 0.78×0.5 + 升级 1.89×0.8 + 赎回 0.14×1.0 − 抵押 0.49×1.5 ≈ +1.31。
     不扣掉的话，正常打牌就会让 REI 单向上漂（35 季累计 +47 点）。
     【实测结论：设 1.3 是负收益，暂不采用】
       配对 A/B（4 种子 × 150 局）：总分 0.9359 → 0.9273（−0.0086）；
       好处是期末指数从 128.5 降到 116.25（少涨 12 点、更贴设计意图），
       代价是追缴次数 0.49 → 1.15。
       而且它救不活周期 —— 因为均值回归的稳态由 fairRei 的稀缺加成决定，
       活动项只影响"到达稳态的过程"。所以代码保留、默认关掉（0 = 旧行为）。 */
  reiActivityBaseline: 0,
  reiScarcityBonus: 35,     // 地块被买光时，合理值最多上浮多少点
  reiCycleAmp: 46,          // ★ 地产周期振幅：一局会经历好几轮「繁荣—崩盘」
  reiCycleMin: 16,          // 一个完整周期最短多少季度
  reiCycleMax: 30,          // 最长多少季度
  reiTurnNoise: 2.2,        // 每名玩家回合的地产指数抖动
  reiQuarterNoise: 8,       // 每季度的地产指数抖动
  reiTradeCap: 8,           // 每季度"炒 ETF"最多能推动多少点（防杠杆刷分）

  levelValue:      [0, 1.0, 1.65, 2.45, 3.45, 4.7],     // 各等级的市值系数
  upgradeCostRate: [0, 0,  0.65, 0.8, 1.0, 1.25],       // 升级花费 = 地价 × 该系数
  /* ★ 2026-10 修正：全等级租金 ×2（原 [0,0.12,0.33,0.62,1.05,1.75] 太低）。
     这是配合物业税下调一起测出来的：租金 ×2 + 税率 0.012 时，
     实测收租/税 = 2.54、平均地产等级 2.78→3.63、平均破产人数 1.02→1.98。
     调高的是租金不是"印钱"——买家要先把钱投进购地和升级里才拿得到。 */
  rentRate:        [0, 0.24, 0.66, 1.24, 2.10, 3.50],   // 租金 = 地价 × 该系数
  levels: ['', '空地', '小屋', '公寓', '写字楼', '地标'],

  railPrice: 2000,                                  // 传送锚点基准价
  railRent: [0, 300, 600, 1200, 2400],              // 按持有锚点数
  utilityPrice: 1500,                               // 公共设施基准价
  utilityRentPerPip: 150,                           // 公共设施租金 = 骰子点数 × 该值

  stockBuyImpact: 0.005,     // 每买 1 股推动股价 +0.5%
  stockSellImpact: 0.008,    // 每卖 1 股推动股价 -0.8%
  stockSellTopExtra: 0.003,  // 卖出全场最高价股时额外多跌
  stockMaxOrderImpact: 0.06, // 单笔订单最大影响 6%
  stockCommission: 0.01,     // ★ 买卖各收 1% 手续费
  /* ★ 定价模型：**先吃滑点，再按推动后的价格成交**。
     所以你买到的永远是被自己推高的价，卖出永远是被自己砸低的价，
     同一回合内买卖往返必亏（约 2.8%），套利被从根上堵死。 */
  etfReiBuyImpact: 0.002,    // 买地产 ETF 时，每 1 股推动地产指数 +0.2%
  etfReiSellImpact: 0.003,   // 卖地产 ETF 时，每 1 股推动地产指数 -0.3%
  etfReiOrderCap: 0.02,      // 单笔订单对地产指数的最大影响 2%

  /* ── 金融产品（来自原 PDF 的银行金融系统）──
     高风险三件套里，垃圾债券与地产期权合起来最多持有一张；
     风险投资卡是买完立刻开奖，不占位。低风险两件各最多一张。 */
  cards: {
    ventureCost: 4000,   // 每回合限买张数见顶层 CONFIG.venturePerTurn       // 风险投资卡：买完立刻掷 2 颗骰开奖（期望值略高于成本，方差极大）
    ventureTable: [
      { min: 2, max: 3, pay: 0, text: '血本无归' },
      { min: 4, max: 5, pay: 2000, text: '拿回一半本金' },
      { min: 6, max: 8, pay: 3200, text: '小亏一点' },
      { min: 9, max: 10, pay: 4500, text: '刚好回本' },
      { min: 11, max: 11, pay: 13000, text: '赚了一笔！' },
      { min: 12, max: 12, pay: 26000, text: '一夜暴富！！' },
    ],
    junkCost: 2000,          // 垃圾债券：每圈额外领息，掷出爆雷点数就作废
    junkPayment: 600,        //   期望能领 5 圈左右，净收益约 +1000，但可能第一圈就炸
    junkTrapFaces: 1,        //   每圈掷 1 颗骰子，≤ 该值就爆雷
    optionCost: 800,         // 地产期权：锁定一块无主地
    optionMarks: 5,          //   5 次经过起点内有效
    optionDiscount: 0.5,     //   自己踩到 → 半价买下
    optionFee: 1500,         //   别人踩到 → 额外付给你
    insuranceCost: 2000,     // 租金保险：一次性
    insuranceSelfRate: 0.4,  //   你只付 40%，其余银行补给房东
    insuranceBankCap: 8000,  //   银行单次赔付上限
    depositAmount: 5000,     // 3 圈定期存单：到期拿回 112%（安全的钱）
    depositRate: 1.12,
    depositMarks: 3,
    depositPenalty: 2000,    //   提前赎回净亏这么多
  },

  dividend: {
    /* 每股分红，按"触发一次"计。定价思路：一次触发大约相当于股价的 4%~10%，
       持有一整个 10 季度大约能收回 20%~40%，比地租略低但不寒酸。 */
    rail: 108,        // 传送锚点被收租 → 传送网络每股分红
    utility: 108,     // 风车群 / 动能核心被收租 → 元素能源每股分红
    tech: 216,        // 枫丹地块收租 ≥ 2000 → 枫丹科学院每股分红
    techTrigger: 2000,
    retail: 180,      // 璃月地块收租 ≥ 1500 → 璃月商会每股分红
    retailTrigger: 1500,
    estate: 5,        // 任意地块被收租 → 提瓦特地产每股分红
    bankPerEvent: 45, // 北国银行：每季度末按本季租金笔数派息
    bankCap: 250,
  },
};

/* 玩家的棋子颜色 */
const PLAYER_COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419'];

/* 元素徽记（每个地区一种，画在地块的头像槽里） */
const ELEMENTS = {
  anemo:   { name: '风', color: '#74c2a8' },
  pyro:    { name: '火', color: '#ef7938' },
  electro: { name: '雷', color: '#b48cf2' },
  dendro:  { name: '草', color: '#a8c93a' },
  hydro:   { name: '水', color: '#4cc2f1' },
  geo:     { name: '岩', color: '#f0b73c' },
  moon:    { name: '月', color: '#8b8ff5' },
  cryo:    { name: '冰', color: '#a0e8ff' },
};

/* 色组 = 提瓦特的八个地区，按地价从低到高排列 */
const GROUPS = {
  mengde:    { name: '蒙德',     color: '#74c2a8', elem: 'anemo' },
  nata:      { name: '纳塔',     color: '#ef7938', elem: 'pyro' },
  inazuma:   { name: '稻妻',     color: '#b48cf2', elem: 'electro' },
  sumeru:    { name: '须弥',     color: '#a8c93a', elem: 'dendro' },
  fontaine:  { name: '枫丹',     color: '#4cc2f1', elem: 'hydro' },
  liyue:     { name: '璃月',     color: '#f0b73c', elem: 'geo' },
  nodkrai:   { name: '挪德卡莱', color: '#8b8ff5', elem: 'moon' },
  snezhnaya: { name: '至冬',     color: '#a0e8ff', elem: 'cryo' },
};

/* 40 格棋盘：0 = 起点，按顺时针（屏幕上是底边向右→左）排列
 * type: go | land | rail | utility | chance | fate | jail | gotojail | parking | tax
 * 每个色组的地块在棋盘上是连续的，凑齐一整组才有垄断加成。
 */
const TILES = [
  { id: 0,  type: 'go',       name: '冒险家协会',       short: '冒险协会', group: null,        basePrice: 0 },
  /* ── 蒙德（起始地区，最便宜）── */
  { id: 1,  type: 'land',     name: '蒙德城',           short: '蒙德城',   group: 'mengde',    basePrice: 600,  char: '琴',       avatar: 'jean' },
  { id: 2,  type: 'fate',     name: '深渊',             short: '深 渊',    group: null,        basePrice: 0 },
  { id: 3,  type: 'land',     name: '晨曦酒庄',         short: '酒庄',     group: 'mengde',    basePrice: 800,  char: '迪卢克',   avatar: 'diluc' },
  { id: 4,  type: 'tax',      name: '摩拉税',           short: '摩拉税',   group: null,        basePrice: 0 },
  { id: 5,  type: 'rail',     name: '传送锚点·蒙德',    short: '锚点',     group: 'rail',     basePrice: 2000, char: '蒙德', avatar: '' },
  /* ── 纳塔 ── */
  { id: 6,  type: 'land',     name: '圣火竞技场',       short: '竞技场',   group: 'nata',      basePrice: 1000, char: '玛薇卡',   avatar: 'mavuika' },
  { id: 7,  type: 'chance',   name: '宝箱',             short: '宝 箱',    group: null,        basePrice: 0 },
  { id: 8,  type: 'land',     name: '回声之子',         short: '回声',     group: 'nata',      basePrice: 1000, char: '希诺宁',   avatar: 'xilonen' },
  { id: 9,  type: 'land',     name: '流泉之众',         short: '流泉',     group: 'nata',      basePrice: 1200, char: '玛拉妮',   avatar: 'mualani' },
  /* ── 稻妻 ── */
  { id: 10, type: 'jail',     name: '梅洛彼得堡',       short: '梅 堡',    group: null,        basePrice: 0 },
  { id: 11, type: 'land',     name: '稻妻城',           short: '稻妻城',   group: 'inazuma',   basePrice: 1400, char: '雷电将军', avatar: 'raiden' },
  { id: 12, type: 'utility',  name: '蒙德风车群',       short: '风车群',   group: 'utility',   basePrice: 1500 },
  { id: 13, type: 'land',     name: '神里屋敷',         short: '神里',     group: 'inazuma',   basePrice: 1400, char: '神里绫华', avatar: 'ayaka' },
  { id: 14, type: 'land',     name: '鸣神大社',         short: '鸣神',     group: 'inazuma',   basePrice: 1600, char: '八重神子', avatar: 'yae' },
  { id: 15, type: 'rail',     name: '传送锚点·璃月',    short: '锚点',     group: 'rail',     basePrice: 2000, char: '璃月', avatar: '' },
  /* ── 须弥 ── */
  { id: 16, type: 'land',     name: '须弥城',           short: '须弥城',   group: 'sumeru',    basePrice: 1800, char: '纳西妲',  avatar: 'nahida' },
  { id: 17, type: 'fate',     name: '深渊',             short: '深 渊',    group: null,        basePrice: 0 },
  { id: 18, type: 'land',     name: '教令院',           short: '教令院',   group: 'sumeru',    basePrice: 1800, char: '艾尔海森', avatar: 'alhaitham' },
  { id: 19, type: 'land',     name: '桓那兰那',         short: '桓那',     group: 'sumeru',    basePrice: 2000, char: '提纳里',  avatar: 'tighnari' },
  { id: 20, type: 'parking',  name: '七天神像',         short: '七天神像', group: null,        basePrice: 0 },
  /* ── 枫丹（科技股的分红来源）── */
  { id: 21, type: 'land',     name: '枫丹廷',           short: '枫丹廷',   group: 'fontaine',  basePrice: 2200, char: '芙宁娜',  avatar: 'furina' },
  { id: 22, type: 'chance',   name: '宝箱',             short: '宝 箱',    group: null,        basePrice: 0 },
  { id: 23, type: 'land',     name: '白淞镇',           short: '白淞镇',   group: 'fontaine',  basePrice: 2200, char: '娜维娅',  avatar: 'navia' },
  { id: 24, type: 'land',     name: '欧庇克莱歌剧院',   short: '歌剧院',   group: 'fontaine',  basePrice: 2400, char: '那维莱特', avatar: 'neuvillette' },
  { id: 25, type: 'rail',     name: '传送锚点·稻妻',    short: '锚点',     group: 'rail',     basePrice: 2000, char: '稻妻', avatar: '' },
  /* ── 璃月（消费股的分红来源）── */
  { id: 26, type: 'land',     name: '璃月港',           short: '璃月港',   group: 'liyue',     basePrice: 2600, char: '钟离',    avatar: 'zhongli' },
  { id: 27, type: 'land',     name: '群玉阁',           short: '群玉阁',   group: 'liyue',     basePrice: 2600, char: '凝光',    avatar: 'ningguang' },
  { id: 28, type: 'utility',  name: '枫丹动能核心',     short: '动能',     group: 'utility',   basePrice: 1500 },
  { id: 29, type: 'land',     name: '望舒客栈',         short: '望舒',     group: 'liyue',     basePrice: 2800, char: '魈',      avatar: 'xiao' },
  { id: 30, type: 'gotojail', name: '通缉令',           short: '通 缉',    group: null,        basePrice: 0 },
  /* ── 挪德卡莱（代表角色待补：char / avatar 留空时只显示元素徽记）── */
  { id: 31, type: 'land',     name: '银月之庭',         short: '银月',     group: 'nodkrai',   basePrice: 3000, char: '',        avatar: '' },
  { id: 32, type: 'land',     name: '霜月工坊',         short: '霜月',     group: 'nodkrai',   basePrice: 3000, char: '',        avatar: '' },
  { id: 33, type: 'fate',     name: '深渊',             short: '深 渊',    group: null,        basePrice: 0 },
  { id: 34, type: 'land',     name: '皮拉米达城',       short: '皮拉米',   group: 'nodkrai',   basePrice: 3200, char: '',        avatar: '' },
  { id: 35, type: 'rail',     name: '传送锚点·须弥',    short: '锚点',     group: 'rail',     basePrice: 2000, char: '须弥', avatar: '' },
  /* ── 至冬（最贵，就在起点前面）── */
  { id: 36, type: 'chance',   name: '宝箱',             short: '宝 箱',    group: null,        basePrice: 0 },
  { id: 37, type: 'land',     name: '至冬宫',           short: '至冬宫',   group: 'snezhnaya', basePrice: 4000 },
  { id: 38, type: 'tax',      name: '奢侈税',           short: '奢侈税',   group: null,        basePrice: 0 },
  { id: 39, type: 'land',     name: '海屑镇',           short: '海屑镇',   group: 'snezhnaya', basePrice: 4000 },
];

/* 6 只股票
 * kind: 'rei' 的地产股价格永远等于地产指数
 * sector 用于事件卡定向打击
 */
const STOCKS = [
  { code: '001', name: '提瓦特地产', sector: 'estate',  kind: 'rei', price: 100,  base: 100,  drift: 0.000, vol: 0.000, desc: '地产 ETF：价格 = 地产指数，买卖它就是在炒整个提瓦特的房价' },
  { code: '002', name: '北国银行',   sector: 'bank',    kind: 'stock', price: 800,  base: 800,  drift: 0.004, vol: 0.045, desc: '金融：每季度末按全场地租笔数派息' },
  { code: '003', name: '枫丹科学院', sector: 'tech',    kind: 'stock', price: 1200, base: 1200, drift: 0.010, vol: 0.080, desc: '科技：枫丹地块被收租（≥2000）时每股派 120' },
  { code: '004', name: '元素能源',   sector: 'utility', kind: 'stock', price: 600,  base: 600,  drift: 0.003, vol: 0.030, desc: '能源：风车群 / 动能核心被收租时每股派 60' },
  { code: '005', name: '传送网络',   sector: 'rail',    kind: 'stock', price: 600,  base: 600,  drift: 0.003, vol: 0.030, desc: '交通：传送锚点被收租时每股派 60' },
  { code: '006', name: '璃月商会',   sector: 'retail',  kind: 'stock', price: 1000, base: 1000, drift: 0.006, vol: 0.050, desc: '消费：璃月地块被收租（≥1500）时每股派 100' },
];

/* 事件卡：effect 由引擎解释执行
 * type: rei | stockAll | stockSector | cash | cashPct | perLand | perLevel | jail | combo
 */
const EVENTS = [
  { title: '调控新政', text: '住建部连夜发文，地产指数应声下挫。', effect: { type: 'rei', delta: -12 }, weight: 7 },
  { title: '地王诞生', text: '核心地块拍出天价，全城看涨。', effect: { type: 'rei', delta: 12 }, weight: 7 },
  { title: '降息利好', text: '央行降息，资金涌入股市。', effect: { type: 'combo', list: [{ type: 'stockAll', pct: 0.05 }, { type: 'rei', delta: 5 }] }, weight: 7 },
  { title: '加息收紧', text: '央行加息，杠杆资金撤退。', effect: { type: 'combo', list: [{ type: 'stockAll', pct: -0.05 }, { type: 'rei', delta: -5 }] }, weight: 7 },
  { title: '拆迁补偿', text: '你家一块地被划入征收范围，拿到补偿款。', effect: { type: 'perLand', cash: 400 }, weight: 6 },
  { title: '税务稽查', text: '税务上门，按现金比例补缴。', effect: { type: 'cashPct', pct: -0.08 }, weight: 6 },
  { title: '物业费上涨', text: '名下每级房产都要多掏一笔维护费。', effect: { type: 'perLevel', cash: -250 }, weight: 6 },
  { title: '中签新股', text: '打新中签，白捡一笔。', effect: { type: 'cash', amount: 5000 }, weight: 6 },
  { title: '保险理赔', text: '老房子走了火险，保险公司赔付。', effect: { type: 'cash', amount: 2500 }, weight: 6 },
  { title: '科技突破', text: '本地芯片企业流片成功，科技股大涨。', effect: { type: 'stockSector', sector: 'tech', pct: 0.15 }, weight: 5 },
  { title: '能源危机', text: '煤价飙升，能源股吃香，地产承压。', effect: { type: 'combo', list: [{ type: 'stockSector', sector: 'utility', pct: 0.12 }, { type: 'rei', delta: -6 }] }, weight: 5 },
  { title: '高铁规划', text: '新高铁线获批，交通股受益。', effect: { type: 'stockSector', sector: 'rail', pct: 0.12 }, weight: 5 },
  { title: '消费复苏', text: '商圈客流创新高，消费股走强。', effect: { type: 'stockSector', sector: 'retail', pct: 0.10 }, weight: 5 },
  { title: '降准放水', text: '银行获得低成本资金，金融股上扬。', effect: { type: 'combo', list: [{ type: 'stockSector', sector: 'bank', pct: 0.08 }, { type: 'rei', delta: 6 }] }, weight: 5 },
  { title: '金融危机', text: '系统性风险爆发，股债房三杀。', effect: { type: 'combo', list: [{ type: 'stockAll', pct: -0.12 }, { type: 'rei', delta: -15 }] }, weight: 3 },
  { title: '城市扩张', text: '新城规划落地，土地价值重估。', effect: { type: 'rei', delta: 8 }, weight: 5 },
  { title: '股市操纵案', text: '某只股票被查出违规，股价闪崩。', effect: { type: 'stockRandomSector', pct: -0.20 }, weight: 4 },
  { title: '交通违规', text: '开车看行情，被请去拘留所冷静一下。', effect: { type: 'jail' }, weight: 4 },
  { title: '政府补贴', text: '旧改项目拿到财政补贴。', effect: { type: 'perLand', cash: 250 }, weight: 6 },
  { title: '遗产继承', text: '远房亲戚留下一笔钱和一块地。', effect: { type: 'cash', amount: 8000 }, weight: 3 },
];

/* 机会卡偏向"机会"，命运卡偏向"风险"，先共用同一副牌但权重不同 */
const CHANCE_BIAS = ['降息利好', '科技突破', '中签新股', '城市扩张', '消费复苏', '高铁规划', '地王诞生', '政府补贴', '保险理赔', '拆迁补偿'];
const FATE_BIAS = ['调控新政', '加息收紧', '金融危机', '税务稽查', '物业费上涨', '能源危机', '股市操纵案', '交通违规', '遗产继承'];
