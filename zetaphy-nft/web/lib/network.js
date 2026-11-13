// ZETAPHY networks: the one definition every web app reads (hub, wallet, swap, NFT, explorer, Neuro).
// Mainnet is the default; a visitor can pick the testnet with the network switch, remembered in this
// browser (localStorage "zetaphy:network"; a ?network=testnet|mainnet link sets it too).
//
// The pages read the chosen network ONCE when they load (activeNetwork()) and reload when it changes, so
// every chain id, RPC, contract address and wallet check on a page belongs to one network: a signature can
// never be asked for one chain while the page talks to the other.
//
// Canonical copy: zetaphy-hub/network.js. `npm run sync:shared` in zetaphy-hub copies it to every site that
// serves it (each site is its own origin with CSP script-src 'self'); test/shared.test.mjs checks the copies.
// No imports: the same file runs in every site and in Node tests.

export const NETWORK_KEY = 'zetaphy:network';
export const DEFAULT_NETWORK = 'mainnet';
const REPO = 'https://github.com/pospos191-alt/zetaphy';
const MAINNET_RPC = 'https://129-221-199-191.sslip.io'; // the public sentry (rpc-guard); the validator has no public port
const TESTNET_RPC = 'https://rpc.sawasdeecoin.com';
/** The native coin as an ERC-20 (precompile): the DEX router's wrapped native on both networks. */
export const NATIVE_ERC20 = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// What exists on each network. A feature that is false shows "testnet only for now" with a switch;
// its contracts are never called on that network.
const ALL_FEATURES = ['wallet', 'staking', 'governance', 'explorer', 'neuro', 'dex', 'nft', 'dlmm', 'bridge', 'faucet', 'mining',
  'usefulWork', 'testTokens', 'stableGateway', 'rewardVault', 'computeMarket', 'identity', 'quantumWallet', 'airdrop', 'agents',
  'offline', 'audit', 'aiMap', 'immune', 'forecasts', 'federated', 'validators'];
const only = (...on) => Object.freeze(Object.fromEntries(ALL_FEATURES.map((f) => [f, on.includes(f)])));
export const FEATURES = Object.freeze([...ALL_FEATURES]);

const freeze = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' && !Object.isFrozen(v) ? Object.freeze(v) : v])));

export const NETWORKS = Object.freeze({
  mainnet: freeze({
    id: 'mainnet',
    testnet: false,
    name: 'ZETAPHY',
    label: 'ZETAPHY mainnet',
    chainName: 'ZETAPHY', // wallet_addEthereumChain / Keplr
    chainId: 3659,
    chainIdHex: '0xe4b',
    cosmosChainId: 'zetaphy_3659-1',
    symbol: 'ZTPHY',
    denom: 'azetaphy',
    decimals: 18,
    minGasPrice: 1000000000, // 1 gwei
    bech32: 'zetaphy',
    rpc: MAINNET_RPC, // EVM JSON-RPC
    comet: `${MAINNET_RPC}/rpc`,
    rest: `${MAINNET_RPC}/rest`,
    explorer: null, // no mainnet explorer backend: the explorer app reads the RPC directly
    genesisSha256: 'ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667',
    genesisTime: '2026-11-13T14:00:00Z',
    notice: `${REPO}/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md`,
    noticeTh: `${REPO}/blob/main/docs/ZETAPHY-MAINNET-NOTICE.th.md`,
    files: `${REPO}/tree/main/zetaphy-chain/mainnet/zetaphy_3659-1`,
    // zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json (test/network.test.mjs checks they agree)
    contracts: {
      neuroControl: '0x97F5D7FBc6228aA7A145505AABdbdC7825e161AE',
      neuroJobs: '0x5044309622064d21c5D7Ac681f7a4489ca4Ce4fB',
      threatRegistry: '0xaACfc7Cf7148b7AE530c2Ab891D4220E648A2139',
      threatReports: '0x11411E0c35dA30b4a5009827770798ad79881c31',
      factory: '0x93463B001483970f8CAE63cd8B60D28F17a1C1AA', // ZetaphyFactory (no pools yet)
      router: '0xa5221A7F25cf10d99446Fde3e95c15b1f696e783', // ZetaphyRouter
      wnative: NATIVE_ERC20,
      bugBounty: '0xb73856D25a3547581D36E8F2D9F3601a5DF39eBE', // ZetaphyBounty
      timelock: '0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA',
      guardian: '0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519', // guardian multisig (2 of 3)
    },
    features: only('wallet', 'staking', 'governance', 'explorer', 'neuro', 'dex'),
  }),
  testnet: freeze({
    id: 'testnet',
    testnet: true,
    name: 'ZETAPHY Testnet',
    label: 'ZETAPHY testnet',
    chainName: 'ZETAPHY Testnet',
    chainId: 77390,
    chainIdHex: '0x12e4e',
    cosmosChainId: 'zetaphy_77390-1',
    symbol: 'ZTPHY',
    denom: 'azetaphy',
    decimals: 18,
    minGasPrice: 1000000000,
    bech32: 'zetaphy',
    rpc: TESTNET_RPC,
    comet: `${TESTNET_RPC}/rpc`,
    rest: `${TESTNET_RPC}/rest`,
    explorer: 'https://explorer.sawasdeecoin.com',
    notice: null,
    noticeTh: null,
    files: null,
    // the testnet's addresses come from each app's deployment files, as before (zetaphy-launch/state/77390.json
    // through the hub's build, zetaphy-dex/web/deployments.json, zetaphy-nft/web/deployments.json, explorer config.json)
    contracts: null,
    features: only(...ALL_FEATURES),
  }),
});

