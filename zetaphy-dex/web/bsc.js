// The "BNB Chain" tab of the DEX page: swap ZTPHY <-> USDT on BNB Smart Chain through the project's own PancakeSwap v3
// pool (lib/bscswap.js). Reads BSC over its public RPC; signs only through the page's wallet, on chain 56, after:
// the router, the quoter and the pool are checked on-chain (same factory, the factory's pool for the pair is ours),
// a fresh quote, a minimum out from the slippage, a dry run, and the wallet-safety summary. Exact approvals only.
// Every text goes in with textContent.
import * as B from './lib/bscswap.js';
import { parseUnits, formatUnits } from './lib/abi.js';

export const TEXT = {
  en: { title: 'ZTPHY on BNB Chain', lede: 'Trade ZTPHY and USDT on BNB Smart Chain through the ZTPHY/USDT pool on PancakeSwap v3 (1% fee). This is ZTPHY bridged by Saphan: {addr}.', thin: 'The pool is small: a $10 buy moves the price by tens of percent. Trade only what you can lose.', dir: 'Direction', pay: 'You pay', get: 'You get about {out} {sym} (at least {min} after {slip}% slippage)', price: 'Price: 1 ZTPHY = {p} USDT · this trade moves it {i}%', bigImpact: 'This trade moves the price more than 10%.', slippage: 'Slippage', balance: 'Balance: {b} {sym}', connect: 'Connect a wallet', approve: 'Approve {amt} {sym}', swap: 'Swap', switching: 'Switching your wallet to BNB Smart Chain…', checking: 'Checking the pool on BNB Chain…', unsafe: 'Refused: the PancakeSwap contracts or the pool on BNB Chain are not the expected ones ({why}).', noLiquidity: 'No quote: the pool cannot fill this amount.', badAmount: 'Enter an amount', low: 'Not enough {sym}', confirm: 'Confirm in your wallet…', waiting: 'Waiting for {hash}…', done: 'Done: {hash}', failed: 'Failed: {msg}', chainChanged: 'Your wallet is not on BNB Smart Chain ({id}); nothing was sent.', pool: 'The pool on BscScan', gas: 'Gas is paid in BNB.' },
  th: { title: 'ZTPHY บน BNB Chain', lede: 'ซื้อขาย ZTPHY กับ USDT บน BNB Smart Chain ผ่าน pool ZTPHY/USDT บน PancakeSwap v3 (ค่าธรรมเนียม 1%) เหรียญนี้คือ ZTPHY ที่ข้ามสะพานด้วย Saphan: {addr}', thin: 'pool ยังเล็ก ซื้อ $10 ราคาขยับหลายสิบเปอร์เซ็นต์ ซื้อขายเฉพาะจำนวนที่เสียได้', dir: 'ทิศทาง', pay: 'จ่าย', get: 'ได้ประมาณ {out} {sym} (อย่างน้อย {min} หลังเผื่อ slippage {slip}%)', price: 'ราคา: 1 ZTPHY = {p} USDT · รายการนี้ทำให้ราคาขยับ {i}%', bigImpact: 'รายการนี้ทำให้ราคาขยับเกิน 10%', slippage: 'Slippage', balance: 'ยอดคงเหลือ: {b} {sym}', connect: 'เชื่อมต่อกระเป๋า', approve: 'อนุมัติ {amt} {sym}', swap: 'แลกเปลี่ยน', switching: 'กำลังสลับกระเป๋าไป BNB Smart Chain…', checking: 'กำลังตรวจ pool บน BNB Chain…', unsafe: 'ปฏิเสธ: สัญญา PancakeSwap หรือ pool บน BNB Chain ไม่ใช่ตัวที่คาดไว้ ({why})', noLiquidity: 'ไม่มีราคา: pool รับจำนวนนี้ไม่ได้', badAmount: 'ใส่จำนวน', low: '{sym} ไม่พอ', confirm: 'ยืนยันในกระเป๋า…', waiting: 'กำลังรอ {hash}…', done: 'สำเร็จ: {hash}', failed: 'ไม่สำเร็จ: {msg}', chainChanged: 'กระเป๋าไม่ได้อยู่บน BNB Smart Chain ({id}) ยังไม่มีอะไรถูกส่ง', pool: 'ดู pool บน BscScan', gas: 'ค่าแก๊สจ่ายเป็น BNB' },
  zh: { title: 'BNB Chain 上的 ZTPHY', lede: '通过 PancakeSwap v3 上的 ZTPHY/USDT 资金池（1% 手续费）在 BNB Smart Chain 上交易 ZTPHY 和 USDT。这是经 Saphan 跨链的 ZTPHY：{addr}。', thin: '资金池很小：买入 10 美元就会使价格变动数十个百分点。只交易您能承受损失的金额。', dir: '方向', pay: '支付', get: '约得到 {out} {sym}（按 {slip}% 滑点至少 {min}）', price: '价格：1 ZTPHY = {p} USDT · 本笔交易使其变动 {i}%', bigImpact: '本笔交易使价格变动超过 10%。', slippage: '滑点', balance: '余额：{b} {sym}', connect: '连接钱包', approve: '授权 {amt} {sym}', swap: '兑换', switching: '正在将钱包切换到 BNB Smart Chain…', checking: '正在检查 BNB Chain 上的资金池…', unsafe: '已拒绝：BNB Chain 上的 PancakeSwap 合约或资金池不是预期的（{why}）。', noLiquidity: '无报价：资金池无法成交此数量。', badAmount: '请输入数量', low: '{sym} 不足', confirm: '请在钱包中确认…', waiting: '等待 {hash}…', done: '完成：{hash}', failed: '失败：{msg}', chainChanged: '您的钱包不在 BNB Smart Chain 上（{id}），未发送任何内容。', pool: '在 BscScan 上查看资金池', gas: 'Gas 以 BNB 支付。' },
  es: { title: 'ZTPHY en BNB Chain', lede: 'Intercambia ZTPHY y USDT en BNB Smart Chain mediante el pool ZTPHY/USDT de PancakeSwap v3 (comisión del 1%). Es ZTPHY puenteado por Saphan: {addr}.', thin: 'El pool es pequeño: una compra de 10 $ mueve el precio decenas de puntos porcentuales. Opera solo lo que puedas perder.', dir: 'Dirección', pay: 'Pagas', get: 'Recibes unos {out} {sym} (al menos {min} con {slip}% de deslizamiento)', price: 'Precio: 1 ZTPHY = {p} USDT · esta operación lo mueve un {i}%', bigImpact: 'Esta operación mueve el precio más de un 10%.', slippage: 'Deslizamiento', balance: 'Saldo: {b} {sym}', connect: 'Conectar billetera', approve: 'Aprobar {amt} {sym}', swap: 'Intercambiar', switching: 'Cambiando tu billetera a BNB Smart Chain…', checking: 'Comprobando el pool en BNB Chain…', unsafe: 'Rechazado: los contratos de PancakeSwap o el pool en BNB Chain no son los esperados ({why}).', noLiquidity: 'Sin cotización: el pool no puede cubrir esta cantidad.', badAmount: 'Introduce una cantidad', low: 'No hay suficiente {sym}', confirm: 'Confirma en tu billetera…', waiting: 'Esperando {hash}…', done: 'Hecho: {hash}', failed: 'Falló: {msg}', chainChanged: 'Tu billetera no está en BNB Smart Chain ({id}); no se envió nada.', pool: 'El pool en BscScan', gas: 'El gas se paga en BNB.' },
  ko: { title: 'BNB Chain의 ZTPHY', lede: 'PancakeSwap v3의 ZTPHY/USDT 풀(수수료 1%)로 BNB Smart Chain에서 ZTPHY와 USDT를 거래합니다. Saphan으로 브리지된 ZTPHY입니다: {addr}.', thin: '풀이 작습니다: 10달러만 사도 가격이 수십 퍼센트 움직입니다. 잃어도 되는 만큼만 거래하세요.', dir: '방향', pay: '지불', get: '약 {out} {sym} 받음 ({slip}% 슬리피지 후 최소 {min})', price: '가격: 1 ZTPHY = {p} USDT · 이 거래로 {i}% 움직임', bigImpact: '이 거래는 가격을 10% 넘게 움직입니다.', slippage: '슬리피지', balance: '잔액: {b} {sym}', connect: '지갑 연결', approve: '{amt} {sym} 승인', swap: '스왑', switching: '지갑을 BNB Smart Chain으로 전환하는 중…', checking: 'BNB Chain의 풀을 확인하는 중…', unsafe: '거부됨: BNB Chain의 PancakeSwap 컨트랙트나 풀이 예상과 다릅니다({why}).', noLiquidity: '견적 없음: 풀이 이 수량을 채울 수 없습니다.', badAmount: '수량을 입력하세요', low: '{sym} 부족', confirm: '지갑에서 확인하세요…', waiting: '{hash} 대기 중…', done: '완료: {hash}', failed: '실패: {msg}', chainChanged: '지갑이 BNB Smart Chain에 있지 않습니다({id}). 아무것도 보내지 않았습니다.', pool: 'BscScan에서 풀 보기', gas: '가스는 BNB로 냅니다.' },
  ja: { title: 'BNB Chain の ZTPHY', lede: 'PancakeSwap v3 の ZTPHY/USDT プール（手数料 1%）で BNB Smart Chain 上の ZTPHY と USDT を交換します。Saphan でブリッジされた ZTPHY です：{addr}。', thin: 'プールは小さく、10 ドルの購入で価格が数十パーセント動きます。失ってもよい額だけ取引してください。', dir: '方向', pay: '支払い', get: '約 {out} {sym} を受け取り（スリッページ {slip}% で最低 {min}）', price: '価格：1 ZTPHY = {p} USDT · この取引で {i}% 動きます', bigImpact: 'この取引は価格を 10% 超動かします。', slippage: 'スリッページ', balance: '残高：{b} {sym}', connect: 'ウォレットを接続', approve: '{amt} {sym} を承認', swap: '交換', switching: 'ウォレットを BNB Smart Chain に切り替え中…', checking: 'BNB Chain のプールを確認中…', unsafe: '拒否：BNB Chain の PancakeSwap コントラクトまたはプールが想定と異なります（{why}）。', noLiquidity: '見積もりなし：プールがこの数量を約定できません。', badAmount: '数量を入力してください', low: '{sym} が足りません', confirm: 'ウォレットで確認してください…', waiting: '{hash} を待っています…', done: '完了：{hash}', failed: '失敗：{msg}', chainChanged: 'ウォレットが BNB Smart Chain 上にありません（{id}）。何も送信していません。', pool: 'BscScan でプールを見る', gas: 'ガスは BNB で支払います。' },
  ru: { title: 'ZTPHY в BNB Chain', lede: 'Обмен ZTPHY и USDT в BNB Smart Chain через пул ZTPHY/USDT на PancakeSwap v3 (комиссия 1%). Это ZTPHY, перенесённый мостом Saphan: {addr}.', thin: 'Пул маленький: покупка на 10 $ сдвигает цену на десятки процентов. Торгуйте только тем, что готовы потерять.', dir: 'Направление', pay: 'Вы платите', get: 'Вы получите около {out} {sym} (не меньше {min} при проскальзывании {slip}%)', price: 'Цена: 1 ZTPHY = {p} USDT · эта сделка сдвинет её на {i}%', bigImpact: 'Эта сделка сдвинет цену больше чем на 10%.', slippage: 'Проскальзывание', balance: 'Баланс: {b} {sym}', connect: 'Подключить кошелёк', approve: 'Одобрить {amt} {sym}', swap: 'Обменять', switching: 'Переключаем кошелёк на BNB Smart Chain…', checking: 'Проверяем пул в BNB Chain…', unsafe: 'Отказано: контракты PancakeSwap или пул в BNB Chain не те, что ожидались ({why}).', noLiquidity: 'Нет котировки: пул не может исполнить эту сумму.', badAmount: 'Введите сумму', low: 'Недостаточно {sym}', confirm: 'Подтвердите в кошельке…', waiting: 'Ожидание {hash}…', done: 'Готово: {hash}', failed: 'Ошибка: {msg}', chainChanged: 'Кошелёк не в сети BNB Smart Chain ({id}); ничего не отправлено.', pool: 'Пул на BscScan', gas: 'Газ оплачивается в BNB.' },
  vi: { title: 'ZTPHY trên BNB Chain', lede: 'Giao dịch ZTPHY và USDT trên BNB Smart Chain qua pool ZTPHY/USDT của PancakeSwap v3 (phí 1%). Đây là ZTPHY được bắc cầu bởi Saphan: {addr}.', thin: 'Pool còn nhỏ: mua 10 $ làm giá dịch chuyển hàng chục phần trăm. Chỉ giao dịch số tiền bạn có thể mất.', dir: 'Chiều', pay: 'Bạn trả', get: 'Bạn nhận khoảng {out} {sym} (ít nhất {min} với trượt giá {slip}%)', price: 'Giá: 1 ZTPHY = {p} USDT · giao dịch này làm giá dịch {i}%', bigImpact: 'Giao dịch này làm giá dịch chuyển hơn 10%.', slippage: 'Trượt giá', balance: 'Số dư: {b} {sym}', connect: 'Kết nối ví', approve: 'Phê duyệt {amt} {sym}', swap: 'Hoán đổi', switching: 'Đang chuyển ví sang BNB Smart Chain…', checking: 'Đang kiểm tra pool trên BNB Chain…', unsafe: 'Từ chối: hợp đồng PancakeSwap hoặc pool trên BNB Chain không đúng như mong đợi ({why}).', noLiquidity: 'Không có báo giá: pool không khớp được số lượng này.', badAmount: 'Nhập số lượng', low: 'Không đủ {sym}', confirm: 'Xác nhận trong ví…', waiting: 'Đang chờ {hash}…', done: 'Xong: {hash}', failed: 'Thất bại: {msg}', chainChanged: 'Ví không ở trên BNB Smart Chain ({id}); chưa gửi gì.', pool: 'Pool trên BscScan', gas: 'Phí gas trả bằng BNB.' },
};

