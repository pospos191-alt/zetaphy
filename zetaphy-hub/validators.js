// Validator guide (validators.html): joining ZETAPHY mainnet (zetaphy_3659-1) as a validator, in 8 languages.
// The commands are zetaphy-chain/join-validator.sh's (install.sh validator): the signed release, the published genesis
// checked against its sha256, then `zetaphy-validator key` and `zetaphy-validator stake N` with your own ZTPHY.
// Every string is fixed text written here (no user input), so innerHTML is safe; the moniker and the amount are
// cleaned and only ever set with textContent.
const T = {
en: {
  title: 'Run a ZETAPHY Validator', h1: 'Run a ZETAPHY mainnet validator',
  lede: 'One command installs a validator node of ZETAPHY mainnet (<code>zetaphy_3659-1</code>, EVM chain 3659) on any Linux machine with systemd. Then you make your own key and stake your own ZTPHY: there is no faucet and no automatic staking on mainnet.',
  tab_start: 'Install', tab_stake: 'Key and stake', tab_check: 'Check it works', tab_fix: 'Fix a problem', tab_keys: 'Keys and safety', tab_advanced: 'Advanced',
  lede_start: 'Run this on the machine that will be the validator: Ubuntu, Debian, Fedora, RHEL, Amazon Linux, openSUSE or Arch, x86_64 or arm64 (a cloud server, a home PC, a Raspberry Pi 4/5, Windows WSL 2 or a Mac VM). Pick its name first.',
  moniker: 'Validator name', hRun: '1. Install and join mainnet', copyCmd: 'Copy the command', copy: 'Copy', copied: 'Copied', selected: 'Selected: press Ctrl+C to copy',
  run1: 'Downloads <code>setup-node.sh</code> and the <code>zetaphyd</code> this repository\'s release workflow built and signed, and checks the Sigstore signature and the SHA-256 before anything runs as root. An unsigned or older release is refused.',
  run2: 'Downloads the published mainnet genesis and refuses it unless its sha256 is <code>ca0efb15…0a94667</code> (Advanced has it in full).',
  run3: 'Sets up a node of that genesis only, dialing the public sentry: no public RPC and no faucet on this machine, ever. The shut-down testnet\'s chain id is refused.',
  run4: 'The node then syncs. Nothing is staked by itself: go on with "Key and stake".',
  lede_stake: 'Once the install has finished, make the staking key, fund it with your own ZTPHY and stake when the node is in sync.',
  hKey: '2. Make the staking key', keyP: 'A file keyring with your passphrase in <code>~/.zetaphy-keys</code>. Its 24 words are shown once: write them on paper and keep them offline.',
  hFund: '3. Fund it', fundP: 'Send the amount you will stake plus about 1 ZTPHY for fees from your own wallet to the address this prints. Real ZTPHY: mainnet has no faucet for staking.',
  hSync: 'Wait until it is in sync', syncP: 'Run this until it says <b>in sync</b> and shows your balance.',
  hStake: '4. Stake', stakeP: '<code>create-validator</code> with this many ZTPHY of your own, then the ML-DSA vote key. It asks for your passphrase.', stakeAmt: 'ZTPHY to stake',
  hNotes: 'Before you stake',
  n1: 'ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project; new validators join next to it.',
  n2: 'From 4 validators on, the chain guard\'s power cap (3333 bps) refuses delegations that would give one validator more than 1/3 of the voting power; the project then moves stake away from its own validator.',
  n3: 'A validator that stops signing is jailed and part of its stake is slashed; signing twice (the same key on two machines) is slashed harder. Keep the machine on and run <code>status</code>.',
  n4: 'Your stake is real ZTPHY; unstaking waits the chain\'s unbonding time. Use only amounts you can afford to lose.',
  lede_check: 'Height, sync, address, balance, validator state, and advice: peers, disk, missed blocks, jail risk.',
  hCheck: 'Check your node', checkP: '"in sync" and "BONDED" mean it is validating. "jailed" means it missed too many blocks: see Fix a problem.',
  lede_fix: 'Most problems are fixed by one of these.',
  fixStatus: 'See what is wrong', fixUnjail: 'Jailed for downtime: back to work (asks for the passphrase)', fixRestart: 'Restart the node', fixUpdate: 'Move to the current signed release (keys and chain data kept)',
  lede_keys: 'Your keys are made on this machine and never sent anywhere.',
  keysBackup: 'Which files to copy somewhere safe (offline), and how', keysSecure: 'SSH with keys only, automatic security updates, fail2ban, file permissions (asks before each change)',
  keysWarn: 'Never restore <code>priv_validator_state.json</code> or <code>zetaphy_sign_state.json</code> from an older copy, and never run the same key on two machines: both can make the validator sign twice and be slashed.',
  lede_advanced: 'Installing by hand, the downloads and the chain\'s facts.',
  dlH: 'Downloads', dlNote: 'Only needed to install by hand; the one command downloads and checks these for you.', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: 'By hand', handP: 'Steps 3 and 11 of the mainnet procedure on your own machine with the published <code>genesis.json</code> and its sha256, <code>PEERS=</code> the sentry, wait for sync, then with your own file-keyring key and funds:',
  factsH: 'Chain facts', fChain: 'Chain ID', fEvm: 'EVM chain ID', fGenesis: 'Genesis sha256', fSymbol: 'Coin', fPeer: 'Public sentry (peer)', fSrc: 'Source code',
},
th: {
  title: 'รัน validator ของ ZETAPHY', h1: 'รัน validator บน ZETAPHY mainnet',
  lede: 'คำสั่งเดียวติดตั้งโหนด validator ของ ZETAPHY mainnet (<code>zetaphy_3659-1</code>, EVM chain 3659) บนเครื่อง Linux ที่มี systemd จากนั้นคุณสร้างคีย์ของตัวเองและ stake ZTPHY ของคุณเอง: mainnet ไม่มี faucet และไม่มีการ stake อัตโนมัติ',
  tab_start: 'ติดตั้ง', tab_stake: 'คีย์และการ stake', tab_check: 'ตรวจว่าทำงาน', tab_fix: 'แก้ปัญหา', tab_keys: 'คีย์และความปลอดภัย', tab_advanced: 'ขั้นสูง',
  lede_start: 'รันคำสั่งนี้บนเครื่องที่จะเป็น validator: Ubuntu, Debian, Fedora, RHEL, Amazon Linux, openSUSE หรือ Arch แบบ x86_64 หรือ arm64 (เซิร์ฟเวอร์คลาวด์ PC ที่บ้าน Raspberry Pi 4/5, Windows WSL 2 หรือ VM บน Mac) ตั้งชื่อก่อน',
  moniker: 'ชื่อ validator', hRun: '1. ติดตั้งและเข้าร่วม mainnet', copyCmd: 'คัดลอกคำสั่ง', copy: 'คัดลอก', copied: 'คัดลอกแล้ว', selected: 'เลือกข้อความแล้ว กด Ctrl+C เพื่อคัดลอก',
  run1: 'ดาวน์โหลด <code>setup-node.sh</code> และ <code>zetaphyd</code> ที่ workflow release ของ repository นี้ build และลงนามไว้ แล้วตรวจลายเซ็น Sigstore และ SHA-256 ก่อนรันอะไรด้วยสิทธิ์ root release ที่ไม่ได้ลงนามหรือเก่ากว่าจะถูกปฏิเสธ',
  run2: 'ดาวน์โหลด genesis ของ mainnet ที่เผยแพร่ไว้ และปฏิเสธถ้า sha256 ไม่ใช่ <code>ca0efb15…0a94667</code> (ค่าเต็มอยู่ในแท็บขั้นสูง)',
  run3: 'ตั้งโหนดของ genesis นั้นเท่านั้น ต่อกับ sentry สาธารณะ: เครื่องนี้ไม่มี RPC สาธารณะและไม่มี faucet ตลอดไป chain id ของ testnet ที่ปิดไปแล้วจะถูกปฏิเสธ',
  run4: 'จากนั้นโหนดจะ sync ไม่มีการ stake ให้อัตโนมัติ: ทำต่อที่ "คีย์และการ stake"',
  lede_stake: 'เมื่อติดตั้งเสร็จ สร้างคีย์ staking ใส่ ZTPHY ของคุณเอง และ stake เมื่อโหนด sync แล้ว',
  hKey: '2. สร้างคีย์ staking', keyP: 'เก็บใน file keyring ที่ล็อกด้วยรหัสผ่านของคุณใน <code>~/.zetaphy-keys</code> คำ 24 คำจะแสดงครั้งเดียว: จดลงกระดาษและเก็บแบบออฟไลน์',
  hFund: '3. ใส่เงิน', fundP: 'ส่งจำนวนที่จะ stake บวกประมาณ 1 ZTPHY เป็นค่าธรรมเนียม จากกระเป๋าของคุณเองไปยังที่อยู่ที่คำสั่งนี้แสดง เป็น ZTPHY จริง: mainnet ไม่มี faucet สำหรับ stake',
  hSync: 'รอจน sync', syncP: 'รันคำสั่งนี้จนขึ้น <b>in sync</b> และเห็นยอดเงินของคุณ',
  hStake: '4. Stake', stakeP: '<code>create-validator</code> ด้วย ZTPHY ของคุณเองตามจำนวนนี้ แล้วตั้งคีย์โหวต ML-DSA ระบบจะถามรหัสผ่าน', stakeAmt: 'จำนวน ZTPHY ที่จะ stake',
  hNotes: 'ก่อน stake',
  n1: 'ขณะนี้ ZETAPHY mainnet ทำงานบน validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง validator ใหม่จะเข้าร่วมเคียงข้าง',
  n2: 'เมื่อมี validator ตั้งแต่ 4 ตัว ขีดจำกัดกำลังโหวตของ chain guard (3333 bps) จะปฏิเสธการ delegate ที่ทำให้ validator ตัวใดมีกำลังโหวตเกิน 1/3 แล้วโครงการจะย้าย stake ออกจาก validator ของตัวเอง',
  n3: 'validator ที่หยุดเซ็นจะถูก jail และ stake บางส่วนถูกริบ (slash) การเซ็นซ้ำ (คีย์เดียวกันบนสองเครื่อง) ถูกริบหนักกว่า เปิดเครื่องไว้และรัน <code>status</code>',
  n4: 'stake ของคุณเป็น ZTPHY จริง การถอน stake ต้องรอช่วง unbonding ของเชน ใช้เฉพาะจำนวนที่ยอมเสียได้',
  lede_check: 'ความสูงบล็อก การ sync ที่อยู่ ยอดเงิน สถานะ validator และคำแนะนำ: peer ดิสก์ บล็อกที่พลาด ความเสี่ยงถูก jail',
  hCheck: 'ตรวจโหนดของคุณ', checkP: '"in sync" และ "BONDED" แปลว่ากำลังทำงานเป็น validator ถ้าขึ้น "jailed" แปลว่าพลาดบล็อกมากเกินไป: ดูที่แก้ปัญหา',
  lede_fix: 'ปัญหาส่วนใหญ่แก้ได้ด้วยคำสั่งเหล่านี้',
  fixStatus: 'ดูว่ามีอะไรผิด', fixUnjail: 'ถูก jail เพราะออฟไลน์: กลับมาทำงาน (ถามรหัสผ่าน)', fixRestart: 'รีสตาร์ตโหนด', fixUpdate: 'ย้ายไป release ที่ลงนามล่าสุด (เก็บคีย์และข้อมูลเชนไว้)',
  lede_keys: 'คีย์ของคุณสร้างบนเครื่องนี้และไม่ถูกส่งไปที่ไหน',
  keysBackup: 'ไฟล์ไหนต้องสำรองเก็บไว้ที่ปลอดภัย (ออฟไลน์) และทำอย่างไร', keysSecure: 'SSH ด้วยคีย์เท่านั้น อัปเดตความปลอดภัยอัตโนมัติ fail2ban สิทธิ์ไฟล์ (ถามก่อนเปลี่ยนแต่ละอย่าง)',
  keysWarn: 'ห้ามกู้ <code>priv_validator_state.json</code> หรือ <code>zetaphy_sign_state.json</code> จากสำเนาเก่า และห้ามรันคีย์เดียวกันบนสองเครื่อง: ทั้งสองอย่างทำให้ validator เซ็นซ้ำและถูกริบ stake',
  lede_advanced: 'ติดตั้งเอง ไฟล์ดาวน์โหลด และข้อมูลเชน',
  dlH: 'ดาวน์โหลด', dlNote: 'ใช้เฉพาะเมื่อติดตั้งเอง คำสั่งเดียวดาวน์โหลดและตรวจให้แล้ว', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: 'ติดตั้งเอง', handP: 'ขั้นที่ 3 และ 11 ของขั้นตอน mainnet บนเครื่องของคุณ ด้วย <code>genesis.json</code> ที่เผยแพร่และ sha256 ของมัน <code>PEERS=</code> sentry รอ sync แล้วใช้คีย์ file keyring และเงินของคุณเอง:',
  factsH: 'ข้อมูลเชน', fChain: 'Chain ID', fEvm: 'EVM chain ID', fGenesis: 'sha256 ของ genesis', fSymbol: 'เหรียญ', fPeer: 'sentry สาธารณะ (peer)', fSrc: 'ซอร์สโค้ด',
},
zh: {
  title: '运行 ZETAPHY 验证者', h1: '运行 ZETAPHY 主网验证者',
  lede: '一条命令即可在任何带 systemd 的 Linux 机器上安装 ZETAPHY 主网（<code>zetaphy_3659-1</code>，EVM 链 3659）的验证者节点。然后用你自己的密钥质押你自己的 ZTPHY：主网没有水龙头，也不会自动质押。',
  tab_start: '安装', tab_stake: '密钥与质押', tab_check: '检查运行', tab_fix: '解决问题', tab_keys: '密钥与安全', tab_advanced: '高级',
  lede_start: '在将成为验证者的机器上运行：Ubuntu、Debian、Fedora、RHEL、Amazon Linux、openSUSE 或 Arch，x86_64 或 arm64（云服务器、家用电脑、Raspberry Pi 4/5、Windows WSL 2 或 Mac 虚拟机）。先给它取个名字。',
  moniker: '验证者名称', hRun: '1. 安装并加入主网', copyCmd: '复制命令', copy: '复制', copied: '已复制', selected: '已选中：按 Ctrl+C 复制',
  run1: '下载本仓库发布流程构建并签名的 <code>setup-node.sh</code> 和 <code>zetaphyd</code>，在以 root 运行任何内容之前校验 Sigstore 签名和 SHA-256。未签名或更旧的版本会被拒绝。',
  run2: '下载已发布的主网 genesis，若其 sha256 不是 <code>ca0efb15…0a94667</code> 则拒绝（完整值见"高级"）。',
  run3: '只为该 genesis 建立节点，连接公共哨兵节点：本机永远没有公共 RPC 和水龙头。已关闭的测试链 ID 会被拒绝。',
  run4: '随后节点开始同步。不会自动质押：继续看"密钥与质押"。',
  lede_stake: '安装完成后，生成质押密钥，用你自己的 ZTPHY 充值，节点同步后再质押。',
  hKey: '2. 生成质押密钥', keyP: '保存在 <code>~/.zetaphy-keys</code> 中用你的密码保护的文件钥匙串里。24 个助记词只显示一次：抄在纸上并离线保存。',
  hFund: '3. 充值', fundP: '从你自己的钱包向此命令显示的地址转入要质押的数量再加约 1 ZTPHY 手续费。是真实的 ZTPHY：主网没有用于质押的水龙头。',
  hSync: '等待同步完成', syncP: '反复运行此命令，直到显示 <b>in sync</b> 和你的余额。',
  hStake: '4. 质押', stakeP: '用你自己的这么多 ZTPHY 执行 <code>create-validator</code>，然后设置 ML-DSA 投票密钥。会要求输入密码。', stakeAmt: '要质押的 ZTPHY',
  hNotes: '质押之前',
  n1: 'ZETAPHY 主网目前仅由 ZETAPHY 项目运营的一个验证者运行；新验证者在它旁边加入。',
  n2: '从 4 个验证者起，链守卫的权重上限（3333 bps）会拒绝让任一验证者超过 1/3 投票权的委托；届时项目会把质押从自己的验证者移走。',
  n3: '停止签名的验证者会被监禁并罚没部分质押；双重签名（同一密钥在两台机器上）罚没更重。保持机器开机并运行 <code>status</code>。',
  n4: '你的质押是真实的 ZTPHY；解除质押需等待链的解绑期。只投入你能承受损失的金额。',
  lede_check: '区块高度、同步、地址、余额、验证者状态，以及建议：节点连接、磁盘、漏块、被监禁风险。',
  hCheck: '检查你的节点', checkP: '"in sync" 和 "BONDED" 表示正在验证。"jailed" 表示漏块过多：见"解决问题"。',
  lede_fix: '大多数问题用下面其中一条即可解决。',
  fixStatus: '查看问题所在', fixUnjail: '因离线被监禁：恢复工作（需要密码）', fixRestart: '重启节点', fixUpdate: '升级到当前签名版本（保留密钥和链数据）',
  lede_keys: '你的密钥在本机生成，绝不会发送到任何地方。',
  keysBackup: '哪些文件需要复制到安全的地方（离线）以及怎么做', keysSecure: '仅密钥 SSH、自动安全更新、fail2ban、文件权限（每项更改前都会询问）',
  keysWarn: '切勿用旧副本恢复 <code>priv_validator_state.json</code> 或 <code>zetaphy_sign_state.json</code>，也切勿在两台机器上运行同一密钥：两者都可能导致双重签名并被罚没。',
  lede_advanced: '手动安装、下载和链的信息。',
  dlH: '下载', dlNote: '仅手动安装时需要；一条命令会替你下载并校验。', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: '手动', handP: '在你自己的机器上按主网流程第 3 和 11 步，使用已发布的 <code>genesis.json</code> 及其 sha256，<code>PEERS=</code> 哨兵节点，等待同步，然后用你自己的文件钥匙串密钥和资金：',
  factsH: '链信息', fChain: '链 ID', fEvm: 'EVM 链 ID', fGenesis: 'Genesis sha256', fSymbol: '币', fPeer: '公共哨兵节点（peer）', fSrc: '源代码',
},
es: {
  title: 'Ejecuta un validador de ZETAPHY', h1: 'Ejecuta un validador de la mainnet de ZETAPHY',
  lede: 'Un comando instala un nodo validador de la mainnet de ZETAPHY (<code>zetaphy_3659-1</code>, cadena EVM 3659) en cualquier Linux con systemd. Luego creas tu propia clave y haces staking con tus propios ZTPHY: en la mainnet no hay faucet ni staking automático.',
  tab_start: 'Instalar', tab_stake: 'Clave y staking', tab_check: 'Comprobar', tab_fix: 'Resolver un problema', tab_keys: 'Claves y seguridad', tab_advanced: 'Avanzado',
  lede_start: 'Ejecútalo en la máquina que será el validador: Ubuntu, Debian, Fedora, RHEL, Amazon Linux, openSUSE o Arch, x86_64 o arm64 (un servidor en la nube, un PC de casa, una Raspberry Pi 4/5, Windows WSL 2 o una VM en Mac). Elige antes su nombre.',
  moniker: 'Nombre del validador', hRun: '1. Instalar y unirse a la mainnet', copyCmd: 'Copiar el comando', copy: 'Copiar', copied: 'Copiado', selected: 'Seleccionado: pulsa Ctrl+C para copiar',
  run1: 'Descarga <code>setup-node.sh</code> y el <code>zetaphyd</code> que compiló y firmó el flujo de publicación de este repositorio, y comprueba la firma Sigstore y el SHA-256 antes de ejecutar nada como root. Una versión sin firma o más antigua se rechaza.',
  run2: 'Descarga el génesis publicado de la mainnet y lo rechaza si su sha256 no es <code>ca0efb15…0a94667</code> (completo en Avanzado).',
  run3: 'Configura un nodo solo de ese génesis, conectado al centinela público: sin RPC público y sin faucet en esta máquina, nunca. El chain id de la testnet cerrada se rechaza.',
  run4: 'Después el nodo se sincroniza. No se hace staking solo: sigue con "Clave y staking".',
  lede_stake: 'Cuando termine la instalación, crea la clave de staking, añade tus propios ZTPHY y haz staking cuando el nodo esté sincronizado.',
  hKey: '2. Crea la clave de staking', keyP: 'Un keyring de archivo con tu contraseña en <code>~/.zetaphy-keys</code>. Sus 24 palabras se muestran una vez: escríbelas en papel y guárdalas sin conexión.',
  hFund: '3. Añade fondos', fundP: 'Envía desde tu propia billetera la cantidad que vas a apostar más ~1 ZTPHY para comisiones a la dirección que muestra esto. ZTPHY reales: la mainnet no tiene faucet para staking.',
  hSync: 'Espera a la sincronización', syncP: 'Ejecútalo hasta que diga <b>in sync</b> y muestre tu saldo.',
  hStake: '4. Haz staking', stakeP: '<code>create-validator</code> con estos ZTPHY tuyos y luego la clave de voto ML-DSA. Pide tu contraseña.', stakeAmt: 'ZTPHY para staking',
  hNotes: 'Antes del staking',
  n1: 'La mainnet de ZETAPHY funciona actualmente con un solo validador operado por el proyecto ZETAPHY; los nuevos validadores se unen junto a él.',
  n2: 'Desde 4 validadores, el límite de poder del guardián de la cadena (3333 bps) rechaza delegaciones que darían a un validador más de 1/3 del poder de voto; entonces el proyecto retira stake de su propio validador.',
  n3: 'Un validador que deja de firmar queda encarcelado (jail) y pierde parte de su stake; firmar dos veces (la misma clave en dos máquinas) se castiga más. Mantén la máquina encendida y ejecuta <code>status</code>.',
  n4: 'Tu stake son ZTPHY reales; retirarlo espera el periodo de desvinculación de la cadena. Usa solo cantidades que puedas permitirte perder.',
  lede_check: 'Altura, sincronización, dirección, saldo, estado del validador y consejos: pares, disco, bloques perdidos, riesgo de jail.',
  hCheck: 'Comprueba tu nodo', checkP: '"in sync" y "BONDED" significan que está validando. "jailed" significa que perdió demasiados bloques: mira Resolver un problema.',
  lede_fix: 'La mayoría de los problemas se resuelven con uno de estos.',
  fixStatus: 'Ver qué falla', fixUnjail: 'En jail por estar caído: volver al trabajo (pide la contraseña)', fixRestart: 'Reiniciar el nodo', fixUpdate: 'Pasar a la versión firmada actual (se conservan claves y datos)',
  lede_keys: 'Tus claves se crean en esta máquina y nunca se envían a ningún sitio.',
  keysBackup: 'Qué archivos copiar a un lugar seguro (sin conexión) y cómo', keysSecure: 'SSH solo con claves, actualizaciones de seguridad automáticas, fail2ban, permisos (pregunta antes de cada cambio)',
  keysWarn: 'Nunca restaures <code>priv_validator_state.json</code> ni <code>zetaphy_sign_state.json</code> desde una copia antigua, y nunca ejecutes la misma clave en dos máquinas: ambas cosas pueden hacer que el validador firme dos veces y sea castigado.',
  lede_advanced: 'Instalación manual, descargas y datos de la cadena.',
  dlH: 'Descargas', dlNote: 'Solo para instalar a mano; el comando las descarga y comprueba por ti.', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: 'A mano', handP: 'Los pasos 3 y 11 del procedimiento de la mainnet en tu máquina con el <code>genesis.json</code> publicado y su sha256, <code>PEERS=</code> el centinela, espera la sincronización y luego, con tu clave de keyring de archivo y tus fondos:',
  factsH: 'Datos de la cadena', fChain: 'Chain ID', fEvm: 'Chain ID EVM', fGenesis: 'sha256 del génesis', fSymbol: 'Moneda', fPeer: 'Centinela público (peer)', fSrc: 'Código fuente',
},
ko: {
  title: 'ZETAPHY 검증인 운영', h1: 'ZETAPHY 메인넷 검증인 운영하기',
  lede: '명령 한 줄로 systemd가 있는 Linux 기기에 ZETAPHY 메인넷(<code>zetaphy_3659-1</code>, EVM 체인 3659) 검증인 노드를 설치합니다. 그다음 본인 키를 만들고 본인 ZTPHY를 스테이킹합니다: 메인넷에는 파우셋도 자동 스테이킹도 없습니다.',
  tab_start: '설치', tab_stake: '키와 스테이킹', tab_check: '작동 확인', tab_fix: '문제 해결', tab_keys: '키와 보안', tab_advanced: '고급',
  lede_start: '검증인이 될 기기에서 실행하세요: Ubuntu, Debian, Fedora, RHEL, Amazon Linux, openSUSE 또는 Arch, x86_64 또는 arm64 (클라우드 서버, 집 PC, Raspberry Pi 4/5, Windows WSL 2, Mac VM). 먼저 이름을 정하세요.',
  moniker: '검증인 이름', hRun: '1. 설치하고 메인넷에 참여', copyCmd: '명령 복사', copy: '복사', copied: '복사됨', selected: '선택됨: Ctrl+C로 복사하세요',
  run1: '이 저장소의 릴리스 워크플로가 빌드하고 서명한 <code>setup-node.sh</code>와 <code>zetaphyd</code>를 내려받고, root로 무엇이든 실행하기 전에 Sigstore 서명과 SHA-256을 확인합니다. 서명되지 않았거나 더 오래된 릴리스는 거부됩니다.',
  run2: '공개된 메인넷 제네시스를 내려받고 sha256이 <code>ca0efb15…0a94667</code>이 아니면 거부합니다 (전체 값은 고급에).',
  run3: '그 제네시스의 노드만 설정하고 공개 센트리에 연결합니다: 이 기기에는 공개 RPC도 파우셋도 영원히 없습니다. 종료된 테스트넷의 체인 ID는 거부됩니다.',
  run4: '이후 노드가 동기화합니다. 자동으로 스테이킹되지 않으니 "키와 스테이킹"으로 이어가세요.',
  lede_stake: '설치가 끝나면 스테이킹 키를 만들고 본인 ZTPHY를 넣은 뒤, 노드가 동기화되면 스테이킹하세요.',
  hKey: '2. 스테이킹 키 만들기', keyP: '<code>~/.zetaphy-keys</code>에 비밀번호로 잠긴 파일 키링입니다. 24단어는 한 번만 보이니 종이에 적어 오프라인으로 보관하세요.',
  hFund: '3. 자금 넣기', fundP: '스테이킹할 수량과 수수료용 약 1 ZTPHY를 본인 지갑에서 이 명령이 보여 주는 주소로 보내세요. 실제 ZTPHY입니다: 메인넷에는 스테이킹용 파우셋이 없습니다.',
  hSync: '동기화될 때까지 기다리기', syncP: '<b>in sync</b>와 잔액이 보일 때까지 실행하세요.',
  hStake: '4. 스테이킹', stakeP: '본인 ZTPHY 이만큼으로 <code>create-validator</code>를 실행한 뒤 ML-DSA 투표 키를 설정합니다. 비밀번호를 묻습니다.', stakeAmt: '스테이킹할 ZTPHY',
  hNotes: '스테이킹 전에',
  n1: 'ZETAPHY 메인넷은 현재 ZETAPHY 프로젝트가 운영하는 단일 검증인으로 운영되며, 새 검증인은 그 옆에 합류합니다.',
  n2: '검증인이 4개 이상이 되면 체인 가드의 파워 상한(3333 bps)이 한 검증인이 투표권 1/3을 넘게 되는 위임을 거부하며, 프로젝트는 자기 검증인에서 스테이크를 옮깁니다.',
  n3: '서명을 멈춘 검증인은 감금(jail)되고 스테이크 일부가 삭감됩니다. 이중 서명(같은 키를 두 기기에서)은 더 크게 삭감됩니다. 기기를 켜 두고 <code>status</code>를 실행하세요.',
  n4: '스테이크는 실제 ZTPHY이며, 해제에는 체인의 언본딩 기간이 걸립니다. 잃어도 괜찮은 금액만 사용하세요.',
  lede_check: '블록 높이, 동기화, 주소, 잔액, 검증인 상태와 조언: 피어, 디스크, 놓친 블록, 감금 위험.',
  hCheck: '노드 확인', checkP: '"in sync"와 "BONDED"는 검증 중이라는 뜻입니다. "jailed"는 블록을 너무 많이 놓쳤다는 뜻이니 문제 해결을 보세요.',
  lede_fix: '대부분의 문제는 이 중 하나로 해결됩니다.',
  fixStatus: '무엇이 문제인지 보기', fixUnjail: '다운타임으로 감금됨: 다시 작동 (비밀번호 필요)', fixRestart: '노드 재시작', fixUpdate: '현재 서명된 릴리스로 이동 (키와 체인 데이터 유지)',
  lede_keys: '키는 이 기기에서 만들어지며 어디로도 보내지지 않습니다.',
  keysBackup: '안전한 곳(오프라인)에 복사할 파일과 방법', keysSecure: '키 전용 SSH, 자동 보안 업데이트, fail2ban, 파일 권한 (변경마다 먼저 묻습니다)',
  keysWarn: '<code>priv_validator_state.json</code>이나 <code>zetaphy_sign_state.json</code>을 오래된 사본으로 복원하지 말고, 같은 키를 두 기기에서 실행하지 마세요: 둘 다 이중 서명과 삭감을 일으킬 수 있습니다.',
  lede_advanced: '수동 설치, 다운로드, 체인 정보.',
  dlH: '다운로드', dlNote: '수동 설치 때만 필요합니다. 명령 한 줄이 대신 내려받고 확인합니다.', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: '수동으로', handP: '본인 기기에서 메인넷 절차 3단계와 11단계를 공개된 <code>genesis.json</code>과 sha256, <code>PEERS=</code> 센트리로 진행하고 동기화를 기다린 뒤, 본인 파일 키링 키와 자금으로:',
  factsH: '체인 정보', fChain: '체인 ID', fEvm: 'EVM 체인 ID', fGenesis: '제네시스 sha256', fSymbol: '코인', fPeer: '공개 센트리 (피어)', fSrc: '소스 코드',
},
ja: {
  title: 'ZETAPHY バリデーターを動かす', h1: 'ZETAPHY メインネットのバリデーターを動かす',
  lede: 'コマンド 1 つで、systemd のある Linux マシンに ZETAPHY メインネット（<code>zetaphy_3659-1</code>、EVM チェーン 3659）のバリデーターノードを入れます。その後、自分の鍵を作り、自分の ZTPHY をステークします。メインネットにフォーセットも自動ステークもありません。',
  tab_start: 'インストール', tab_stake: '鍵とステーク', tab_check: '動作確認', tab_fix: '問題の解決', tab_keys: '鍵と安全', tab_advanced: '上級',
  lede_start: 'バリデーターになるマシンで実行します：Ubuntu、Debian、Fedora、RHEL、Amazon Linux、openSUSE、Arch（x86_64 または arm64。クラウドサーバー、自宅 PC、Raspberry Pi 4/5、Windows WSL 2、Mac の VM）。先に名前を決めます。',
  moniker: 'バリデーター名', hRun: '1. インストールしてメインネットに参加', copyCmd: 'コマンドをコピー', copy: 'コピー', copied: 'コピーしました', selected: '選択しました：Ctrl+C でコピー',
  run1: 'このリポジトリのリリースワークフローがビルドし署名した <code>setup-node.sh</code> と <code>zetaphyd</code> をダウンロードし、root で何かを動かす前に Sigstore 署名と SHA-256 を確認します。署名のない、または古いリリースは拒否されます。',
  run2: '公開されたメインネットのジェネシスをダウンロードし、sha256 が <code>ca0efb15…0a94667</code> でなければ拒否します（全体は「上級」に）。',
  run3: 'そのジェネシスのノードだけを設定し、公開センチネルにつなぎます。このマシンに公開 RPC もフォーセットも置きません。終了したテストネットのチェーン ID は拒否されます。',
  run4: 'その後ノードは同期します。自動ではステークしません：「鍵とステーク」へ進みます。',
  lede_stake: 'インストールが終わったら、ステーキング鍵を作り、自分の ZTPHY を入れ、ノードが同期したらステークします。',
  hKey: '2. ステーキング鍵を作る', keyP: '<code>~/.zetaphy-keys</code> にあるパスフレーズ付きのファイルキーリングです。24 語は一度だけ表示されます：紙に書いてオフラインで保管します。',
  hFund: '3. 入金する', fundP: 'ステークする額と手数料用の約 1 ZTPHY を、自分のウォレットからこのコマンドが表示するアドレスへ送ります。実際の ZTPHY です：メインネットにステーク用のフォーセットはありません。',
  hSync: '同期を待つ', syncP: '<b>in sync</b> と残高が表示されるまで実行します。',
  hStake: '4. ステークする', stakeP: '自分の ZTPHY をこの額だけ使って <code>create-validator</code> を行い、次に ML-DSA 投票鍵を設定します。パスフレーズを聞かれます。', stakeAmt: 'ステークする ZTPHY',
  hNotes: 'ステークの前に',
  n1: 'ZETAPHY メインネットは現在、ZETAPHY プロジェクトが運用する 1 つのバリデーターだけで動いており、新しいバリデーターはその横に加わります。',
  n2: 'バリデーターが 4 つ以上になると、チェーンガードのパワー上限（3333 bps）が、1 つのバリデーターの投票力を 1/3 超にする委任を拒否します。プロジェクトはそのとき自分のバリデーターからステークを移します。',
  n3: '署名を止めたバリデーターは jail され、ステークの一部が没収（スラッシュ）されます。二重署名（同じ鍵を 2 台で）はさらに重く没収されます。マシンを動かし続け、<code>status</code> を確認してください。',
  n4: 'ステークは実際の ZTPHY で、解除にはチェーンのアンボンディング期間がかかります。失っても構わない金額だけで使ってください。',
  lede_check: 'ブロック高、同期、アドレス、残高、バリデーターの状態と助言：ピア、ディスク、見逃したブロック、jail の危険。',
  hCheck: 'ノードを確認する', checkP: '「in sync」と「BONDED」なら検証中です。「jailed」はブロックを見逃しすぎた状態です：「問題の解決」を見てください。',
  lede_fix: 'ほとんどの問題は次のどれかで直ります。',
  fixStatus: '何が問題か見る', fixUnjail: 'ダウンタイムで jail された：仕事に戻す（パスフレーズを聞かれます）', fixRestart: 'ノードを再起動', fixUpdate: '現在の署名済みリリースへ移る（鍵とチェーンデータは保持）',
  lede_keys: '鍵はこのマシンで作られ、どこにも送られません。',
  keysBackup: '安全な場所（オフライン）にコピーするファイルとその方法', keysSecure: '鍵だけの SSH、自動セキュリティ更新、fail2ban、ファイル権限（変更ごとに確認します）',
  keysWarn: '<code>priv_validator_state.json</code> や <code>zetaphy_sign_state.json</code> を古いコピーから戻さないこと、同じ鍵を 2 台で動かさないこと：どちらも二重署名とスラッシュの原因になります。',
  lede_advanced: '手動インストール、ダウンロード、チェーンの情報。',
  dlH: 'ダウンロード', dlNote: '手動でインストールするときだけ必要です。コマンド 1 つが代わりにダウンロードして確認します。', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: '手動で', handP: '自分のマシンでメインネット手順のステップ 3 と 11 を、公開された <code>genesis.json</code> とその sha256、<code>PEERS=</code> にセンチネルを指定して行い、同期を待ってから、自分のファイルキーリングの鍵と資金で：',
  factsH: 'チェーンの情報', fChain: 'チェーン ID', fEvm: 'EVM チェーン ID', fGenesis: 'ジェネシスの sha256', fSymbol: 'コイン', fPeer: '公開センチネル（ピア）', fSrc: 'ソースコード',
},
ru: {
  title: 'Запустите валидатор ZETAPHY', h1: 'Запустите валидатор мейннета ZETAPHY',
  lede: 'Одна команда устанавливает узел-валидатор мейннета ZETAPHY (<code>zetaphy_3659-1</code>, EVM-сеть 3659) на любую машину Linux с systemd. Затем вы создаёте свой ключ и стейкаете свои ZTPHY: в мейннете нет крана и нет автоматического стейкинга.',
  tab_start: 'Установка', tab_stake: 'Ключ и стейкинг', tab_check: 'Проверка', tab_fix: 'Решение проблем', tab_keys: 'Ключи и безопасность', tab_advanced: 'Дополнительно',
  lede_start: 'Запустите на машине, которая станет валидатором: Ubuntu, Debian, Fedora, RHEL, Amazon Linux, openSUSE или Arch, x86_64 или arm64 (облачный сервер, домашний ПК, Raspberry Pi 4/5, Windows WSL 2 или ВМ на Mac). Сначала выберите имя.',
  moniker: 'Имя валидатора', hRun: '1. Установка и подключение к мейннету', copyCmd: 'Копировать команду', copy: 'Копировать', copied: 'Скопировано', selected: 'Выделено: нажмите Ctrl+C',
  run1: 'Скачивает <code>setup-node.sh</code> и <code>zetaphyd</code>, собранные и подписанные workflow релизов этого репозитория, и проверяет подпись Sigstore и SHA-256 до запуска чего-либо от root. Неподписанный или более старый релиз отклоняется.',
  run2: 'Скачивает опубликованный генезис мейннета и отклоняет его, если sha256 не <code>ca0efb15…0a94667</code> (полностью — в «Дополнительно»).',
  run3: 'Настраивает узел только этого генезиса, подключённый к публичному сентри: на этой машине никогда нет публичного RPC и крана. Chain id закрытого тестнета отклоняется.',
  run4: 'Затем узел синхронизируется. Ничего не стейкается само: переходите к «Ключ и стейкинг».',
  lede_stake: 'После установки создайте ключ стейкинга, пополните его своими ZTPHY и застейкайте, когда узел синхронизируется.',
  hKey: '2. Создайте ключ стейкинга', keyP: 'Файловый keyring с вашим паролем в <code>~/.zetaphy-keys</code>. 24 слова показываются один раз: запишите на бумагу и храните офлайн.',
  hFund: '3. Пополните', fundP: 'Отправьте со своего кошелька на показанный адрес сумму для стейкинга плюс около 1 ZTPHY на комиссии. Это настоящие ZTPHY: крана для стейкинга в мейннете нет.',
  hSync: 'Дождитесь синхронизации', syncP: 'Запускайте, пока не появится <b>in sync</b> и ваш баланс.',
  hStake: '4. Стейкинг', stakeP: '<code>create-validator</code> с этой суммой ваших ZTPHY, затем ключ голосования ML-DSA. Запросит пароль.', stakeAmt: 'ZTPHY для стейкинга',
  hNotes: 'Перед стейкингом',
  n1: 'Сейчас мейннет ZETAPHY работает на одном валидаторе, которым управляет проект ZETAPHY; новые валидаторы присоединяются рядом с ним.',
  n2: 'Начиная с 4 валидаторов, ограничение мощности chain guard (3333 bps) отклоняет делегирования, дающие одному валидатору больше 1/3 голосов; тогда проект переносит стейк со своего валидатора.',
  n3: 'Валидатор, переставший подписывать, попадает в jail и теряет часть стейка; двойная подпись (один ключ на двух машинах) наказывается сильнее. Держите машину включённой и проверяйте <code>status</code>.',
  n4: 'Ваш стейк — настоящие ZTPHY; вывод ждёт период анбондинга сети. Используйте только суммы, потерю которых можете себе позволить.',
  lede_check: 'Высота, синхронизация, адрес, баланс, состояние валидатора и советы: пиры, диск, пропущенные блоки, риск jail.',
  hCheck: 'Проверьте узел', checkP: '«in sync» и «BONDED» значат, что он валидирует. «jailed» значит, что пропущено слишком много блоков: см. «Решение проблем».',
  lede_fix: 'Большинство проблем решается одной из этих команд.',
  fixStatus: 'Посмотреть, что не так', fixUnjail: 'В jail из-за простоя: вернуть в работу (запросит пароль)', fixRestart: 'Перезапустить узел', fixUpdate: 'Перейти на текущий подписанный релиз (ключи и данные сохраняются)',
  lede_keys: 'Ключи создаются на этой машине и никуда не отправляются.',
  keysBackup: 'Какие файлы скопировать в безопасное место (офлайн) и как', keysSecure: 'SSH только по ключам, автообновления безопасности, fail2ban, права файлов (спрашивает перед каждым изменением)',
  keysWarn: 'Никогда не восстанавливайте <code>priv_validator_state.json</code> или <code>zetaphy_sign_state.json</code> из старой копии и не запускайте один ключ на двух машинах: и то и другое может привести к двойной подписи и штрафу.',
  lede_advanced: 'Ручная установка, загрузки и данные сети.',
  dlH: 'Загрузки', dlNote: 'Нужны только для ручной установки; команда сама скачивает и проверяет их.', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: 'Вручную', handP: 'Шаги 3 и 11 процедуры мейннета на своей машине с опубликованным <code>genesis.json</code> и его sha256, <code>PEERS=</code> сентри, дождитесь синхронизации, затем со своим ключом из файлового keyring и своими средствами:',
  factsH: 'Данные сети', fChain: 'Chain ID', fEvm: 'EVM chain ID', fGenesis: 'sha256 генезиса', fSymbol: 'Монета', fPeer: 'Публичный сентри (пир)', fSrc: 'Исходный код',
},
vi: {
  title: 'Chạy validator ZETAPHY', h1: 'Chạy validator mainnet ZETAPHY',
  lede: 'Một lệnh cài node validator của mainnet ZETAPHY (<code>zetaphy_3659-1</code>, chuỗi EVM 3659) trên bất kỳ máy Linux nào có systemd. Sau đó bạn tạo khóa của mình và stake ZTPHY của chính bạn: mainnet không có faucet và không tự động stake.',
  tab_start: 'Cài đặt', tab_stake: 'Khóa và stake', tab_check: 'Kiểm tra', tab_fix: 'Sửa lỗi', tab_keys: 'Khóa và an toàn', tab_advanced: 'Nâng cao',
  lede_start: 'Chạy trên máy sẽ làm validator: Ubuntu, Debian, Fedora, RHEL, Amazon Linux, openSUSE hoặc Arch, x86_64 hoặc arm64 (máy chủ đám mây, PC ở nhà, Raspberry Pi 4/5, Windows WSL 2 hoặc VM trên Mac). Đặt tên trước.',
  moniker: 'Tên validator', hRun: '1. Cài đặt và tham gia mainnet', copyCmd: 'Sao chép lệnh', copy: 'Sao chép', copied: 'Đã sao chép', selected: 'Đã chọn: nhấn Ctrl+C để sao chép',
  run1: 'Tải <code>setup-node.sh</code> và <code>zetaphyd</code> do quy trình phát hành của kho này build và ký, kiểm tra chữ ký Sigstore và SHA-256 trước khi chạy bất cứ gì bằng root. Bản không ký hoặc cũ hơn bị từ chối.',
  run2: 'Tải genesis mainnet đã công bố và từ chối nếu sha256 không phải <code>ca0efb15…0a94667</code> (đầy đủ ở Nâng cao).',
  run3: 'Chỉ dựng node của genesis đó, kết nối sentry công khai: máy này không bao giờ có RPC công khai và faucet. Chain id của testnet đã đóng bị từ chối.',
  run4: 'Sau đó node đồng bộ. Không tự stake: tiếp tục ở "Khóa và stake".',
  lede_stake: 'Khi cài xong, tạo khóa staking, nạp ZTPHY của chính bạn và stake khi node đã đồng bộ.',
  hKey: '2. Tạo khóa staking', keyP: 'Một file keyring khóa bằng mật khẩu của bạn trong <code>~/.zetaphy-keys</code>. 24 từ chỉ hiện một lần: ghi ra giấy và giữ ngoại tuyến.',
  hFund: '3. Nạp tiền', fundP: 'Từ ví của bạn, gửi số sẽ stake cộng khoảng 1 ZTPHY phí tới địa chỉ lệnh này in ra. ZTPHY thật: mainnet không có faucet cho staking.',
  hSync: 'Chờ đồng bộ xong', syncP: 'Chạy lệnh này đến khi hiện <b>in sync</b> và số dư của bạn.',
  hStake: '4. Stake', stakeP: '<code>create-validator</code> với số ZTPHY này của bạn, rồi đặt khóa bỏ phiếu ML-DSA. Lệnh sẽ hỏi mật khẩu.', stakeAmt: 'ZTPHY để stake',
  hNotes: 'Trước khi stake',
  n1: 'Mainnet ZETAPHY hiện chạy trên một validator duy nhất do dự án ZETAPHY vận hành; validator mới tham gia bên cạnh nó.',
  n2: 'Từ 4 validator trở lên, giới hạn sức mạnh của chain guard (3333 bps) từ chối ủy quyền khiến một validator có hơn 1/3 quyền bỏ phiếu; khi đó dự án chuyển stake ra khỏi validator của mình.',
  n3: 'Validator ngừng ký sẽ bị jail và mất một phần stake; ký hai lần (cùng khóa trên hai máy) bị phạt nặng hơn. Giữ máy luôn bật và chạy <code>status</code>.',
  n4: 'Stake của bạn là ZTPHY thật; rút stake phải chờ thời gian unbonding của chuỗi. Chỉ dùng số tiền bạn có thể chấp nhận mất.',
  lede_check: 'Chiều cao khối, đồng bộ, địa chỉ, số dư, trạng thái validator và lời khuyên: peer, ổ đĩa, khối bỏ lỡ, nguy cơ bị jail.',
  hCheck: 'Kiểm tra node', checkP: '"in sync" và "BONDED" nghĩa là đang xác thực. "jailed" nghĩa là bỏ lỡ quá nhiều khối: xem Sửa lỗi.',
  lede_fix: 'Phần lớn lỗi được sửa bằng một trong các lệnh này.',
  fixStatus: 'Xem lỗi ở đâu', fixUnjail: 'Bị jail vì ngừng hoạt động: quay lại làm việc (hỏi mật khẩu)', fixRestart: 'Khởi động lại node', fixUpdate: 'Chuyển sang bản phát hành đã ký hiện tại (giữ khóa và dữ liệu chuỗi)',
  lede_keys: 'Khóa của bạn được tạo trên máy này và không bao giờ gửi đi đâu.',
  keysBackup: 'Tệp nào cần sao chép tới nơi an toàn (ngoại tuyến) và cách làm', keysSecure: 'SSH chỉ bằng khóa, cập nhật bảo mật tự động, fail2ban, quyền tệp (hỏi trước mỗi thay đổi)',
  keysWarn: 'Đừng bao giờ khôi phục <code>priv_validator_state.json</code> hay <code>zetaphy_sign_state.json</code> từ bản sao cũ, và đừng chạy cùng khóa trên hai máy: cả hai đều có thể khiến validator ký hai lần và bị phạt.',
  lede_advanced: 'Cài thủ công, tải về và thông tin chuỗi.',
  dlH: 'Tải về', dlNote: 'Chỉ cần khi cài thủ công; một lệnh đã tải và kiểm tra giúp bạn.', dlAmd: 'zetaphyd (x86_64)', dlArm: 'zetaphyd (ARM64)', dlSums: 'SHA256SUMS',
  handH: 'Thủ công', handP: 'Bước 3 và 11 của quy trình mainnet trên máy của bạn với <code>genesis.json</code> đã công bố và sha256 của nó, <code>PEERS=</code> sentry, chờ đồng bộ, rồi với khóa file keyring và tiền của chính bạn:',
  factsH: 'Thông tin chuỗi', fChain: 'Chain ID', fEvm: 'EVM chain ID', fGenesis: 'sha256 của genesis', fSymbol: 'Coin', fPeer: 'Sentry công khai (peer)', fSrc: 'Mã nguồn',
},
};
const LANGS = Object.keys(T);
const base = 'curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/install.sh | sudo MONIKER=';
const $ = (id) => document.getElementById(id);
let L = 'en';
try { const s = localStorage.getItem('zetaphy-join-lang') ?? localStorage.getItem('zetaphy-hub:lang'); if (LANGS.includes(s)) L = s; } catch (e) { /* storage blocked */ }
const EMBED = new URLSearchParams(location.search).has('embed');
{ const q = new URLSearchParams(location.search).get('lang'); if (LANGS.includes(q)) L = q; }
if (EMBED) document.documentElement.classList.add('embed');