export const isNetworkId = (id) => id === 'mainnet' || id === 'testnet';

/**
 * The network this page uses: a ?network= link (remembered), else the one remembered in this browser, else mainnet.
 * storage / search are passed by tests; any storage error (private mode, blocked) falls back to the default.
 */
export function readNetworkId({ storage, search } = {}) {
  let fromUrl = null;
  try { fromUrl = new URLSearchParams(search ?? '').get('network'); } catch { /* none */ }
  if (isNetworkId(fromUrl)) {
    try { storage?.setItem(NETWORK_KEY, fromUrl); } catch { /* not remembered */ }
    return fromUrl;
  }
  let saved = null;
  try { saved = storage?.getItem(NETWORK_KEY) ?? null; } catch { /* default */ }
  return isNetworkId(saved) ? saved : DEFAULT_NETWORK;
}

const browserStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const browserSearch = () => { try { return globalThis.location?.search ?? ''; } catch { return ''; } };

let active = null;
/** The page's network (read once per page load; see the top of this file). */
export function activeNetwork() {
  if (!active) active = NETWORKS[readNetworkId({ storage: browserStorage(), search: browserSearch() })];
  return active;
}

/** Remembers `id` in this browser and (by default) reloads the page so everything on it follows. */
export function setNetwork(id, { storage = browserStorage(), reload = true } = {}) {
  if (!isNetworkId(id)) throw new Error(`unknown network ${id}`);
  try { storage?.setItem(NETWORK_KEY, id); } catch { /* not remembered: still switch this page */ }
  if (reload) {
    try {
      const u = new URL(globalThis.location.href);
      if (u.searchParams.has('network')) { u.searchParams.set('network', id); globalThis.location.replace(u.href); return; }
      globalThis.location.reload();
    } catch { /* not in a browser */ }
  }
}

/** Another tab or frame of this site switched the network: reload, so this page never mixes the two. */
export function watchNetwork(win = globalThis) {
  try {
    win.addEventListener('storage', (e) => {
      if (e.key === NETWORK_KEY && isNetworkId(e.newValue) && e.newValue !== activeNetwork().id) win.location.reload();
    });
  } catch { /* not in a browser */ }
}

/** Does `feature` exist on `net`? (Unknown features: no.) */
export const hasFeature = (net, feature) => net?.features?.[feature] === true;

/** `net`'s contract addresses: mainnet's own list; on the testnet, the app's deployment files (`testnet`). */
export const contractsOf = (net, testnet = {}) => (net.contracts ? { ...net.contracts } : { ...(testnet ?? {}) });

/** A per-network localStorage key: the testnet keeps the key it always had, mainnet gets its own. */
export const netKey = (net, base) => (net.testnet ? base : `${base}:${net.id}`);

/** wallet_addEthereumChain parameters (EIP-3085) for `net`, with `rpc` (default: the network's public RPC). */
export function addChainParams(net, rpc = net.rpc) {
  if (!rpc) return null;
  return {
    chainId: net.chainIdHex,
    chainName: net.chainName,
    nativeCurrency: { name: 'ZETAPHY', symbol: net.symbol, decimals: net.decimals },
    rpcUrls: [rpc],
    ...(net.explorer ? { blockExplorerUrls: [net.explorer] } : {}),
  };
}

