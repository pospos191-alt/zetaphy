**English** | [ภาษาไทย](OUTREACH.th.md)

# ZETAPHY outreach: the push airdrop announcement, 30 days of posts, channels

BNB Chain round, ZTPHY on BSC, trackers and listings: [OUTREACH-BNB.md](OUTREACH-BNB.md).

This extends the [mainnet announcement kit](ZETAPHY-MAINNET-ANNOUNCE.md) (its 8-language launch posts, the round-1
post and the safety line stay there). Here: the post for the **push airdrop** (10 ZTPHY to each of 100,000 active
Ethereum addresses, [AIRDROP.md section 7](AIRDROP.md#7-push-airdrop-on-mainnet-owner-decision-2026-11-14)), a
30-day plan of one post a day, and the rules of each channel. The owner posts by hand; nothing here posts by itself.

The goal is that ZETAPHY becomes known **for what it really is**: every post states a fact anyone can check in the
repository or on the chain, and every post that mentions the coin keeps the risk sentence of the
[notice](ZETAPHY-MAINNET-NOTICE.md).

| | |
|---|---|
| Check page (link this in every airdrop post) | **https://app.sawasdeecoin.com/got-ztphy.html** |
| Site | https://app.sawasdeecoin.com |
| Notice | https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md |
| Code | https://github.com/pospos191-alt/zetaphy (source-available, BUSL-1.1; becomes GPL-2.0-or-later on 2030-10-24) |
| Chain | `zetaphy_3659-1`, EVM chain id 3659 (`0xe4b`), coin ZTPHY (18 decimals), RPC `https://129-221-199-191.sslip.io` |

**The risk sentence** (word for word; the check page shows it in all 8 languages, from `zetaphy-hub/network.js`):

> ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not yet
> completed an independent external audit. Use it only with amounts you can afford to lose.

## 0. Before the first airdrop post (check every box)

- [ ] `gov.sh airdrop` printed `airdrop done` and the checks of AIRDROP.md section 7 step 7 pass (no `.pending` file,
      5 random recipients hold 10 ZTPHY). **Do not post "the coins are in your wallet" before that.**
- [ ] The recipient list is published (AIRDROP.md section 7 step 9: `node tools/push-manifest.mjs ~/push.txt`, commit
      `zetaphy-hub/airdrop-push/`, merge). Open the check page: it shows "Airdrop list published: 100,000 addresses,
      sha256 …" with the sha256 `push-list` printed. Check 3 addresses from the list and 1 that is not on it.
- [ ] The check page opens on a phone, in English and Thai, and "Add ZETAPHY" works in MetaMask.
- [ ] The official accounts exist (section 3) and each one's bio links **only** to https://app.sawasdeecoin.com and
      the GitHub repository. Each account has the safety post (section 1.3) **pinned**.
- [ ] Paste the check page URL into the X, Telegram, LINE and Facebook composers once: the preview card shows the
      title "Did you get ZTPHY? Check any address" and the ZETAPHY image (`og.png`). If Facebook shows an old card, use
      its Sharing Debugger ("Scrape again").

## 1. The push airdrop announcement

Post it once on every official channel, the same day, after section 0. **Never** reply to it with a "claim" link, a
form or a contract address to approve: the coins are already there.

### 1.1 Short versions (X and Telegram; each under 280 characters as X counts them)

**English**
> 10 ZTPHY is now in 100,000 active Ethereum wallets: same address, on ZETAPHY mainnet (chain 3659).
> Check any address: https://app.sawasdeecoin.com/got-ztphy.html
> Nothing to claim, nothing to pay. We never DM you or ask for a seed phrase, key, signature or approval. Anyone who does is a scammer.

**ภาษาไทย**
> 10 ZTPHY เข้ากระเป๋า Ethereum ที่ใช้งานอยู่ 100,000 กระเป๋าแล้ว ที่อยู่เดิม บน ZETAPHY mainnet (chain 3659)
> ตรวจที่อยู่ใดก็ได้: https://app.sawasdeecoin.com/got-ztphy.html
> ไม่มีอะไรต้องเคลม ไม่มีอะไรต้องจ่าย เราไม่ทักแชต ไม่ขอ seed phrase, คีย์, ลายเซ็น หรือ approve ใครขอคือมิจฉาชีพ

**中文**
> 100,000 个活跃以太坊钱包已收到 10 ZTPHY：同一地址，在 ZETAPHY 主网（链 3659）。
> 查询任意地址：https://app.sawasdeecoin.com/got-ztphy.html
> 无需领取，无需付费。我们从不私信，从不索要助记词、私钥、签名或授权。索要者即骗子。

**Español**
> 10 ZTPHY ya están en 100.000 billeteras activas de Ethereum: misma dirección, mainnet ZETAPHY (cadena 3659).
> Consulta: https://app.sawasdeecoin.com/got-ztphy.html
> Nada que reclamar ni pagar. Nunca escribimos por DM ni pedimos frase semilla, clave, firma o aprobación. Quien lo pida es estafador.

**한국어**
> 활성 이더리움 지갑 100,000개에 10 ZTPHY가 들어갔습니다. 같은 주소, ZETAPHY 메인넷(체인 3659).
> 주소 확인: https://app.sawasdeecoin.com/got-ztphy.html
> 청구도 결제도 없습니다. DM, 시드 문구, 키, 서명, 승인을 절대 요구하지 않습니다. 요구하면 사기입니다.

**日本語**
> アクティブな Ethereum ウォレット 10 万件に 10 ZTPHY が届きました。同じアドレス、ZETAPHY メインネット（チェーン 3659）。
> 確認: https://app.sawasdeecoin.com/got-ztphy.html
> 請求も支払いも不要。DM、シードフレーズ、鍵、署名、承認は求めません。求める人は詐欺師です。

**Русский**
> 10 ZTPHY уже на 100 000 активных кошельков Ethereum: тот же адрес, в мейннете ZETAPHY (сеть 3659).
> Проверьте любой адрес: https://app.sawasdeecoin.com/got-ztphy.html
> Ничего не нужно забирать и платить. Мы не пишем в ЛС и не просим сид-фразу, ключ, подпись или approve. Кто просит — мошенник.

**Tiếng Việt**
> 10 ZTPHY đã vào 100.000 ví Ethereum đang hoạt động: cùng địa chỉ, mainnet ZETAPHY (chuỗi 3659).
> Kiểm tra: https://app.sawasdeecoin.com/got-ztphy.html
> Không cần nhận, không phải trả. Không nhắn riêng, không xin seed phrase, khóa, chữ ký hay approve. Ai xin là lừa đảo.

On X, add the risk sentence as the **first reply** of the post (it does not fit in 280 characters with the safety
lines), in the post's language: the `risk` texts of `zetaphy-hub/network.js` (`NET_TEXT`), the same words the check
page shows. On Telegram, put it in the same message.

### 1.2 Long version (Telegram, Discord, Medium, Facebook, LINE; English, then the 7 other languages)

**English**
> **ZETAPHY airdrop: 10 ZTPHY to 100,000 active Ethereum wallets**
>
> We sent 10 ZTPHY to each of 100,000 Ethereum addresses that people actively use. ZETAPHY is an EVM chain, so the
> same key controls the same address here: the coins are already at your address on ZETAPHY mainnet (chain 3659).
>
> - **The coins are already in your wallet. There is nothing to claim and nothing to pay.**
> - **We never DM you and never ask for a seed phrase, private key, signature or approval. Anyone who does is a scammer.**
>
> Check any address, no wallet needed: https://app.sawasdeecoin.com/got-ztphy.html. The page also adds the ZETAPHY
> network to your wallet so you can see the coins. That only adds a network; it asks for nothing else.
>
> How addresses were chosen: public Ethereum data, wallets with at least 10 successful transactions over at least 3
> months, active in the last 6 months, no contracts, no exchange-sized or bot-like activity. The query is public
> (`zetaphy-network/airdrop/queries/active-evm-wallets.sql`). The full list is published with its sha256 and count
> on the check page, so anyone can verify it.
>
> You did not ask for these coins: you can ignore them.
>
> ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not yet
> completed an independent external audit. Use it only with amounts you can afford to lose.
> Notice: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

**ภาษาไทย**
> **แอร์ดรอป ZETAPHY: 10 ZTPHY ให้กระเป๋า Ethereum ที่ใช้งานอยู่ 100,000 กระเป๋า**
>
> เราส่ง 10 ZTPHY ให้ที่อยู่ Ethereum ที่มีคนใช้งานจริง 100,000 ที่อยู่ ZETAPHY เป็นเชน EVM คีย์เดียวกันจึงคุมที่อยู่เดียวกันที่นี่
> เหรียญอยู่ที่ที่อยู่ของคุณบน ZETAPHY mainnet (chain 3659) แล้ว
>
> - **เหรียญอยู่ในกระเป๋าของคุณแล้ว ไม่มีอะไรต้องเคลม และไม่มีอะไรต้องจ่าย**
> - **เราไม่เคยทักแชตหาคุณ และไม่เคยขอ seed phrase, private key, ลายเซ็น หรือการอนุมัติ (approve) ใครที่ขอ คือมิจฉาชีพ**
>
> ตรวจที่อยู่ใดก็ได้ ไม่ต้องใช้กระเป๋า: https://app.sawasdeecoin.com/got-ztphy.html หน้านี้มีปุ่มเพิ่มเครือข่าย ZETAPHY
> ในกระเป๋าเพื่อให้เห็นเหรียญ ปุ่มนี้แค่เพิ่มเครือข่าย ไม่ขออย่างอื่น
>
> เลือกที่อยู่อย่างไร: ข้อมูลสาธารณะของ Ethereum กระเป๋าที่มีธุรกรรมสำเร็จอย่างน้อย 10 ครั้ง ใน 3 เดือนขึ้นไป ใช้งานใน 6 เดือนล่าสุด
> ไม่ใช่สัญญา ไม่ใช่กระเป๋าขนาดตลาดแลกเปลี่ยนหรือบอท คำสั่ง query เปิดเผย (`zetaphy-network/airdrop/queries/active-evm-wallets.sql`)
> รายชื่อทั้งหมดเผยแพร่พร้อม sha256 และจำนวนบนหน้าตรวจ ใครก็ตรวจสอบได้
>
> คุณไม่ได้ขอเหรียญนี้: เพิกเฉยได้เลย
>
> ขณะนี้ ZETAPHY mainnet ทำงานบน validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ (audit)
> จากภายนอกที่เป็นอิสระ โปรดใช้เฉพาะจำนวนที่ยอมเสียได้
> ประกาศ: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.th.md

**中文**
> **ZETAPHY 空投：向 100,000 个活跃以太坊钱包各发 10 ZTPHY**
>
> 我们向 100,000 个有人实际使用的以太坊地址各发送了 10 ZTPHY。ZETAPHY 是 EVM 链，同一个密钥在这里控制同一个地址：
> 代币已经在你 ZETAPHY 主网（链 3659）上的地址里。
>
> - **代币已经在你的钱包里了。无需领取，也无需支付任何费用。**
> - **我们从不私信你，也从不索要助记词、私钥、签名或授权。任何这样做的人都是骗子。**
>
> 查询任意地址，无需钱包：https://app.sawasdeecoin.com/got-ztphy.html 。该页面还能把 ZETAPHY 网络添加到你的钱包，
> 以便看到代币。它只添加网络，不要求其他任何东西。
>
> 地址如何选出：以太坊公开数据；3 个月以上至少 10 笔成功交易、最近 6 个月内活跃的钱包；排除合约、交易所规模或机器人式活动。
> 查询语句公开（`zetaphy-network/airdrop/queries/active-evm-wallets.sql`）。完整名单及其 sha256 和数量公布在查询页面上，人人可验证。
>
> 你没有申请这些代币：可以直接忽略。
>
> ZETAPHY 主网目前仅由 ZETAPHY 项目运营的一个验证者运行，其代码尚未完成独立的外部审计。请只投入您能承受损失的金额。
> 公告：https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

**Español**
> **Airdrop de ZETAPHY: 10 ZTPHY a 100.000 billeteras activas de Ethereum**
>
> Enviamos 10 ZTPHY a cada una de 100.000 direcciones de Ethereum que la gente usa de verdad. ZETAPHY es una cadena EVM,
> así que la misma clave controla la misma dirección aquí: las monedas ya están en tu dirección en la mainnet de
> ZETAPHY (cadena 3659).
>
> - **Las monedas ya están en tu billetera. No hay nada que reclamar ni nada que pagar.**
> - **Nunca te escribimos por mensaje directo y nunca pedimos una frase semilla, una clave privada, una firma ni una aprobación. Quien lo haga es un estafador.**
>
> Consulta cualquier dirección, sin billetera: https://app.sawasdeecoin.com/got-ztphy.html. La página también añade la
> red ZETAPHY a tu billetera para que veas las monedas. Solo añade una red; no pide nada más.
>
> Cómo se eligieron las direcciones: datos públicos de Ethereum, billeteras con al menos 10 transacciones exitosas en
> al menos 3 meses, activas en los últimos 6 meses, sin contratos ni actividad de exchange o de bot. La consulta es
> pública (`zetaphy-network/airdrop/queries/active-evm-wallets.sql`). La lista completa se publica con su sha256 y su
> número en la página de consulta, para que cualquiera la verifique.
>
> No pediste estas monedas: puedes ignorarlas.
>
> La mainnet de ZETAPHY funciona actualmente con un solo validador operado por el proyecto ZETAPHY, y su código aún no
> ha completado una auditoría externa independiente. Úsala solo con cantidades que puedas permitirte perder.
> Aviso: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

**한국어**
> **ZETAPHY 에어드롭: 활성 이더리움 지갑 100,000개에 10 ZTPHY**
>
> 실제로 사용되는 이더리움 주소 100,000개에 각각 10 ZTPHY를 보냈습니다. ZETAPHY는 EVM 체인이라 같은 키가 이곳에서도 같은
> 주소를 제어합니다. 코인은 이미 ZETAPHY 메인넷(체인 3659)의 여러분 주소에 있습니다.
>
> - **코인은 이미 여러분의 지갑에 있습니다. 청구할 것도, 지불할 것도 없습니다.**
> - **저희는 절대 DM을 보내지 않으며 시드 문구, 개인 키, 서명 또는 승인을 요구하지 않습니다. 그런 요구를 하는 사람은 모두 사기꾼입니다.**
>
> 지갑 없이 아무 주소나 확인: https://app.sawasdeecoin.com/got-ztphy.html 이 페이지에서 ZETAPHY 네트워크를 지갑에 추가해
> 코인을 볼 수 있습니다. 네트워크만 추가하며 그 밖의 어떤 것도 요구하지 않습니다.
>
> 주소 선정 방법: 이더리움 공개 데이터, 3개월 이상에 걸쳐 성공한 거래 10건 이상, 최근 6개월 내 활동, 컨트랙트 제외, 거래소 규모나
> 봇 같은 활동 제외. 쿼리는 공개되어 있습니다(`zetaphy-network/airdrop/queries/active-evm-wallets.sql`). 전체 목록은 sha256과
> 개수와 함께 확인 페이지에 공개되어 누구나 검증할 수 있습니다.
>
> 요청하지 않은 코인입니다: 무시하셔도 됩니다.
>
> ZETAPHY 메인넷은 현재 ZETAPHY 프로젝트가 운영하는 단일 검증인으로 운영되며, 코드는 아직 독립적인 외부 감사를 마치지 않았습니다.
> 잃어도 괜찮은 금액으로만 사용하세요.
> 공지: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

**日本語**
> **ZETAPHY エアドロップ：アクティブな Ethereum ウォレット 10 万件に 10 ZTPHY**
>
> 実際に使われている Ethereum アドレス 100,000 件に、それぞれ 10 ZTPHY を送りました。ZETAPHY は EVM チェーンなので、同じ鍵が
> ここでも同じアドレスを管理します。コインはすでに ZETAPHY メインネット（チェーン 3659）上のあなたのアドレスにあります。
>
> - **コインはすでにあなたのウォレットにあります。請求するものも、支払うものもありません。**
> - **私たちが DM を送ることはなく、シードフレーズ、秘密鍵、署名、承認（approve）を求めることも決してありません。それを求める人は詐欺師です。**
>
> ウォレット不要で、どのアドレスでも確認できます: https://app.sawasdeecoin.com/got-ztphy.html このページでは ZETAPHY
> ネットワークをウォレットに追加して、コインを表示できます。ネットワークを追加するだけで、ほかには何も求めません。
>
> アドレスの選び方: Ethereum の公開データから、3 か月以上にわたり成功した取引が 10 件以上あり、直近 6 か月に活動したウォレット。
> コントラクト、取引所規模やボットのような活動は除外。クエリは公開しています（`zetaphy-network/airdrop/queries/active-evm-wallets.sql`）。
> リスト全体を sha256 と件数とともに確認ページで公開しているので、誰でも検証できます。
>
> 受け取りを希望していない場合は、無視してかまいません。
>
> ZETAPHY メインネットは現在、ZETAPHY プロジェクトが運用する 1 つのバリデーターだけで動いており、コードは独立した外部監査をまだ
> 完了していません。失っても構わない金額だけで使ってください。
> お知らせ: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

**Русский**
> **Аирдроп ZETAPHY: по 10 ZTPHY на 100 000 активных кошельков Ethereum**
>
> Мы отправили по 10 ZTPHY на 100 000 адресов Ethereum, которыми реально пользуются. ZETAPHY — сеть EVM, поэтому тот же
> ключ управляет тем же адресом и здесь: монеты уже на вашем адресе в мейннете ZETAPHY (сеть 3659).
>
> - **Монеты уже в вашем кошельке. Ничего не нужно забирать и ничего не нужно платить.**
> - **Мы никогда не пишем вам в личные сообщения и никогда не просим сид-фразу, приватный ключ, подпись или одобрение (approve). Любой, кто это делает, мошенник.**
>
> Проверьте любой адрес без кошелька: https://app.sawasdeecoin.com/got-ztphy.html. Страница также добавляет сеть ZETAPHY
> в кошелёк, чтобы увидеть монеты. Она только добавляет сеть и больше ничего не просит.
>
> Как выбирались адреса: публичные данные Ethereum, кошельки минимум с 10 успешными транзакциями за 3 месяца и больше,
> активные в последние 6 месяцев, без контрактов и без активности масштаба биржи или бота. Запрос открыт
> (`zetaphy-network/airdrop/queries/active-evm-wallets.sql`). Полный список опубликован с sha256 и числом адресов на
> странице проверки, и любой может его сверить.
>
> Вы не просили эти монеты: их можно просто игнорировать.
>
> Сейчас мейннет ZETAPHY работает на одном валидаторе, которым управляет проект ZETAPHY, и его код ещё не прошёл
> независимый внешний аудит. Используйте его только с суммами, потерю которых можете себе позволить.
> Уведомление: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

**Tiếng Việt**
> **Airdrop ZETAPHY: 10 ZTPHY cho 100.000 ví Ethereum đang hoạt động**
>
> Chúng tôi đã gửi 10 ZTPHY cho mỗi địa chỉ trong 100.000 địa chỉ Ethereum có người dùng thật. ZETAPHY là chuỗi EVM nên
> cùng một khóa điều khiển cùng địa chỉ ở đây: coin đã nằm ở địa chỉ của bạn trên mainnet ZETAPHY (chuỗi 3659).
>
> - **Coin đã nằm sẵn trong ví của bạn. Không có gì để nhận và không phải trả gì.**
> - **Chúng tôi không bao giờ nhắn tin riêng cho bạn và không bao giờ xin seed phrase, khóa riêng, chữ ký hay quyền phê duyệt (approve). Ai làm vậy đều là kẻ lừa đảo.**
>
> Kiểm tra bất kỳ địa chỉ nào, không cần ví: https://app.sawasdeecoin.com/got-ztphy.html. Trang này cũng thêm mạng
> ZETAPHY vào ví để bạn thấy coin. Nút đó chỉ thêm mạng, không xin gì khác.
>
> Cách chọn địa chỉ: dữ liệu công khai của Ethereum, ví có ít nhất 10 giao dịch thành công trong ít nhất 3 tháng, hoạt
> động trong 6 tháng gần nhất, không phải hợp đồng, không có hoạt động cỡ sàn giao dịch hay bot. Câu truy vấn được công
> khai (`zetaphy-network/airdrop/queries/active-evm-wallets.sql`). Toàn bộ danh sách được công bố kèm sha256 và số
> lượng trên trang kiểm tra để ai cũng xác minh được.
>
> Bạn không xin số coin này: cứ bỏ qua là được.
>
> Mainnet ZETAPHY hiện chạy trên một validator duy nhất do dự án ZETAPHY vận hành, và mã nguồn chưa hoàn tất kiểm toán
> độc lập từ bên ngoài. Chỉ dùng với số tiền bạn có thể chấp nhận mất.
> Thông báo: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

### 1.3 The pinned safety post (every channel, pinned for as long as the airdrop is news)

> ZETAPHY never DMs first. There is nothing to claim and nothing to pay. We never ask for a seed phrase, private
> key, signature or approval. Official links: https://app.sawasdeecoin.com and https://github.com/pospos191-alt/zetaphy.
> Anyone else is a scammer: report and block.

Thai: use the "safety line" of [ZETAPHY-MAINNET-ANNOUNCE.th.md](ZETAPHY-MAINNET-ANNOUNCE.th.md) plus
"ไม่มีอะไรต้องเคลม ไม่มีอะไรต้องจ่าย". The other languages: the page's own `safe1`-`safe4` texts in
`zetaphy-hub/got-ztphy-i18n.js` are the approved translations.

### 1.4 Replies you will need (copy, do not improvise)

| They say | You answer |
|---|---|
| "How do I claim?" | "There is nothing to claim: the coins are already at your address on chain 3659. Check it here: https://app.sawasdeecoin.com/got-ztphy.html" |
| "Someone DMed me a claim link" | "That is a scam. We never DM and never ask for a signature, an approval or a seed phrase. Do not click; report and block." |
| "Is this a scam?" | "Fair question. Nothing to sign, nothing to pay; the list, the query and the code are public: [links]. And read the risks: [risk sentence]." |
| "What is it worth / when listing / wen moon?" | "We do not talk about price. Here is what the chain does today: [one fact from section 2]." |
| "I don't want it" | "You can ignore it; nothing happens unless you use your key on chain 3659." |

## 2. The 30-day plan (English; Thai mirror in OUTREACH.th.md)

One post a day, starting the day after the announcement. Each one states **one fact you can verify yourself** before
posting (the "Check" column says how). If a check fails, skip that day's post; never post a fact you have not checked.
Every post that mentions ZTPHY ends with the short risk line: *"Mainnet runs on one validator and has no external
audit yet: use only what you can afford to lose."*

| Day | Topic | Post (adapt the wording, keep the fact) | Check before posting |
|---|---|---|---|
| 1 | Safety first | "Reminder: the 10 ZTPHY airdrop has nothing to claim. If anyone asks you to connect, sign or approve to 'receive' ZTPHY, it is a scam." + check page link | the pinned post is up on every account |
| 2 | Verify the list | "Don't trust us, check: the airdrop list is public with its sha256. Download list.txt, run `sha256sum list.txt`, compare." | the check page shows the sha256; `sha256sum` of the published list.txt matches |
| 3 | How recipients were picked | The query rules: ≥10 successful txs, ≥3 active months, active in the last 6 months, no contracts, no exchange/bot-sized activity. Link the .sql file | `zetaphy-network/airdrop/queries/active-evm-wallets.sql` (the `DECLARE` lines) |
| 4 | How-to: see your ZTPHY | "Open the check page, press Add ZETAPHY, switch network: same address as on Ethereum." Short screen recording | do it on a phone with MetaMask |
| 5 | Genesis you can verify | "Mainnet genesis 2026-11-13 14:00 UTC. sha256 ca0efb15…0a94667. Check: `sha256sum -c genesis.sha256`." | run it in `zetaphy-chain/mainnet/zetaphy_3659-1/` |
| 6 | Fixed supply | "1,000,000,000 ZTPHY, no inflation, fixed from block 1." | ZETAPHY-MAINNET-NOTICE.md "What is fixed from block 1"; the genesis file |
| 7 | Fee burn | "Half of each fee is burned." | the notice; `setup-node.sh` fee-burn patch (read only) |
| 8 | Team lock | "Team coins are locked for 1 year, then released linearly until year 4." | the notice; the vesting accounts in `genesis.json` |
| 9 | Honest risks | "ZETAPHY runs on one validator today and has no external audit yet. Here is what changes that: more independent validators (day 10) and a published audit." | the notice |
| 10 | Run a validator | "One command installs a mainnet node from the signed release and checks the genesis sha256" + https://app.sawasdeecoin.com/validators.html | read validators.html; the `install.sh validator` line in ZETAPHY-MAINNET-PROCEDURE.md |
| 11 | Post-quantum accounts | "ZETAPHY accounts can be controlled by an ML-DSA-44 (FIPS 204) key only, with no ECDSA key at all." | `zetaphy-wallet/README.md` (top) |
| 12 | MetaMask + post-quantum | "The ZETAPHY Snap gives MetaMask a native ML-DSA-44 account; the source is in the repo." (Do not say "in the MetaMask store" unless it is.) | `zetaphy-snap/README.md` |
| 13 | Neuro, what it is | "Neuro reads a token contract and says, in plain words, what its owner can do: mint more, block wallets, pause, change taxes, upgrade." | open https://neuro.sawasdeecoin.com/web/ and check one token |
| 14 | Neuro, many chains | "Neuro reads tokens on Ethereum, BNB Chain, Base, Arbitrum, Solana, Sui, Aptos, TON, NEAR, Starknet, Osmosis, Neutron and Bitcoin Runes." | `zetaphy-neuro/README.md` first paragraph |
| 15 | Neuro, read-only | "Neuro never asks to connect a wallet and has no code that sends transactions." | `zetaphy-neuro/README.md` "Read-only"; `src/rpc.js` |
| 16 | Neuro demo video | Post the 45-second Short (section 4) | the token in the video still shows the same result |
| 17 | Re-checkable reports | "Every Neuro report has a reportHash and the CLI command to re-check it yourself." | run the CLI line of one report |
| 18 | Vaccine in MetaMask | "The ZETAPHY Snap checks every EVM transaction you are about to confirm against ZETAPHY's ThreatRegistry." | `zetaphy-snap/README.md` "Vaccine"; ThreatRegistry `0xaACfc7Cf7148b7AE530c2Ab891D4220E648A2139` in `network.js` |
| 19 | Free fees | "New to ZETAPHY? The faucet on the site gives a little ZTPHY for fees." | open the Earn tab: it says the amount, or that today's budget is used up (then skip) |
| 20 | Bug bounty | "ZetaphyBounty `0xb73856…9eBE` holds 1,000 ZTPHY on mainnet; a 2-of-3 committee approves payouts, which wait 48 h. Report: SECURITY.md." | BUG_BOUNTY.md status box; the contract's balance on the explorer |
| 21 | No single key | "No single key can trip the circuit breaker: only governance or a 2-of-3 multisig." | the notice |
| 22 | Governance in the open | "Contracts are owned by a timelock (`0x9fC2…f9cA`) and a 2-of-3 guardian multisig (`0x54EF…4519`)." | `network.js` contracts; `zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json` |
| 23 | Ledger | "The hub signs with a Ledger over USB (WebHID): Ethereum app, no Ledger metadata services called." | `zetaphy-hub/ledger.js` header; try it once |
| 24 | 8 languages | "The whole hub speaks 8 languages: English, Thai, Chinese, Spanish, Korean, Japanese, Russian, Vietnamese." | switch the language menu on the site |
| 25 | Explorer without a backend | "The explorer reads the public RPC directly: what you see is what the node says." | `network.js` (`explorer: null`, the comment) |
| 26 | Safety how-to | "What an 'approval' is and why no airdrop ever needs one" (thread; no project names of other people) | none: an explainer |
| 27 | The code | "The code is public on GitHub (BUSL-1.1, becoming GPL-2.0-or-later on 2030-10-24)." | `LICENSE` |
| 28 | Developers | "EVM chain 3659: deploy with the tools you use (Hardhat, Foundry) to RPC https://129-221-199-191.sslip.io." (ethdev only if it helps devs) | deploy a test contract yourself first |
| 29 | Base bridge | **Only if the Saphan route to Base is open** (SAPHAN-MAINNET.md): what it does, and its own risk lines (our own small validator set signs it, contracts not audited). Otherwise: day 9 again with any new validator count | `hub-config.json` `saphanTokens` shows the route `open` |
| 30 | Month 1 in numbers | Block height, validators, transactions, addresses that used their ZTPHY: only numbers you read yourself from the RPC / explorer that day, with the time you read them | read them; screenshot with the time |

After day 30: repeat the safety post weekly, post when something verifiable changes (a validator joins, an audit
starts, a route opens), and re-run this plan with the facts that changed.

## 3. Channels

General rules for every channel: post from the official account only; the bio links only to the site and the
repository; no paid promotion of any kind; reply in public, never move a conversation to DMs; never post a price, a
chart or a prediction.

| Channel | What to post | How often | That channel's rules (read the current ones before posting) |
|---|---|---|---|
| **X** | Section 1.1 (+ risk reply), then the 30-day plan; short threads for how-tos | 1 post a day, replies as needed | No buying followers, likes or engagement; no follow-for-follow or automated mass replies (X's platform-manipulation and spam policy); label the airdrop clearly; do not tag accounts that did not engage |
| **Telegram** | A broadcast channel (announcements, admins only post) and a group (questions). Section 1.2 in the channel, pinned safety post in both | channel: 1 a day at most; group: answer questions | Turn on slow mode and a join captcha; admins never DM first, and the group description says so; ban anyone posting "claim" links; fake admin accounts copy your name: make admin titles visible |
| **Discord** | `#announcements` (read-only), `#help`, `#validators`, `#dev`. Section 1.2 in announcements | as needed | Turn off DMs from server members by default; no bots that ask users to "verify a wallet"; Discord's Community Guidelines on spam |
| **Reddit r/cosmosnetwork** | Technical posts only: the post-quantum accounts, the validator one-command install, Cosmos EVM details. Not the airdrop as a "free coins" post | at most 1 a week | Read the sidebar rules; disclose that you are the project; Reddit's site rule on self-promotion: most of your activity must be ordinary participation, not your own links |
| **Reddit r/ethdev** | **Developer content only**: deploying to an EVM chain with ML-DSA accounts, how Neuro reads contracts (code, not marketing). Never the airdrop | at most 1 a month | Questions and tutorials, no project promotion; if a post is only about ZETAPHY, it does not belong there |
| **Reddit r/CryptoCurrency** | Only in the daily discussion thread, or a post that meets their rules | rarely | Strict: self-promotion and airdrop/giveaway posts are limited or banned, minimum account age and karma apply, and the moderators remove "shilling". Read the current rules and the moon-related rules before any post; when in doubt, do not post |
| **Medium / Mirror** | Long articles: the 1.2 announcement, "How we chose 100,000 wallets" (the query), "What Neuro checks", "Running a ZETAPHY validator" | 1 a week | Medium: no link farming; disclose affiliation. Mirror: publish from the project's own address and say who signs it |
| **YouTube Shorts / TikTok** | The 45-second Neuro scam-warning demo (section 4); how-to: see your ZTPHY in MetaMask | 1 a week | Both platforms restrict content promising financial returns: no price, no "earn", no giveaway framing; show real screens, no fake results |
| **Facebook groups (Thai)** | Section 1.2 Thai; Thai how-to posts | 1 a week per group | Ask the admin first; many crypto groups forbid project posts; never post in groups that only exist for "airdrop hunting" with referral links |
| **LINE OpenChat (Thai)** | An official OpenChat with the safety post as its notice; Thai announcements | as needed | Admins never message members first; turn on the setting that keeps message history for new members so the safety notice is visible; remove "claim" links at once |
| **Pantip** | One honest thread in the crypto room: what ZETAPHY is, the risks in Thai, the airdrop with the safety lines | 1 thread, then answer replies in it | Pantip removes advertising and repeated posts; post once as a disclosed project member and answer questions there |
| **CoinGecko** | Apply **only after a ZTPHY pool exists on Base** (SAPHAN-MAINNET.md) with real, public liquidity | once | Their listing form needs a live market, the contract, a site and the team's contacts; never pay anyone who promises a listing, and never create volume to qualify |
| **Developer directories** | Chain lists and wallet/token registries: the files are prepared separately (`zetaphy-chain/listings/`, `zetaphy-chain/wallets/`); open the pull requests from your own account | once each | Follow each repository's contribution rules exactly; a permanent RPC domain is better than `sslip.io` before listing (LAUNCH.md) |

## 4. Short video: the 45-second Neuro scam warning (YouTube Shorts / TikTok)

Vertical, 9:16, screen recording of https://neuro.sawasdeecoin.com/web/ on a phone, captions on screen (8 languages
for the captions: reuse the check page's safety lines). Choose a **real** token whose Neuro result shows owner
powers; re-check it the day you post. Neuro states code facts and does not call anyone a scammer: neither does the
video.

| Time | Screen | Voice / caption |
|---|---|---|
| 0-4 s | A DM: "Claim your free tokens, connect your wallet" | "Got a message like this? Stop." |
| 4-12 s | Neuro page, paste the token's contract address | "Before you buy or sign anything, paste the contract here. Free, no wallet needed." |
| 12-28 s | The result: what the owner can do (mint, pause, block, change tax), and the buy/sell simulation | "This shows what the owner of this token can do: here, [what the result shows]. Read it in plain words." |
| 28-38 s | The safety lines, large | "Real airdrops have nothing to claim and nothing to pay. Nobody legit asks for your seed phrase, a signature or an approval." |
| 38-45 s | Site URL and "Neuro by ZETAPHY" | "neuro.sawasdeecoin.com. Free, read-only." |

Do not show a price, a gain, or a "safe/unsafe" verdict Neuro did not give. If the token's issuer is a real,
identifiable person or company, blur the name: the video is about how to check, not about accusing anyone.

## 5. Never do (no exceptions)

- **No paid shills**: no paying influencers, KOLs, "callers" or group admins to post about ZETAPHY, disclosed or not.
- **No bought followers, likes, views, members or reviews**, and no bots or sock-puppet accounts.
- **No fake volume**: no wash trading, no market-making that trades with itself, no "volume bots", no paying for
  "trending" spots.
- **No price talk**: no price predictions, targets, charts, "100x", "early", "moon", "don't miss out", countdowns to a
  listing.
- **No promised returns**: no APY claims, no "passive income", no "guaranteed", no comparison with other investments.
- **No DMs to strangers**, ever. Not to airdrop recipients, not to influencers, not to "help" someone. Answer in public.
- **No asking anyone** for a seed phrase, private key, signature, approval or payment, for any reason.
- **No claim pages, no forms that collect wallets, no "verify your wallet" bots.**
- **No dropping the risk sentence** from a post about the coin, and no "audited" / "secure" / "decentralized" claims
  until they are true and checkable.
- **No posting in communities that forbid it**, no reposting after removal, no tagging strangers.
- **No impersonating** other projects, exchanges or people, and no using their logos as if they endorsed ZETAPHY.