/** A moniker for the command line: lower-case letters, digits and dashes only. */
function clean(v) { return (v || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'my-node'; }
/** A whole number of ZTPHY to stake (at least 1). */
function amount(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 1e12 ? n : 100; }
function render() {
  $('cmd').textContent = `${base}${clean($('moniker').value)} bash -s -- validator`;
  $('stake-cmd').textContent = `sudo zetaphy-validator stake ${amount($('stake-amt').value)}`;
}
function apply(l) {
  L = l;
  const t = T[l];
  document.documentElement.lang = l === 'zh' ? 'zh-Hans' : l;
  document.title = t.title;
  $('lang').value = l;
  document.querySelectorAll('[data-t]').forEach((el) => { el.innerHTML = t[el.dataset.t] ?? T.en[el.dataset.t] ?? ''; });
  document.querySelectorAll('.copied').forEach((el) => { el.textContent = ''; });
}
$('lang').addEventListener('change', (e) => { const l = LANGS.includes(e.target.value) ? e.target.value : 'en'; try { localStorage.setItem('zetaphy-join-lang', l); } catch (err) { /* private mode */ } apply(l); });
$('moniker').addEventListener('input', render);
$('stake-amt').addEventListener('input', render);

function copy(pre, out) {
  const text = $(pre).textContent;
  const done = () => { $(out).textContent = T[L].copied; setTimeout(() => { $(out).textContent = ''; }, 2500); };
  const fallback = () => { const r = document.createRange(); r.selectNodeContents($(pre)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $(out).textContent = T[L].selected; };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
}
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, `copied-${b.dataset.copy}`)));

