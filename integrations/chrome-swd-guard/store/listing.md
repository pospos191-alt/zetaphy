# SWD Guard — Chrome Web Store listing

Copy-paste text for the Chrome Web Store Developer Dashboard. Every claim here matches what the code does
(see `../README.md` and `../PRIVACY.md`). Keep it honest: SWD Guard is an **informational risk tool**; never add
"safe", "guaranteed", "100%", "protects your funds" or similar claims, which are untrue and get listings rejected.

| Item | Value |
| --- | --- |
| Package | `dist/swd-guard-<version>.zip` from `sh scripts/zip.sh` |
| Version | `0.1.0` (first release; raise it for every later upload) |
| Category | **Productivity → Tools** (if the dashboard shows the old flat list: **Productivity**) |
| Languages | th, en, zh_CN, ja, ko, vi, es, ru (the listing has one text per language; default = English) |
| Official URL / homepage | `https://swd-zetaphy.sawasdeecoin.com` |
| Support URL | `https://github.com/pospos191-alt/zetaphy/issues` |
| **Privacy policy URL** | **`https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy`** |
| Icon | `icons/icon128.png` (inside the package; the store also asks for it in the listing) |
| Screenshots (1280×800, 24-bit PNG) | `store/screenshots/1-badge-*.png`, `2-popup-*.png`, `3-phishing-*.png`, `4-options-*.png` (upload the `-en` set for English, the `-th` set for Thai; other languages use the English set) |
| Small promo tile 440×280 | `store/promo/small-promo-440x280.png` |
| Marquee promo tile 1400×560 | `store/promo/marquee-1400x560.png` |
| Images rebuilt with | `node store/make-assets.mjs` (real extension UI in Chromium, all network mocked, demo token data) |

**Name and summary** come from the package automatically (`_locales/<lang>/messages.json`: `extName`,
`extDescription`, each ≤ 132 characters, checked by `scripts/check.mjs`). They are repeated below so the dashboard
fields can be checked. Only the **detailed description** has to be pasted, once per language.

---

## English (en) — default

**Name:** SWD Guard

**Summary (120/132):** SWD Audit risk badges on token pages, an audit popup for any token or transaction, and warnings on known phishing sites.

**Detailed description:**

```text
SWD Guard shows results from SWD Audit (automated, rule-based checks of crypto tokens) right where you look at tokens, and warns you on known phishing sites. It is an informational risk tool: it does not guarantee that any token or website is safe, and it is not financial advice.

WHAT IT DOES
• Risk badge on token pages: on token pages of solscan.io, jup.ag, birdeye.so, dexscreener.com and pump.fun, a small card shows the SWD Audit level (high / medium / low / no risk found by the rules) and, for medium or high, the main findings. Close it any time, or turn badges off in Settings.
• Audit popup: click the icon and paste a token address, a transaction hash or an explorer link (Solana, Ethereum, BNB Chain, Base, Arbitrum). A link opens the full report on swd-zetaphy.sawasdeecoin.com.
• Phishing warning: a full-page warning on domains in SWD Guard's list of sites that imitate SWD (fake "claim", "airdrop" and "connect wallet" pages). You can leave, or continue if you are sure. The popup also tells you when a site looks like SWD but is not an official sawasdeecoin.com site.
• Optional updated list (off by default): downloads a plain list of domain names once a day from SWD's public GitHub repository.
• 8 languages: Thai, English, Chinese (Simplified), Japanese, Korean, Vietnamese, Spanish, Russian.

PLEASE KEEP IN MIND
• Results come from automated rules and public on-chain data. "No risk found by the rules" does not mean "safe": a token can still lose value or turn out to be a scam. Always do your own research.
• The phishing list covers known sites only. A site that is not on the list is not proven safe.

PRIVACY
• Sends only the token address or transaction hash you are looking at, and your language, to the SWD Audit API. No cookies, no identifiers.
• Never reads wallets, seed phrases, private keys, passwords, form data, cookies or your browsing history. No analytics, no ads, no remote code.
• Privacy policy: https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• Open source: https://github.com/pospos191-alt/zetaphy (folder integrations/chrome-swd-guard)
```

## ไทย (th)

**ชื่อ:** SWD Guard

