// Solana side of wallet-safety.js for this page: what a transaction about to be signed does, read from
// the transaction itself (legacy Transaction or VersionedTransaction, @solana/web3.js shapes), so the
// page can show a summary before the wallet does: the programs it calls, the SOL it sends out of the
// connected account (System transfers / account creation), SPL token approvals (an unlimited one is
// warned about), and the instructions that hand the wallet or its token accounts to someone else
// (System Assign, SPL SetAuthority / CloseAccount to another address, SPL transfers signed by the owner)
// or that hide accounts in address lookup tables.
// No dependencies; tests/sol-safety.test.mjs checks it.

export const PROGRAMS = {
  '11111111111111111111111111111111': 'System',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token',
  ComputeBudget111111111111111111111111111111: 'Compute Budget',
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: 'Metaplex Metadata',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
};
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const SYSTEM = '11111111111111111111111111111111';

// Warnings this module adds on top of wallet-safety-i18n.js (that file is a synced copy of
// zetaphy-hub/, so these live here): English, Thai; other languages fall back to English.
const SOL_TEXT = {
  en: {
    cfSolAssign: 'DANGER: this gives your wallet account to the program {program}. It could then take all your SOL. No swap or liquidity action needs this.',
    cfSplAuthority: 'DANGER: this hands control of token account {account} to {to}.',
    cfSplClose: 'Closes token account {account} and sends its SOL to {to}, not to you.',
    cfSplTransfer: 'Sends {amount} (base units) of a token from your account {account} to {to}.',
    cfSolLookup: 'Part of this transaction uses address lookup tables: some accounts are not shown here. Check them in your wallet.',
  },
  th: {
    cfSolAssign: 'อันตราย: รายการนี้ยกบัญชีกระเป๋าของคุณให้โปรแกรม {program} ซึ่งจะเอา SOL ของคุณไปได้ทั้งหมด การสวอปหรือเพิ่มสภาพคล่องไม่จำเป็นต้องทำแบบนี้',
    cfSplAuthority: 'อันตราย: รายการนี้ยกสิทธิ์ควบคุมบัญชีโทเคน {account} ให้ {to}',
    cfSplClose: 'ปิดบัญชีโทเคน {account} และส่ง SOL ในบัญชีนั้นไปที่ {to} ไม่ใช่ให้คุณ',
    cfSplTransfer: 'ส่งโทเคน {amount} (หน่วยย่อย) จากบัญชี {account} ของคุณไปที่ {to}',
    cfSolLookup: 'บางส่วนของรายการนี้ใช้ address lookup table จึงแสดงบัญชีบางบัญชีที่นี่ไม่ได้ โปรดตรวจในกระเป๋าของคุณ',
  },
};
const solText = (lang, key, vars = {}) => (SOL_TEXT[lang]?.[key] ?? SOL_TEXT.en[key]).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
/** A token approval at or above this (2^63 base units) counts as unlimited (u64::MAX is the usual one). */
export const SPL_UNLIMITED_MIN = 1n << 63n;

const b58 = (k) => (typeof k === 'string' ? k : typeof k?.toBase58 === 'function' ? k.toBase58() : String(k ?? ''));
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** raw 32 bytes (a pubkey inside instruction data) -> base58 */
const b58bytes = (u8) => {
  let n = 0n;
  for (const x of u8) n = (n << 8n) | BigInt(x);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const x of u8) { if (x !== 0) break; out = '1' + out; }
  return out;
};
const bytes = (d) => (d instanceof Uint8Array ? d : Array.isArray(d) ? Uint8Array.from(d) : new Uint8Array(0));
const u64 = (d, at) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i] ?? 0); return v; };
const u32 = (d, at) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;

/** The instructions of a transaction as { programId, data, accounts } (base58 strings, bytes). */
export function instructionsOf(tx) {
  try {
    if (Array.isArray(tx?.instructions)) {
      return tx.instructions.map((ix) => ({ programId: b58(ix.programId), data: bytes(ix.data), accounts: (ix.keys ?? []).map((k) => b58(k.pubkey)) }));
    }
    const m = tx?.message;
    const keys = (m?.staticAccountKeys ?? m?.accountKeys ?? []).map(b58);
    const list = m?.compiledInstructions ?? m?.instructions ?? [];
    return list.map((ix) => ({
      programId: keys[ix.programIdIndex] ?? '?',
      data: bytes(ix.data),
      accounts: (ix.accountKeyIndexes ?? ix.accounts ?? []).map((i) => keys[i] ?? '?'),
    }));
  } catch { return []; }
}

/** true when a (v0) transaction loads accounts from address lookup tables (they are not in the message itself). */
export function usesLookupTables(tx) {
  try { return (tx?.message?.addressTableLookups ?? []).length > 0; } catch { return false; }
}

/**
 * What a list of transactions does for `owner` (base58).
 * @returns {{ txs: number, instructions: number, programs: string[], solOut: bigint, approvals: Array<{delegate:string, amount:bigint, unlimited:boolean}>,
 *   assigns: Array<{program:string}>, authorities: Array<{account:string, to:string}>, closes: Array<{account:string, to:string}>,
 *   tokenOut: Array<{account:string, to:string, amount:bigint}>, lookupTables: boolean }}
 */