// Topics as tabs (role=tablist): the open one is in the URL hash (#start, #stake, #check, #fix, #keys, #advanced), so
// links work; arrow keys, Home and End move between tabs. Old links (#get, #resume, #rewards) open their new place.
const TABS = [...document.querySelectorAll('#vtabs [role="tab"]')];
const ALIAS = { get: 'stake', resume: 'fix', rewards: 'stake', earn: 'stake', faq: 'advanced', more: 'advanced' };
function showTab(key, { focus = false, hash = true } = {}) {
  const t = TABS.find((b) => b.dataset.tab === key) || TABS[0];
  for (const b of TABS) {
    const on = b === t;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(`p-${b.dataset.tab}`).hidden = !on;
  }
  if (focus) t.focus();
  if (hash && location.hash !== `#${t.dataset.tab}`) history.replaceState(null, '', `#${t.dataset.tab}`);
}
function fromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) { showTab('start', { hash: false }); return; }
  const key = ALIAS[h] || h;
  if (TABS.some((b) => b.dataset.tab === key)) { showTab(key, { hash: false }); return; }
  const el = document.getElementById(h);
  const panel = el && el.closest('[role="tabpanel"]');
  if (panel) { showTab(panel.id.slice(2), { hash: false }); el.scrollIntoView(); } else showTab('start', { hash: false });
}
TABS.forEach((b, i) => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
  b.addEventListener('keydown', (e) => {
    const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (n === undefined) return;
    e.preventDefault();
    showTab(TABS[(n + TABS.length) % TABS.length].dataset.tab, { focus: true });
  });
});
window.addEventListener('hashchange', fromHash);
fromHash();
render();
apply(L);

// Inside the hub (?embed): the frame has no scrollbar of its own. The guide tells the hub (same origin only) its
// height whenever it changes (a tab, the width), and the hub sizes the frame to it.
if (EMBED && window.parent !== window) {
  let last = 0;
  const post = () => {
    const h = Math.ceil(document.body.getBoundingClientRect().height);
    if (h && h !== last) { last = h; window.parent.postMessage({ zetaphyGuideHeight: h }, location.origin); }
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(post).observe(document.body);
  window.addEventListener('load', post);
  post();
}