/** Links to the explorer site (its own origin: it starts on mainnet) open on this page's network (?network=<id>). */
export function linkExplorer(doc, net = activeNetwork(), host = 'explorer.sawasdeecoin.com') {
  for (const a of doc.querySelectorAll(`a[href^="https://${host}/"]`)) {
    try { const u = new URL(a.getAttribute('href')); u.searchParams.set('network', net.id); a.setAttribute('href', u.href); } catch { /* left as is */ }
  }
}

/** The mainnet notice link in the reader's language (Thai has its own). */
export const noticeUrl = (net, lang) => (lang === 'th' ? net.noticeTh : net.notice) ?? null;

// ------------------------------------------------------------------ words (8 languages)
// `risk` is the mainnet notice's own sentence (docs/ZETAPHY-MAINNET-NOTICE*.md). {feature} is a FEATURE_NAME.
export const NET_TEXT = {
  en: {
    network: 'Network', mainnet: 'Mainnet', testnet: 'Testnet', badgeMainnet: 'ZETAPHY mainnet', badgeTestnet: 'ZETAPHY testnet',
    switchTip: 'The network this site uses. Remembered in this browser.',
    risk: 'ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not yet completed an independent external audit. Use it only with amounts you can afford to lose.',
    notice: 'Mainnet notice',
    testnetNote: 'Testnet: coins have no value and the contracts are not audited yet. Do not use real money.',
    gateTitle: 'Testnet only for now',
    gateBody: '{feature} is not on ZETAPHY mainnet yet: its contracts are deployed on the testnet only. Switch to the testnet to try it (test coins have no value).',
    gateSwitch: 'Switch to testnet',
    wrongChain: 'Switch your wallet to {net} (chain {id}).',
  },
  th: {
    network: 'เครือข่าย', mainnet: 'Mainnet', testnet: 'Testnet', badgeMainnet: 'ZETAPHY mainnet', badgeTestnet: 'ZETAPHY testnet',
    switchTip: 'เครือข่ายที่เว็บนี้ใช้ ระบบจะจำไว้ในเบราว์เซอร์นี้',
    risk: 'ขณะนี้ ZETAPHY mainnet ทำงานบน validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ (audit) จากภายนอกที่เป็นอิสระ โปรดใช้เฉพาะจำนวนที่ยอมเสียได้',
    notice: 'ประกาศ mainnet',
    testnetNote: 'Testnet: เหรียญไม่มีมูลค่า สัญญายังไม่ผ่านการตรวจสอบความปลอดภัย (audit) ห้ามใช้เงินจริง',
    gateTitle: 'ตอนนี้ใช้ได้เฉพาะบน testnet',
    gateBody: '{feature} ยังไม่มีบน ZETAPHY mainnet เพราะสัญญายัง deploy ไว้บน testnet เท่านั้น สลับไป testnet เพื่อลองใช้ได้ (เหรียญทดลองไม่มีมูลค่า)',
    gateSwitch: 'สลับไป testnet',
    wrongChain: 'เปลี่ยนกระเป๋าไปที่ {net} (chain {id})',
  },
  zh: {
    network: '网络', mainnet: '主网', testnet: '测试网', badgeMainnet: 'ZETAPHY 主网', badgeTestnet: 'ZETAPHY 测试网',
    switchTip: '本站使用的网络。保存在此浏览器中。',
    risk: 'ZETAPHY 主网目前仅由 ZETAPHY 项目运营的一个验证者运行，其代码尚未完成独立的外部审计。请只投入您能承受损失的金额。',
    notice: '主网公告',
    testnetNote: '测试网：代币没有价值，合约尚未经过审计。请勿使用真实资金。',
    gateTitle: '目前仅限测试网',
    gateBody: '{feature}尚未上线 ZETAPHY 主网：其合约目前只部署在测试网上。切换到测试网即可试用（测试币没有价值）。',
    gateSwitch: '切换到测试网',
    wrongChain: '请将钱包切换到 {net}（chain {id}）。',
  },
  es: {
    network: 'Red', mainnet: 'Mainnet', testnet: 'Testnet', badgeMainnet: 'Mainnet de ZETAPHY', badgeTestnet: 'Testnet de ZETAPHY',
    switchTip: 'La red que usa este sitio. Se recuerda en este navegador.',
    risk: 'La mainnet de ZETAPHY funciona actualmente con un solo validador operado por el proyecto ZETAPHY, y su código aún no ha completado una auditoría externa independiente. Úsala solo con cantidades que puedas permitirte perder.',
    notice: 'Aviso de la mainnet',
    testnetNote: 'Testnet: las monedas no tienen valor y los contratos aún no están auditados. No uses dinero real.',
    gateTitle: 'Por ahora solo en la testnet',
    gateBody: '{feature} aún no está en la mainnet de ZETAPHY: sus contratos solo están desplegados en la testnet. Cambia a la testnet para probarlo (las monedas de prueba no tienen valor).',
    gateSwitch: 'Cambiar a la testnet',
    wrongChain: 'Cambia tu billetera a {net} (cadena {id}).',
  },
  ko: {
    network: '네트워크', mainnet: '메인넷', testnet: '테스트넷', badgeMainnet: 'ZETAPHY 메인넷', badgeTestnet: 'ZETAPHY 테스트넷',
    switchTip: '이 사이트가 사용하는 네트워크입니다. 이 브라우저에 저장됩니다.',
    risk: 'ZETAPHY 메인넷은 현재 ZETAPHY 프로젝트가 운영하는 단일 검증인으로 운영되며, 코드는 아직 독립적인 외부 감사를 마치지 않았습니다. 잃어도 괜찮은 금액으로만 사용하세요.',
    notice: '메인넷 공지',
    testnetNote: '테스트넷: 코인은 가치가 없으며 컨트랙트는 아직 감사를 받지 않았습니다. 실제 돈을 사용하지 마세요.',
    gateTitle: '지금은 테스트넷 전용',
    gateBody: '{feature}은(는) 아직 ZETAPHY 메인넷에 없습니다: 컨트랙트가 테스트넷에만 배포되어 있습니다. 테스트넷으로 전환해 사용해 보세요(테스트 코인은 가치가 없습니다).',
    gateSwitch: '테스트넷으로 전환',
    wrongChain: '지갑을 {net}(체인 {id})으로 전환하세요.',
  },
  ja: {
    network: 'ネットワーク', mainnet: 'メインネット', testnet: 'テストネット', badgeMainnet: 'ZETAPHY メインネット', badgeTestnet: 'ZETAPHY テストネット',
    switchTip: 'このサイトが使うネットワークです。このブラウザーに保存されます。',
    risk: 'ZETAPHY メインネットは現在、ZETAPHY プロジェクトが運用する 1 つのバリデーターだけで動いており、コードは独立した外部監査をまだ完了していません。失っても構わない金額だけで使ってください。',
    notice: 'メインネットのお知らせ',
    testnetNote: 'テストネット: コインに価値はなく、コントラクトはまだ監査を受けていません。実際のお金は使わないでください。',
    gateTitle: '現在はテストネットのみ',
    gateBody: '{feature}はまだ ZETAPHY メインネットにありません: コントラクトはテストネットにだけデプロイされています。テストネットに切り替えると試せます（テスト用コインに価値はありません）。',
    gateSwitch: 'テストネットに切り替える',
    wrongChain: 'ウォレットを {net}（チェーン {id}）に切り替えてください。',
  },
  ru: {
    network: 'Сеть', mainnet: 'Мейннет', testnet: 'Тестнет', badgeMainnet: 'Мейннет ZETAPHY', badgeTestnet: 'Тестнет ZETAPHY',
    switchTip: 'Сеть, которую использует этот сайт. Запоминается в этом браузере.',
    risk: 'Сейчас мейннет ZETAPHY работает на одном валидаторе, которым управляет проект ZETAPHY, и его код ещё не прошёл независимый внешний аудит. Используйте его только с суммами, потерю которых можете себе позволить.',
    notice: 'Уведомление о мейннете',
    testnetNote: 'Тестнет: монеты ничего не стоят, контракты ещё не прошли аудит. Не используйте реальные деньги.',
    gateTitle: 'Пока только в тестнете',
    gateBody: '{feature}: этого ещё нет в мейннете ZETAPHY, контракты развёрнуты только в тестнете. Переключитесь на тестнет, чтобы попробовать (тестовые монеты ничего не стоят).',
    gateSwitch: 'Переключиться на тестнет',
    wrongChain: 'Переключите кошелёк на {net} (сеть {id}).',
  },
  vi: {
    network: 'Mạng', mainnet: 'Mainnet', testnet: 'Testnet', badgeMainnet: 'Mainnet ZETAPHY', badgeTestnet: 'Testnet ZETAPHY',
    switchTip: 'Mạng mà trang này dùng. Được ghi nhớ trong trình duyệt này.',
    risk: 'Mainnet ZETAPHY hiện chạy trên một validator duy nhất do dự án ZETAPHY vận hành, và mã nguồn chưa hoàn tất kiểm toán độc lập từ bên ngoài. Chỉ dùng với số tiền bạn có thể chấp nhận mất.',
    notice: 'Thông báo mainnet',
    testnetNote: 'Testnet: coin không có giá trị và hợp đồng chưa được kiểm toán. Đừng dùng tiền thật.',
    gateTitle: 'Hiện chỉ có trên testnet',
    gateBody: '{feature} chưa có trên mainnet ZETAPHY: hợp đồng mới chỉ được triển khai trên testnet. Hãy chuyển sang testnet để dùng thử (coin thử nghiệm không có giá trị).',
    gateSwitch: 'Chuyển sang testnet',
    wrongChain: 'Hãy chuyển ví sang {net} (chuỗi {id}).',
  },
};