**คำอธิบายสั้น (108/132):** แสดงระดับความเสี่ยง SWD Audit บนหน้าเหรียญ ตรวจเหรียญหรือธุรกรรมใดก็ได้ และเตือนเมื่อเข้าเว็บฟิชชิงที่รู้จัก

**คำอธิบายแบบละเอียด:**

```text
SWD Guard แสดงผลจาก SWD Audit (การตรวจเหรียญคริปโตอัตโนมัติด้วยกฎ) ตรงหน้าที่คุณกำลังดูเหรียญ และเตือนเมื่อคุณเข้าเว็บฟิชชิงที่รู้จัก ส่วนขยายนี้เป็นเครื่องมือให้ข้อมูลความเสี่ยงเท่านั้น ไม่ได้รับประกันว่าเหรียญหรือเว็บใดปลอดภัย และไม่ใช่คำแนะนำการลงทุน

ทำอะไรได้บ้าง
• ป้ายความเสี่ยงบนหน้าเหรียญ: บนหน้าเหรียญของ solscan.io, jup.ag, birdeye.so, dexscreener.com และ pump.fun จะมีการ์ดเล็ก ๆ แสดงระดับ SWD Audit (สูง / ปานกลาง / ต่ำ / กฎไม่พบความเสี่ยง) และถ้าเสี่ยงปานกลางหรือสูงจะแสดงประเด็นหลัก ปิดการ์ดได้ทุกเมื่อ หรือปิดป้ายในหน้าตั้งค่า
• ป๊อปอัปตรวจ: กดไอคอนแล้ววางที่อยู่เหรียญ hash ธุรกรรม หรือลิงก์ explorer (Solana, Ethereum, BNB Chain, Base, Arbitrum) มีลิงก์ไปดูรายงานเต็มบน swd-zetaphy.sawasdeecoin.com
• เตือนเว็บฟิชชิง: แสดงหน้าคำเตือนเต็มจอบนโดเมนที่อยู่ในรายชื่อเว็บที่ปลอมเป็น SWD (หน้า "รับแอร์ดรอป" "เคลม" "เชื่อมต่อกระเป๋า" ปลอม) เลือกออกจากเว็บ หรือไปต่อถ้าแน่ใจ ป๊อปอัปยังบอกด้วยว่าเว็บไหนดูเหมือน SWD แต่ไม่ใช่เว็บทางการ sawasdeecoin.com
• รายชื่อฉบับล่าสุด (ไม่บังคับ ปิดไว้เป็นค่าเริ่มต้น): ดาวน์โหลดรายชื่อโดเมนธรรมดาจาก GitHub สาธารณะของ SWD วันละครั้ง
• 8 ภาษา: ไทย อังกฤษ จีน (ตัวย่อ) ญี่ปุ่น เกาหลี เวียดนาม สเปน รัสเซีย

โปรดทราบ
• ผลตรวจมาจากกฎอัตโนมัติและข้อมูลบนเชนที่เปิดเผย "กฎไม่พบความเสี่ยง" ไม่ได้แปลว่า "ปลอดภัย" เหรียญยังอาจราคาตกหรือเป็นการหลอกลวงได้ ควรศึกษาข้อมูลด้วยตนเองเสมอ
• รายชื่อเว็บฟิชชิงครอบคลุมเฉพาะเว็บที่รู้จัก เว็บที่ไม่อยู่ในรายชื่อไม่ได้แปลว่าปลอดภัย

ความเป็นส่วนตัว
• ส่งเฉพาะที่อยู่เหรียญหรือ hash ธุรกรรมที่คุณกำลังดู และภาษาของคุณ ไปยัง SWD Audit API ไม่มีคุกกี้ ไม่มีตัวระบุตัวตน
• ไม่อ่านกระเป๋า seed phrase private key รหัสผ่าน ข้อมูลในฟอร์ม คุกกี้ หรือประวัติการเข้าเว็บ ไม่มีระบบเก็บสถิติ ไม่มีโฆษณา ไม่โหลดโค้ดจากภายนอก
• นโยบายความเป็นส่วนตัว: https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• โอเพนซอร์ส: https://github.com/pospos191-alt/zetaphy (โฟลเดอร์ integrations/chrome-swd-guard)
```