const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** The tab. ctx: { state, $, el, setStatus, errorText, openWallets, confirm(o) -> data|null, fetchFn } */
export function createBscTab(ctx) {
  const { state, $, el } = ctx;
  const fetchFn = ctx.fetchFn ?? ((...a) => fetch(...a));
  const tt = (k, v = {}) => (TEXT[state.lang]?.[k] ?? TEXT.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));
  let built = null, verified = null, seq = 0, last = null;

  async function rpc(method, params) {
    let err;
    for (const url of B.BSC.rpc) {
      try {
        const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message ?? 'rpc error'), { data: j.error.data });
        return j.result;
      } catch (e) { err = e; if (e.data !== undefined) throw e; }
    }
    throw err;
  }
  const call = (to, data, from) => rpc('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']);

  /** The router and quoter name PancakeSwap's factory, and the factory's pool for the pair is ours. */
  async function verify() {
    if (verified) return verified;
    const why = [];
    for (const [k, a] of [['router', B.PANCAKE.swapRouter], ['quoter', B.PANCAKE.quoterV2], ['pool', B.PANCAKE.pool], ['ZTPHY', B.ZTPHY.address]]) {
      const code = await rpc('eth_getCode', [a, 'latest']);
      if (!code || code === '0x') why.push(`${k}: no code`);
    }
    for (const [k, a] of [['router', B.PANCAKE.swapRouter], ['quoter', B.PANCAKE.quoterV2]]) {
      const f = B.addressOf(await call(a, B.SELECTORS.factory).catch(() => '0x'));
      if (f.toLowerCase() !== B.PANCAKE.factory.toLowerCase()) why.push(`${k}.factory() = ${f}`);
    }
    const pool = B.addressOf(await call(B.PANCAKE.factory, B.getPoolCall()).catch(() => '0x'));
    if (pool.toLowerCase() !== B.PANCAKE.pool.toLowerCase()) why.push(`factory pool = ${pool}`);
    const r = { ok: why.length === 0, why: why.join('; ') };
    if (r.ok) verified = r; // only a pass is remembered; a failure is checked again next time
    return r;
  }

  function build() {
    const root = $('bsc-root');
    const opt = (v, text) => el('option', { value: v, text });
    root.replaceChildren(el('div', { class: 'card' },
      el('h2', { text: tt('title') }),
      el('p', { class: 'hint', text: tt('lede', { addr: B.ZTPHY.address }) }),
      el('p', { class: 'warn', role: 'note', text: tt('thin') }),
      el('label', { text: tt('dir') }, el('select', { id: 'bsc-dir' }, opt('sell', 'ZTPHY → USDT'), opt('buy', 'USDT → ZTPHY'))),
      el('label', { text: tt('pay') }, el('input', { id: 'bsc-amount', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0.0' })),
      el('p', { class: 'hint', id: 'bsc-balance' }),
      el('label', { text: tt('slippage') }, el('select', { id: 'bsc-slip' }, opt('50', '0.5%'), opt('100', '1%'), opt('200', '2%'), opt('300', '3%'))),
      el('p', { class: 'hint', id: 'bsc-quote', 'aria-live': 'polite' }),
      el('p', { class: 'hint', id: 'bsc-price' }),
      el('p', { class: 'warn', id: 'bsc-impact', role: 'alert', hidden: true, text: tt('bigImpact') }),
      el('button', { type: 'button', class: 'primary', id: 'bsc-btn', disabled: true, text: tt('swap') }),
      el('p', { class: 'status', id: 'bsc-status', role: 'status' }),
      el('p', { class: 'hint' }, el('a', { href: `${B.BSC.explorer}/address/${B.PANCAKE.pool}`, target: '_blank', rel: 'noopener noreferrer', text: tt('pool') }), ' · ', tt('gas'))));
    $('bsc-slip').value = '100';
    $('bsc-amount').addEventListener('input', () => update());
    $('bsc-dir').addEventListener('change', () => update());
    $('bsc-slip').addEventListener('change', () => update());
    $('bsc-btn').addEventListener('click', () => onClick().catch((e) => ctx.setStatus('bsc-status', tt('failed', { msg: ctx.errorText(e) }), 'err')));
    built = state.lang;
  }

  const tin = () => ($('bsc-dir').value === 'buy' ? B.USDT : B.ZTPHY);
  const fmt = (v) => formatUnits(v, 18, 6);

  async function update() {
    const my = ++seq, t = tin(), out = B.other(t), btn = $('bsc-btn');
    last = null; btn.disabled = true; $('bsc-impact').hidden = true;
    $('bsc-quote').textContent = ''; $('bsc-price').textContent = '';
    if (state.account) {
      const bal = B.word(await call(t.address, B.balanceCall(state.account)).catch(() => '0x0'));
      if (my !== seq) return;
      $('bsc-balance').textContent = tt('balance', { b: fmt(bal), sym: t.symbol });
    } else $('bsc-balance').textContent = '';
    let amount;
    try { amount = parseUnits(String($('bsc-amount').value || '').trim(), 18); } catch { amount = 0n; }
    if (!state.account) { btn.textContent = tt('connect'); btn.disabled = false; return; }
    if (amount <= 0n) { btn.textContent = tt('badAmount'); return; }
    const first = !verified; // the on-chain check runs once; a later refresh keeps the last transaction's status
    if (first) ctx.setStatus('bsc-status', tt('checking'));
    const v = await verify();
    if (my !== seq) return;
    if (!v.ok) { ctx.setStatus('bsc-status', tt('unsafe', { why: v.why }), 'err'); return; }
    if (first) ctx.setStatus('bsc-status', '');
    const slip = Number($('bsc-slip').value);
    let q, before;
    try {
      q = B.readQuote(await call(B.PANCAKE.quoterV2, B.quoteCall(t, amount)));
      const s0 = await call(B.PANCAKE.pool, '0x3850c7bd'); // slot0(): sqrtPriceX96 first
      before = B.word(s0);
    } catch { if (my === seq) ctx.setStatus('bsc-status', tt('noLiquidity'), 'err'); return; }
    if (my !== seq) return;
    const min = B.minOut(q.amountOut, slip), impact = B.impactBps(before, q.sqrtPriceX96After);
    $('bsc-quote').textContent = tt('get', { out: fmt(q.amountOut), sym: out.symbol, min: fmt(min), slip: slip / 100 });
    $('bsc-price').textContent = tt('price', { p: B.usdtPerZtphy(before).toFixed(7), i: (impact / 100).toFixed(1) });
    $('bsc-impact').hidden = impact <= 1000;
    const bal = B.word(await call(t.address, B.balanceCall(state.account)).catch(() => '0x0'));
    if (my !== seq) return;
    if (bal < amount) { btn.textContent = tt('low', { sym: t.symbol }); return; }
    const allowed = B.word(await call(t.address, B.allowanceCall(state.account, B.PANCAKE.swapRouter)).catch(() => '0x0'));
    if (my !== seq) return;
    last = { t, amount, min, approve: allowed < amount };
    btn.textContent = last.approve ? tt('approve', { amt: fmt(amount), sym: t.symbol }) : tt('swap');
    btn.disabled = false;
  }

  async function ensureBsc() {
    const p = state.wallet.provider;
    ctx.setStatus('bsc-status', tt('switching'));
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: B.BSC.chainIdHex }] }); } catch (e) {
      if (e?.code === 4001) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: B.BSC.chainIdHex, chainName: B.BSC.name, nativeCurrency: B.BSC.nativeCurrency, rpcUrls: [B.BSC.rpc[0]], blockExplorerUrls: [B.BSC.explorer] }] });
    }
  }

  async function send(to, data, token) {
    const p = state.wallet.provider, from = state.account;
    await ensureBsc();
    await call(to, data, from); // dry run on BSC: a revert is explained before the wallet shows anything
    const cid = Number(BigInt(await p.request({ method: 'eth_chainId' })));
    if (cid !== B.BSC.chainId) throw new Error(tt('chainChanged', { id: String(cid) }));
    const checked = await ctx.confirm({ network: `${B.BSC.name} (${B.BSC.chainId})`, from, to, toLabel: to === B.PANCAKE.swapRouter ? 'PancakeSwap v3 SwapRouter' : token.symbol, value: 0n, symbol: 'BNB', data, token, exact: true });
    if (checked == null) throw new Error('cancelled');
    ctx.setStatus('bsc-status', tt('confirm'));
    const hash = await p.request({ method: 'eth_sendTransaction', params: [{ from, to, data: checked, chainId: B.BSC.chainIdHex }] });
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('wallet returned no transaction hash');
    ctx.setStatus('bsc-status', tt('waiting', { hash: short(hash) }));
    for (let i = 0; i < 120; i++) {
      const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r) { if (r.status !== '0x1') throw new Error(`reverted ${short(hash)}`); ctx.setStatus('bsc-status', tt('done', { hash: short(hash) }), 'ok'); return hash; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    ctx.setStatus('bsc-status', tt('waiting', { hash: short(hash) }));
    return hash;
  }

  async function onClick() {
    if (!state.account) { ctx.openWallets(); return; }
    if (!last) return;
    const { t, amount, min } = last;
    $('bsc-btn').disabled = true;
    try {
      if (last.approve) await send(t.address, B.approveCall(B.PANCAKE.swapRouter, amount), t);
      else {
        // the minimum is the one shown to the user: a worse price since then makes the swap revert, never fill lower
        const dl = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
        await send(B.PANCAKE.swapRouter, B.swapCall(t, amount, min, state.account, dl), t);
      }
    } finally { await update(); }
  }

  return {
    async show() { if (built !== state.lang) build(); await update(); },
    refresh() { if (built) update(); },
  };
}