/** What each testnet-only feature is called in the "testnet only for now" box. */
export const FEATURE_NAME = {
  en: { nft: 'The NFT marketplace', dlmm: 'DLMM pools', bridge: 'ZETAPHY Saphan (the bridge)', faucet: 'The faucet', mining: 'Browser mining and useful-work payouts', usefulWork: 'Useful work', testTokens: 'Test tokens', stableGateway: 'The stable gateway', rewardVault: 'The reward vault', computeMarket: 'The compute market', identity: 'Neuro identity', quantumWallet: 'Quantum-safe wallets', airdrop: 'The airdrop', agents: 'AI agents', offline: 'Offline trading', audit: 'The audit network', aiMap: 'The AI map', immune: 'The immune network', forecasts: 'Risk forecasts', federated: 'Federated learning rounds', validators: 'Joining as a validator', other: 'This feature' },
  th: { nft: 'ตลาด NFT', dlmm: 'พูล DLMM', bridge: 'ZETAPHY Saphan (สะพานข้ามเชน)', faucet: 'Faucet แจกเหรียญทดลอง', mining: 'การขุดบนเบราว์เซอร์และรางวัลงานที่มีประโยชน์', usefulWork: 'งานที่มีประโยชน์ (useful work)', testTokens: 'โทเคนทดลอง', stableGateway: 'Stable gateway', rewardVault: 'คลังรางวัล', computeMarket: 'ตลาดพลังประมวลผล', identity: 'ตัวตน Neuro', quantumWallet: 'กระเป๋าต้านควอนตัม', airdrop: 'Airdrop', agents: 'AI agent', offline: 'การซื้อขายแบบออฟไลน์', audit: 'เครือข่ายตรวจสอบโค้ด', aiMap: 'แผนที่ AI', immune: 'เครือข่ายภูมิคุ้มกัน', forecasts: 'พยากรณ์ความเสี่ยง', federated: 'รอบการเรียนรู้แบบ federated', validators: 'การเข้าร่วมเป็น validator', other: 'ฟีเจอร์นี้' },
  zh: { nft: 'NFT 市场', dlmm: 'DLMM 池', bridge: 'ZETAPHY Saphan（跨链桥）', faucet: '水龙头', mining: '浏览器挖矿和有用工作奖励', usefulWork: '有用工作', testTokens: '测试代币', stableGateway: '稳定币网关', rewardVault: '奖励金库', computeMarket: '算力市场', identity: 'Neuro 身份', quantumWallet: '抗量子钱包', airdrop: '空投', agents: 'AI 代理', offline: '离线交易', audit: '审计网络', aiMap: 'AI 地图', immune: '免疫网络', forecasts: '风险预测', federated: '联邦学习轮次', validators: '加入成为验证者', other: '此功能' },
  es: { nft: 'El mercado de NFT', dlmm: 'Los pools DLMM', bridge: 'ZETAPHY Saphan (el puente)', faucet: 'El faucet', mining: 'La minería en el navegador y los pagos por trabajo útil', usefulWork: 'El trabajo útil', testTokens: 'Los tokens de prueba', stableGateway: 'La pasarela de stablecoins', rewardVault: 'La bóveda de recompensas', computeMarket: 'El mercado de cómputo', identity: 'La identidad Neuro', quantumWallet: 'Las billeteras resistentes a la cuántica', airdrop: 'El airdrop', agents: 'Los agentes de IA', offline: 'El comercio sin conexión', audit: 'La red de auditoría', aiMap: 'El mapa de IA', immune: 'La red inmunitaria', forecasts: 'Los pronósticos de riesgo', federated: 'Las rondas de aprendizaje federado', validators: 'Unirse como validador', other: 'Esta función' },
  ko: { nft: 'NFT 마켓', dlmm: 'DLMM 풀', bridge: 'ZETAPHY Saphan(브리지)', faucet: '파우셋', mining: '브라우저 채굴과 유용한 작업 보상', usefulWork: '유용한 작업', testTokens: '테스트 토큰', stableGateway: '스테이블 게이트웨이', rewardVault: '보상 금고', computeMarket: '컴퓨팅 마켓', identity: 'Neuro 신원', quantumWallet: '양자 내성 지갑', airdrop: '에어드롭', agents: 'AI 에이전트', offline: '오프라인 거래', audit: '감사 네트워크', aiMap: 'AI 지도', immune: '면역 네트워크', forecasts: '위험 예측', federated: '연합 학습 라운드', validators: '검증인으로 참여하기', other: '이 기능' },
  ja: { nft: 'NFT マーケット', dlmm: 'DLMM プール', bridge: 'ZETAPHY Saphan（ブリッジ）', faucet: 'フォーセット', mining: 'ブラウザーマイニングと有用な仕事の報酬', usefulWork: '有用な仕事', testTokens: 'テスト用トークン', stableGateway: 'ステーブルゲートウェイ', rewardVault: '報酬ボールト', computeMarket: '計算市場', identity: 'Neuro アイデンティティ', quantumWallet: '耐量子ウォレット', airdrop: 'エアドロップ', agents: 'AI エージェント', offline: 'オフライン取引', audit: '監査ネットワーク', aiMap: 'AI マップ', immune: '免疫ネットワーク', forecasts: 'リスク予測', federated: '連合学習ラウンド', validators: 'バリデーターとしての参加', other: 'この機能' },
  ru: { nft: 'NFT-маркетплейс', dlmm: 'Пулы DLMM', bridge: 'ZETAPHY Saphan (мост)', faucet: 'Кран', mining: 'Майнинг в браузере и выплаты за полезную работу', usefulWork: 'Полезная работа', testTokens: 'Тестовые токены', stableGateway: 'Шлюз стейблкоинов', rewardVault: 'Хранилище наград', computeMarket: 'Рынок вычислений', identity: 'Личность Neuro', quantumWallet: 'Квантово-устойчивые кошельки', airdrop: 'Аирдроп', agents: 'ИИ-агенты', offline: 'Офлайн-торговля', audit: 'Сеть аудита', aiMap: 'Карта ИИ', immune: 'Иммунная сеть', forecasts: 'Прогнозы рисков', federated: 'Раунды федеративного обучения', validators: 'Подключение валидатором', other: 'Эта функция' },
  vi: { nft: 'Chợ NFT', dlmm: 'Pool DLMM', bridge: 'ZETAPHY Saphan (cầu nối)', faucet: 'Faucet', mining: 'Đào trên trình duyệt và phần thưởng công việc hữu ích', usefulWork: 'Công việc hữu ích', testTokens: 'Token thử nghiệm', stableGateway: 'Cổng stablecoin', rewardVault: 'Kho phần thưởng', computeMarket: 'Chợ sức tính toán', identity: 'Danh tính Neuro', quantumWallet: 'Ví kháng lượng tử', airdrop: 'Airdrop', agents: 'Tác tử AI', offline: 'Giao dịch ngoại tuyến', audit: 'Mạng kiểm toán', aiMap: 'Bản đồ AI', immune: 'Mạng miễn dịch', forecasts: 'Dự báo rủi ro', federated: 'Các vòng học liên kết', validators: 'Tham gia làm validator', other: 'Tính năng này' },
};