export function solTxInfo(txs, owner, labels = {}) {
  const list = (Array.isArray(txs) ? txs : [txs]).filter(Boolean);
  const names = { ...PROGRAMS, ...labels };
  const programs = [];
  let instructions = 0;
  let solOut = 0n;
  const approvals = [];
  // Instructions that hand over the wallet or its token accounts, or move tokens out (an AMM swap or
  // liquidity call never needs any of these at the top level: the program does its transfers by CPI).
  const assigns = [];      // { program }        System Assign of the owner's account
  const authorities = [];  // { account, to }    SPL SetAuthority signed by the owner
  const closes = [];       // { account, to }    SPL CloseAccount by the owner to someone else
  const tokenOut = [];     // { account, to, amount }  SPL Transfer / TransferChecked signed by the owner
  let lookupTables = false;
  for (const tx of list) {
    if (usesLookupTables(tx)) lookupTables = true;
    for (const ix of instructionsOf(tx)) {
      instructions++;
      const name = names[ix.programId] ? `${names[ix.programId]} (${ix.programId})` : ix.programId;
      if (!programs.includes(name)) programs.push(name);
      const d = ix.data;
      // System Program Transfer: u32 index 2, u64 lamports; account 0 pays
      if (ix.programId === SYSTEM && d.length >= 4) {
        const kind = u32(d, 0);
        // Transfer (2) / CreateAccount (0): u64 lamports at 4, account 0 pays
        if ((kind === 2 || kind === 0) && d.length >= 12 && ix.accounts[0] === owner) solOut += u64(d, 4);
        // TransferWithSeed (11): u64 lamports at 4; accounts: from (derived), base (signer), to
        if (kind === 11 && d.length >= 12 && ix.accounts[1] === owner) solOut += u64(d, 4);
        // CreateAccountWithSeed (3): base pubkey(32), seed (u64 len + bytes), lamports u64, space u64, owner(32); account 0 pays
        if (kind === 3 && d.length >= 44 && ix.accounts[0] === owner) {
          const seedLen = Number(u64(d, 36));
          if (seedLen <= 32 && d.length >= 44 + seedLen + 8) solOut += u64(d, 44 + seedLen);
        }
        // Assign (1) / AssignWithSeed (10): the owner's own account gets a new owner program
        if (kind === 1 && d.length >= 36 && ix.accounts[0] === owner) assigns.push({ program: b58bytes(d.subarray(4, 36)) });
        if (kind === 10 && ix.accounts[1] === owner) assigns.push({ program: '?' });
      }
      // SPL Token Approve (4) / ApproveChecked (13): u64 amount at 1; accounts: source, delegate, owner
      if (TOKEN_PROGRAMS.has(ix.programId) && d.length >= 9 && (d[0] === 4 || d[0] === 13)) {
        const amount = u64(d, 1);
        approvals.push({ delegate: ix.accounts[1] ?? '?', amount, unlimited: amount >= SPL_UNLIMITED_MIN });
      }
      if (TOKEN_PROGRAMS.has(ix.programId) && d.length >= 1) {
        const a = ix.accounts;
        // SetAuthority (6): accounts account, current authority; data: type u8, Option<Pubkey>
        if (d[0] === 6 && a[1] === owner) authorities.push({ account: a[0] ?? '?', to: d.length >= 35 && d[2] === 1 ? b58bytes(d.subarray(3, 35)) : '-' });
        // CloseAccount (9): accounts account, destination, owner
        if (d[0] === 9 && a[2] === owner && a[1] !== owner) closes.push({ account: a[0] ?? '?', to: a[1] ?? '?' });
        // Transfer (3): source, destination, authority; TransferChecked (12): source, mint, destination, authority
        if (d[0] === 3 && d.length >= 9 && a[2] === owner) tokenOut.push({ account: a[0] ?? '?', to: a[1] ?? '?', amount: u64(d, 1) });
        if (d[0] === 12 && d.length >= 9 && a[3] === owner) tokenOut.push({ account: a[0] ?? '?', to: a[2] ?? '?', amount: u64(d, 1) });
      }
    }
  }
  return { txs: list.length, instructions, programs, solOut, approvals, assigns, authorities, closes, tokenOut, lookupTables };
}

/**
 * Shows the summary (wallet-safety.js confirmTx) for transactions about to be signed by `owner`.
 * Resolves true to go on to the wallet, false when the user cancels.
 */
export async function confirmSolana(sf, { network, owner, txs, labels, lang = 'en' }) {
  const info = solTxInfo(txs, owner, labels);
  const short = (a) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);
  const st = (key, vars) => solText(lang, key, vars);
  const warnings = [
    ...info.assigns.map((a) => st('cfSolAssign', { program: short(a.program) })),
    ...info.authorities.map((a) => st('cfSplAuthority', { account: short(a.account), to: short(a.to) })),
    ...info.closes.map((a) => st('cfSplClose', { account: short(a.account), to: short(a.to) })),
    ...info.tokenOut.map((a) => st('cfSplTransfer', { account: short(a.account), to: short(a.to), amount: a.amount.toString() })),
    ...info.approvals.map((a) => (a.unlimited
      ? sf.t('cfSplUnlimited', { delegate: short(a.delegate) })
      : sf.t('cfSplApprove', { delegate: short(a.delegate), amount: a.amount.toString() }))),
    ...(info.lookupTables ? [st('cfSolLookup')] : []),
  ];
  const r = await sf.confirmTx({
    network, from: owner, to: '', value: info.solOut, decimals: 9, symbol: 'SOL',
    action: sf.t('cfSolAction', { tx: info.txs, ix: info.instructions }),
    details: [[sf.t('cfPrograms'), info.programs.join(', ')]],
    warnings,
  });
  return r != null;
}