## 简体中文 (zh_CN)

**名称：** SWD Guard

**简短说明（48/132）：** 在代币页面显示 SWD Audit 风险标记，可审计任意代币或交易，并在已知钓鱼网站上发出警告。

**详细说明：**

```text
SWD Guard 在你查看代币的页面上直接显示 SWD Audit（基于规则的加密代币自动检查）的结果，并在已知钓鱼网站上发出警告。它是一个提供风险信息的工具：不保证任何代币或网站是安全的，也不构成投资建议。

功能
• 代币页面风险标记：在 solscan.io、jup.ag、birdeye.so、dexscreener.com 和 pump.fun 的代币页面上，一个小卡片显示 SWD Audit 等级（高 / 中 / 低 / 规则未发现风险），中、高风险时还会列出主要发现。可随时关闭，或在设置中关闭标记。
• 审计弹窗：点击图标，粘贴代币地址、交易哈希或区块浏览器链接（Solana、Ethereum、BNB Chain、Base、Arbitrum），可在 swd-zetaphy.sawasdeecoin.com 打开完整报告。
• 钓鱼警告：对 SWD Guard 名单中冒充 SWD 的网站（虚假"领取""空投""连接钱包"页面）显示整页警告。你可以离开，或在确定时继续。弹窗还会提示某网站看起来像 SWD 但不是官方 sawasdeecoin.com 网站。
• 可选的更新名单（默认关闭）：每天从 SWD 公开的 GitHub 仓库下载一份纯域名列表。
• 8 种语言：泰语、英语、简体中文、日语、韩语、越南语、西班牙语、俄语。

请注意
• 结果来自自动规则和公开的链上数据。"规则未发现风险"不等于"安全"：代币仍可能贬值或被证明是骗局。请务必自行研究。
• 钓鱼名单只包含已知网站。不在名单上的网站并不代表安全。

隐私
• 只把你正在查看的代币地址或交易哈希以及你的语言发送到 SWD Audit API，不带 Cookie，不带任何标识符。
• 从不读取钱包、助记词、私钥、密码、表单数据、Cookie 或浏览记录。无统计分析、无广告、无远程代码。
• 隐私政策：https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• 开源：https://github.com/pospos191-alt/zetaphy（目录 integrations/chrome-swd-guard）
```

## 日本語 (ja)

**名前：** SWD Guard

**概要（57/132）：** トークンページに SWD Audit のリスク表示、任意のトークンや取引の監査、既知のフィッシングサイトでの警告。

**詳細な説明：**

```text
SWD Guard は、SWD Audit（ルールに基づく暗号資産トークンの自動チェック）の結果を、トークンを見ているページにそのまま表示し、既知のフィッシングサイトで警告します。リスク情報を提供するツールであり、トークンやサイトの安全を保証するものではなく、投資助言でもありません。

できること
• トークンページのリスク表示：solscan.io、jup.ag、birdeye.so、dexscreener.com、pump.fun のトークンページで、小さなカードに SWD Audit のレベル（高 / 中 / 低 / ルール上リスクなし）を表示し、中・高の場合は主な指摘も表示します。いつでも閉じられ、設定で表示をオフにできます。
• 監査ポップアップ：アイコンをクリックし、トークンアドレス、取引ハッシュ、エクスプローラーのリンクを貼り付けます（Solana、Ethereum、BNB Chain、Base、Arbitrum）。swd-zetaphy.sawasdeecoin.com で詳細レポートを開けます。
• フィッシング警告：SWD を装うサイト（偽の「受け取り」「エアドロップ」「ウォレット接続」ページ）のリストにあるドメインで全画面の警告を表示します。離れるか、確信がある場合は続行できます。ポップアップは、SWD に似ているが公式の sawasdeecoin.com ではないサイトも知らせます。
• 更新リスト（任意、初期設定はオフ）：SWD の公開 GitHub リポジトリからドメイン名だけのリストを 1 日 1 回ダウンロードします。
• 8 言語：タイ語、英語、中国語（簡体字）、日本語、韓国語、ベトナム語、スペイン語、ロシア語。

ご注意
• 結果は自動ルールと公開されたオンチェーンデータに基づきます。「ルール上リスクなし」は「安全」という意味ではありません。トークンが値下がりしたり詐欺と判明したりすることがあります。必ずご自身で調べてください。
• フィッシングリストは既知のサイトのみです。リストにないサイトが安全とは限りません。

プライバシー
• 表示中のトークンアドレスまたは取引ハッシュと言語だけを SWD Audit API に送信します。Cookie も識別子も送りません。
• ウォレット、シードフレーズ、秘密鍵、パスワード、フォーム入力、Cookie、閲覧履歴は一切読み取りません。分析・広告・リモートコードはありません。
• プライバシーポリシー：https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• オープンソース：https://github.com/pospos191-alt/zetaphy（フォルダ integrations/chrome-swd-guard）
```