/** The words in `lang` (English for a missing language or key). */
export function netText(lang) {
  const t = { ...NET_TEXT.en, ...(NET_TEXT[lang] ?? {}) };
  const names = { ...FEATURE_NAME.en, ...(FEATURE_NAME[lang] ?? {}) };
  return { ...t, feature: (f) => names[f] ?? names.other };
}

/** "Switch your wallet to ZETAPHY (chain 3659)." for the page's network, in `lang`. */
export const wrongChainText = (net, lang) => netText(lang).wrongChain.replace('{net}', net.chainName).replace('{id}', String(net.chainId));

// ------------------------------------------------------------------ the badge, the switch and the "testnet only" box
// Plain DOM, every string set as text. Styles go through element.style (allowed by the sites' CSP style-src 'self').
const make = (doc, tag, props = {}, ...kids) => {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'text') e.textContent = v; else if (k === 'style') Object.assign(e.style, v); else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};

/** The network <select> (Mainnet / Testnet); changing it remembers the choice and reloads. */
export function networkSelect(doc, { lang = 'en', net = activeNetwork(), onSwitch = (id) => setNetwork(id) } = {}) {
  const t = netText(lang);
  const sel = make(doc, 'select', { class: 'zn-net-select', 'aria-label': t.network, title: t.switchTip, 'data-network': net.id },
    make(doc, 'option', { value: 'mainnet', text: t.mainnet }), make(doc, 'option', { value: 'testnet', text: t.testnet }));
  sel.value = net.id;
  sel.addEventListener('change', () => { if (sel.value !== net.id) onSwitch(sel.value); });
  return sel;
}

/**
 * The network badge: on mainnet "ZETAPHY mainnet", the risk sentence and the notice link; on the testnet the app's
 * own testnet words (`testnetText`, else testnetNote). With the switch unless `select: false`.
 */
export function networkBadge(doc, { lang = 'en', net = activeNetwork(), testnetText = null, select = true, onSwitch } = {}) {
  const t = netText(lang);
  const box = make(doc, 'div', { class: `zn-net zn-net-${net.id}`, role: 'note', 'data-network': net.id,
    style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', padding: '6px 12px', fontSize: '13px', lineHeight: '1.4',
      borderRadius: '8px', border: `1px solid ${net.testnet ? 'rgba(234,179,8,.55)' : 'rgba(34,197,94,.55)'}`, background: net.testnet ? 'rgba(234,179,8,.10)' : 'rgba(34,197,94,.08)' } });
  box.append(make(doc, 'b', { class: 'zn-net-name', text: net.testnet ? t.badgeTestnet : t.badgeMainnet }));
  if (net.testnet) box.append(make(doc, 'span', { class: 'zn-net-text', text: testnetText ?? t.testnetNote, style: { flex: '1 1 240px' } }));
  else {
    box.append(make(doc, 'span', { class: 'zn-net-text zn-net-risk', text: t.risk, style: { flex: '1 1 240px' } }));
    const href = noticeUrl(net, lang);
    if (href) box.append(make(doc, 'a', { class: 'zn-net-notice', href, target: '_blank', rel: 'noopener noreferrer', text: t.notice }));
  }
  if (select) box.append(networkSelect(doc, { lang, net, ...(onSwitch ? { onSwitch } : {}) }));
  return box;
}

/** "Testnet only for now": what is missing on this network, and a one-click switch to the testnet. */
export function testnetOnlyBox(doc, { lang = 'en', feature = 'other', onSwitch = (id) => setNetwork(id) } = {}) {
  const t = netText(lang);
  const btn = make(doc, 'button', { type: 'button', class: 'zn-gate-switch btn', text: t.gateSwitch, onclick: () => onSwitch('testnet') });
  return make(doc, 'div', { class: 'zn-gate', role: 'status', 'data-feature': feature,
    style: { padding: '16px', margin: '12px 0', borderRadius: '10px', border: '1px solid rgba(234,179,8,.55)', background: 'rgba(234,179,8,.08)', lineHeight: '1.5' } },
  make(doc, 'h3', { class: 'zn-gate-title', text: t.gateTitle, style: { margin: '0 0 6px' } }),
  make(doc, 'p', { class: 'zn-gate-body', text: t.gateBody.replace('{feature}', t.feature(feature)), style: { margin: '0 0 10px' } }),
  btn);
}