## 한국어 (ko)

**이름:** SWD Guard

**요약 (62/132):** 토큰 페이지에 SWD Audit 위험 배지, 모든 토큰·거래 감사 팝업, 알려진 피싱 사이트 경고를 제공합니다.

**자세한 설명:**

```text
SWD Guard는 SWD Audit(규칙 기반의 암호화폐 토큰 자동 점검) 결과를 토큰을 보고 있는 페이지에 바로 보여 주고, 알려진 피싱 사이트에서 경고합니다. 위험 정보를 제공하는 도구일 뿐, 어떤 토큰이나 사이트의 안전도 보장하지 않으며 투자 조언이 아닙니다.

기능
• 토큰 페이지 위험 배지: solscan.io, jup.ag, birdeye.so, dexscreener.com, pump.fun의 토큰 페이지에서 작은 카드로 SWD Audit 등급(높음 / 중간 / 낮음 / 규칙상 위험 없음)을 보여 주고, 중간·높음이면 주요 발견 사항도 표시합니다. 언제든 닫을 수 있고 설정에서 배지를 끌 수 있습니다.
• 감사 팝업: 아이콘을 누르고 토큰 주소, 거래 해시 또는 익스플로러 링크(Solana, Ethereum, BNB Chain, Base, Arbitrum)를 붙여 넣으세요. swd-zetaphy.sawasdeecoin.com에서 전체 보고서를 열 수 있습니다.
• 피싱 경고: SWD를 사칭하는 사이트(가짜 "클레임", "에어드롭", "지갑 연결" 페이지) 목록에 있는 도메인에서 전체 화면 경고를 표시합니다. 떠나거나, 확실하면 계속할 수 있습니다. 팝업은 SWD처럼 보이지만 공식 sawasdeecoin.com 사이트가 아닌 경우도 알려 줍니다.
• 업데이트 목록(선택, 기본값 꺼짐): SWD의 공개 GitHub 저장소에서 도메인 이름 목록을 하루 한 번 내려받습니다.
• 8개 언어: 태국어, 영어, 중국어(간체), 일본어, 한국어, 베트남어, 스페인어, 러시아어.

유의 사항
• 결과는 자동 규칙과 공개 온체인 데이터에서 나옵니다. "규칙상 위험 없음"은 "안전함"이 아닙니다. 토큰 가치가 떨어지거나 사기로 드러날 수 있습니다. 항상 직접 조사하세요.
• 피싱 목록은 알려진 사이트만 포함합니다. 목록에 없다고 안전한 것은 아닙니다.

개인정보
• 보고 있는 토큰 주소 또는 거래 해시와 언어만 SWD Audit API로 보냅니다. 쿠키도 식별자도 보내지 않습니다.
• 지갑, 시드 문구, 개인 키, 비밀번호, 양식 데이터, 쿠키, 방문 기록을 절대 읽지 않습니다. 분석, 광고, 원격 코드가 없습니다.
• 개인정보처리방침: https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• 오픈 소스: https://github.com/pospos191-alt/zetaphy (폴더 integrations/chrome-swd-guard)
```

## Tiếng Việt (vi)

**Tên:** SWD Guard

**Tóm tắt (110/132):** Huy hiệu rủi ro SWD Audit trên trang token, kiểm tra mọi token hoặc giao dịch, cảnh báo trang lừa đảo đã biết.

**Mô tả chi tiết:**

```text
SWD Guard hiển thị kết quả SWD Audit (kiểm tra tự động token tiền mã hóa dựa trên quy tắc) ngay trên trang bạn đang xem token, và cảnh báo khi bạn vào các trang lừa đảo (phishing) đã biết. Đây là công cụ cung cấp thông tin rủi ro: không bảo đảm token hay trang web nào là an toàn và không phải lời khuyên đầu tư.

TÍNH NĂNG
• Huy hiệu rủi ro trên trang token: trên trang token của solscan.io, jup.ag, birdeye.so, dexscreener.com và pump.fun, một thẻ nhỏ hiển thị mức SWD Audit (cao / trung bình / thấp / quy tắc không thấy rủi ro) và, với mức trung bình hoặc cao, các phát hiện chính. Có thể đóng bất cứ lúc nào hoặc tắt huy hiệu trong Cài đặt.
• Cửa sổ kiểm tra: bấm biểu tượng rồi dán địa chỉ token, mã băm giao dịch hoặc liên kết explorer (Solana, Ethereum, BNB Chain, Base, Arbitrum). Có liên kết mở báo cáo đầy đủ trên swd-zetaphy.sawasdeecoin.com.
• Cảnh báo lừa đảo: cảnh báo toàn trang trên các tên miền trong danh sách trang giả mạo SWD (trang "nhận", "airdrop", "kết nối ví" giả). Bạn có thể rời đi, hoặc tiếp tục nếu chắc chắn. Cửa sổ kiểm tra cũng cho biết khi một trang trông giống SWD nhưng không phải trang chính thức sawasdeecoin.com.
• Danh sách cập nhật (tùy chọn, mặc định tắt): mỗi ngày tải một danh sách tên miền từ kho GitHub công khai của SWD.
• 8 ngôn ngữ: Thái, Anh, Trung (giản thể), Nhật, Hàn, Việt, Tây Ban Nha, Nga.

LƯU Ý
• Kết quả đến từ quy tắc tự động và dữ liệu on-chain công khai. "Quy tắc không thấy rủi ro" không có nghĩa là "an toàn": token vẫn có thể mất giá hoặc là lừa đảo. Hãy luôn tự tìm hiểu.
• Danh sách lừa đảo chỉ gồm các trang đã biết. Trang không có trong danh sách không có nghĩa là an toàn.

QUYỀN RIÊNG TƯ
• Chỉ gửi địa chỉ token hoặc mã băm giao dịch bạn đang xem, cùng ngôn ngữ của bạn, tới SWD Audit API. Không cookie, không mã định danh.
• Không bao giờ đọc ví, cụm từ khôi phục, khóa riêng, mật khẩu, dữ liệu biểu mẫu, cookie hay lịch sử duyệt web. Không phân tích, không quảng cáo, không mã từ xa.
• Chính sách quyền riêng tư: https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• Mã nguồn mở: https://github.com/pospos191-alt/zetaphy (thư mục integrations/chrome-swd-guard)
```

## Español (es)

**Nombre:** SWD Guard

**Resumen (126/132):** Insignias de riesgo SWD Audit en páginas de tokens, auditoría de cualquier token o transacción y avisos en sitios de phishing.

**Descripción detallada:**

```text
SWD Guard muestra los resultados de SWD Audit (comprobaciones automáticas de tokens cripto basadas en reglas) justo donde ves los tokens, y te avisa en sitios de phishing conocidos. Es una herramienta informativa de riesgo: no garantiza que ningún token o sitio sea seguro y no es asesoramiento financiero.

QUÉ HACE
• Insignia de riesgo en páginas de tokens: en las páginas de tokens de solscan.io, jup.ag, birdeye.so, dexscreener.com y pump.fun, una pequeña tarjeta muestra el nivel de SWD Audit (alto / medio / bajo / las reglas no encontraron riesgo) y, si es medio o alto, los hallazgos principales. Puedes cerrarla cuando quieras o desactivar las insignias en Ajustes.
• Ventana de auditoría: haz clic en el icono y pega una dirección de token, un hash de transacción o un enlace de explorador (Solana, Ethereum, BNB Chain, Base, Arbitrum). Un enlace abre el informe completo en swd-zetaphy.sawasdeecoin.com.
• Aviso de phishing: un aviso a pantalla completa en los dominios de la lista de sitios que imitan a SWD (páginas falsas de "reclamar", "airdrop" o "conectar billetera"). Puedes salir o continuar si estás seguro. La ventana también te indica cuándo un sitio parece SWD pero no es un sitio oficial de sawasdeecoin.com.
• Lista actualizada opcional (desactivada por defecto): descarga una vez al día una lista simple de dominios desde el repositorio público de GitHub de SWD.
• 8 idiomas: tailandés, inglés, chino (simplificado), japonés, coreano, vietnamita, español y ruso.

TEN EN CUENTA
• Los resultados provienen de reglas automáticas y datos públicos en cadena. "Las reglas no encontraron riesgo" no significa "seguro": un token puede perder valor o resultar una estafa. Investiga siempre por tu cuenta.
• La lista de phishing solo incluye sitios conocidos. Que un sitio no esté en la lista no demuestra que sea seguro.

PRIVACIDAD
• Envía a la API de SWD Audit solo la dirección del token o el hash de la transacción que estás viendo y tu idioma. Sin cookies ni identificadores.
• Nunca lee billeteras, frases semilla, claves privadas, contraseñas, datos de formularios, cookies ni tu historial. Sin analítica, sin anuncios, sin código remoto.
• Política de privacidad: https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• Código abierto: https://github.com/pospos191-alt/zetaphy (carpeta integrations/chrome-swd-guard)
```

## Русский (ru)

**Название:** SWD Guard

**Краткое описание (121/132):** Значки риска SWD Audit на страницах токенов, проверка любого токена или транзакции и предупреждения на фишинговых сайтах.

**Подробное описание:**

```text
SWD Guard показывает результаты SWD Audit (автоматических проверок криптотокенов по правилам) прямо там, где вы смотрите на токен, и предупреждает на известных фишинговых сайтах. Это информационный инструмент оценки рисков: он не гарантирует безопасность какого-либо токена или сайта и не является финансовым советом.

ЧТО ОН ДЕЛАЕТ
• Значок риска на страницах токенов: на страницах токенов solscan.io, jup.ag, birdeye.so, dexscreener.com и pump.fun небольшая карточка показывает уровень SWD Audit (высокий / средний / низкий / правила не нашли рисков), а для среднего и высокого — основные находки. Её можно закрыть в любой момент или отключить значки в настройках.
• Окно проверки: нажмите на значок расширения и вставьте адрес токена, хеш транзакции или ссылку на обозреватель (Solana, Ethereum, BNB Chain, Base, Arbitrum). Ссылка открывает полный отчёт на swd-zetaphy.sawasdeecoin.com.
• Предупреждение о фишинге: полноэкранное предупреждение на доменах из списка сайтов, выдающих себя за SWD (поддельные страницы «получить», «эйрдроп», «подключить кошелёк»). Можно уйти или продолжить, если вы уверены. Окно проверки также сообщает, если сайт похож на SWD, но не является официальным сайтом sawasdeecoin.com.
• Обновляемый список (по желанию, по умолчанию выключен): раз в день загружает простой список доменов из публичного репозитория SWD на GitHub.
• 8 языков: тайский, английский, китайский (упрощённый), японский, корейский, вьетнамский, испанский, русский.

ВАЖНО
• Результаты основаны на автоматических правилах и открытых данных блокчейна. «Правила не нашли рисков» не значит «безопасно»: токен всё равно может подешеветь или оказаться мошенничеством. Всегда проверяйте сами.
• Фишинговый список содержит только известные сайты. Отсутствие сайта в списке не доказывает его безопасность.

КОНФИДЕНЦИАЛЬНОСТЬ
• Отправляет в SWD Audit API только адрес токена или хеш транзакции, который вы смотрите, и ваш язык. Без cookie и идентификаторов.
• Никогда не читает кошельки, сид-фразы, приватные ключи, пароли, данные форм, cookie и историю браузера. Без аналитики, рекламы и удалённого кода.
• Политика конфиденциальности: https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy
• Открытый исходный код: https://github.com/pospos191-alt/zetaphy (папка integrations/chrome-swd-guard)
```

---

# Privacy practices tab (answers to paste)

## Single purpose description

```text
SWD Guard has one purpose: to show crypto users risk information before they interact with a token or a website. It shows SWD Audit's automated risk level for the token on supported token pages and in its popup, and warns on known phishing sites that imitate SWD. All features serve that single purpose.
```

## Permission justifications

**storage**

```text
Stores the user's settings (badges on/off, updated phishing list on/off) in chrome.storage.sync, the optional downloaded phishing list (domain names only) in chrome.storage.local, and a 10-minute cache of audit results in chrome.storage.session so the same token is not requested again. No personal data is stored.
```

**activeTab**

```text
Only when the user clicks the extension icon, the popup reads the current tab's address to (1) tell the user whether that site is on the phishing list or imitates SWD, and (2) pre-fill and audit the token address if the tab is a token page. Nothing is read from tabs the user does not open the popup on, and page content is never read.
```

**scripting**

```text
Used only for chrome.scripting.registerContentScripts: when the user has turned on the optional updated phishing list AND granted the optional all-sites permission on the settings page, the extension registers its own packaged warning script (src/content-phish.js) for the newly listed phishing domains only. It never injects code into other pages and never runs remote code.
```

**alarms**

```text
Schedules one daily alarm to download the updated phishing list (a JSON list of domain names) when the user has turned that option on. When the option is off, the alarm does nothing.
```

**Host permissions** (covers `host_permissions`, the content-script matches and `optional_host_permissions`)

```text
- https://swd-zetaphy.sawasdeecoin.com/*: the SWD Audit API, the only server the extension sends data to (a token address or transaction hash and the language code, without cookies).
- Content scripts on solscan.io, jup.ag, birdeye.so, dexscreener.com and pump.fun: to read the token address from the page URL (on DEX Screener, from the token's explorer link on the page) and draw the SWD Audit badge. They read nothing else.
- Content scripts on the bundled phishing domains (sawasdeecoin-claim.com and 5 similar lookalike domains): to show the full-page phishing warning on those sites only.
- Optional https://*/* and http://*/*: NOT granted at install. Requested only if the user clicks "Allow warnings on all listed sites" on the settings page, so the warning can also appear on domains from the daily updated list. Even then the script is registered only for listed domains. The user can remove it from the same page.
```

## Remote code

**Are you using remote code?** → **No, I am not using remote code.**

Justification (if a text box is shown):

```text
All JavaScript is included in the package. There are no remote <script> tags, no eval or new Function, and no WebAssembly. The extension only fetches DATA: JSON audit results from the SWD Audit API and, if the user opts in, a JSON list of domain names from raw.githubusercontent.com. Both are validated and displayed with textContent only; they are never executed.
```

## Data usage

**What user data do you plan to collect from users now or in the future?** → tick **none** of the categories.

Why none applies (keep for reviewer questions):

- The only thing sent off the device is a public token address or transaction hash (on-chain data, not about the user)
  plus a language code, to `swd-zetaphy.sawasdeecoin.com`, without cookies or any identifier. The extension does
  not send page URLs, page content or browsing history; the token address is extracted locally from supported token
  pages.
- The API server sees the IP address like any web server; it is used only for rate limiting and is not linked to
  anything (stated in the privacy policy).
- The updated phishing list is a download; nothing about the user is sent.
- If you prefer the most cautious reading, tick **"Web history"** and explain: "The token address on a supported
  token page is sent to the SWD Audit API to show its risk level." Both answers are consistent with the policy; do
  not tick anything else.

**Certifications** (tick all three):

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy`
(the page must be live and show the same text as `PRIVACY.md` before you submit).

## Test instructions for the reviewer (Distribution → "Test instructions", optional but helpful)

```text
No account or login is needed.
1. Open https://solscan.io/token/So11111111111111111111111111111111111111112 (or any token page on jup.ag, birdeye.so, dexscreener.com, pump.fun). A small "SWD Audit" card appears at the bottom right.
2. Click the extension icon, paste any Solana token address or an Ethereum 0x address (pick the chain) and press Check.
3. The full-page phishing warning appears on the listed lookalike domains (e.g. sawasdeecoin-claim.com). Such domains often do not resolve; then the browser shows its own error page and there is nothing to warn about.
4. Settings: right-click the icon → Options.
Results come from https://swd-zetaphy.sawasdeecoin.com (SWD Audit API).
```
