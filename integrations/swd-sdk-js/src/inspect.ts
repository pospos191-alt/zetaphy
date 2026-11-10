// Reads an unsigned Solana transaction (legacy or v0, wire format) WITHOUT any dependency, and says what it does to
// one account: the programs it calls, the SOL that leaves the account, and the instructions that could hand the
// account (or its tokens) to someone else. buySwdTransaction runs it on every transaction the server sends, so a
// compromised or impersonated server (or a wrong SWD_API_BASE) cannot slip an extra instruction past the caller.
//
// What it cannot see: what a program does inside (CPI). That is why the default policy also refuses programs it
// does not know; a wallet's own simulation is still the last check before signing.

export const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: "Memo (v1)",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
};
const SYSTEM = "11111111111111111111111111111111";
const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
/** account index that comes from an address lookup table (not resolvable offline) */
export const LOOKUP = "(lookup table)";

export interface DecodedInstruction {
  programId: string;
  accounts: string[];
  data: Uint8Array;
}
export interface DecodedTransaction {
  version: "legacy" | 0;
  /** signatures in the wire format (all zero when unsigned) */
  signatures: Uint8Array[];
  numRequiredSignatures: number;
  staticKeys: string[];
  /** keys[0]: pays the fee and must sign */
  feePayer: string;
  /** the accounts that must sign (the first numRequiredSignatures keys) */
  signers: string[];
  recentBlockhash: string;
  instructions: DecodedInstruction[];
  lookupTables: { account: string; writable: number[]; readonly: number[] }[];
}

export interface TxInspection {
  feePayer: string;
  signers: string[];
  programs: string[];
  unknownPrograms: string[];
  /** lamports leaving `account` through top-level System instructions (Transfer, CreateAccount, ...) */
  solOutLamports: bigint;
  /** reasons the transaction is not safe to sign for `account` (empty = no problem found) */
  problems: string[];
  usesLookupTables: boolean;
}

export interface InspectPolicy {
  /** extra program ids allowed at the top level (default: KNOWN_PROGRAMS only) */
  allowPrograms?: string[];
  /** the most SOL (lamports) the transaction may move out of the account (default: no limit) */
  maxSolOutLamports?: bigint;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

class Reader {
  o = 0;
  constructor(private b: Uint8Array) {}
  u8(): number {
    if (this.o >= this.b.length) throw new Error("truncated transaction");
    return this.b[this.o++];
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.o + n > this.b.length) throw new Error("truncated transaction");
    const out = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return out;
  }
  /** compact-u16 (shortvec) */
  len(): number {
    let v = 0;
    for (let i = 0; i < 3; i++) {
      const x = this.u8();
      v |= (x & 0x7f) << (7 * i);
      if (!(x & 0x80)) return v;
    }
    throw new Error("bad length");
  }
  done(): boolean {
    return this.o === this.b.length;
  }
}

/** Wire-format transaction → its parts. Throws on anything malformed (truncated, trailing bytes, bad indexes). */
export function decodeTransaction(bytes: Uint8Array): DecodedTransaction {
  const r = new Reader(bytes);
  const nsig = r.len();
  if (nsig < 1 || nsig > 64) throw new Error("bad signature count");
  const signatures = Array.from({ length: nsig }, () => r.bytes(64));
  let version: "legacy" | 0 = "legacy";
  let first = r.u8();
  if (first & 0x80) {
    if ((first & 0x7f) !== 0) throw new Error(`unsupported transaction version ${first & 0x7f}`);
    version = 0;
    first = r.u8();
  }
  const numRequiredSignatures = first;
  r.u8(); // read-only signed
  r.u8(); // read-only unsigned
  const nkeys = r.len();
  if (nkeys < 1) throw new Error("no account keys");
  const staticKeys = Array.from({ length: nkeys }, () => base58(r.bytes(32)));
  if (numRequiredSignatures < 1 || numRequiredSignatures > nkeys || numRequiredSignatures !== nsig) throw new Error("bad signer count");
  const recentBlockhash = base58(r.bytes(32));
  const raw = Array.from({ length: r.len() }, () => {
    const programIdIndex = r.u8();
    const idx = Array.from({ length: r.len() }, () => r.u8());
    const data = r.bytes(r.len());
    return { programIdIndex, idx, data };
  });
  const lookupTables: DecodedTransaction["lookupTables"] = [];
  if (version === 0) {
    const n = r.len();
    for (let i = 0; i < n; i++) {
      const account = base58(r.bytes(32));
      const writable = Array.from({ length: r.len() }, () => r.u8());
      const readonly = Array.from({ length: r.len() }, () => r.u8());
      lookupTables.push({ account, writable, readonly });
    }
  }
  if (!r.done()) throw new Error("trailing bytes after the transaction");
  const loaded = lookupTables.reduce((n, t) => n + t.writable.length + t.readonly.length, 0);
  const key = (i: number) => {
    if (i < staticKeys.length) return staticKeys[i];
    if (i < staticKeys.length + loaded) return LOOKUP;
    throw new Error("account index out of range");
  };
  const instructions = raw.map(({ programIdIndex, idx, data }) => {
    // a program id can't come from a lookup table
    if (programIdIndex >= staticKeys.length) throw new Error("program id index out of range");
    return { programId: staticKeys[programIdIndex], accounts: idx.map(key), data };
  });
  return {
    version,
    signatures,
    numRequiredSignatures,
    staticKeys,
    feePayer: staticKeys[0],
    signers: staticKeys.slice(0, numRequiredSignatures),
    recentBlockhash,
    instructions,
    lookupTables,
  };
}

const u32 = (d: Uint8Array, at: number) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;
const u64 = (d: Uint8Array, at: number) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i] ?? 0);
  return v;
};

/** What a transaction does to `account` (base58), checked against `policy`. Never throws on a well-formed transaction. */
export function inspectTransaction(tx: DecodedTransaction, account: string, policy: InspectPolicy = {}): TxInspection {
  const problems: string[] = [];
  const allowed = new Set([...Object.keys(KNOWN_PROGRAMS), ...(policy.allowPrograms ?? [])]);
  const programs: string[] = [];
  let solOut = 0n;
  if (tx.feePayer !== account) problems.push(`the fee payer is ${tx.feePayer}, not ${account}`);
  const others = tx.signers.filter((s) => s !== account);
  if (others.length) problems.push(`other signers are required: ${others.join(", ")}`);
  for (const sig of tx.signatures) if (sig.some((b) => b !== 0)) problems.push("the transaction arrived already (partly) signed");
  for (const ix of tx.instructions) {
    if (!programs.includes(ix.programId)) programs.push(ix.programId);
    const d = ix.data;
    const a = ix.accounts;
    if (ix.programId === SYSTEM && d.length >= 4) {
      const kind = u32(d, 0);
      if ((kind === 0 || kind === 2) && d.length >= 12 && a[0] === account) solOut += u64(d, 4); // CreateAccount, Transfer
      if (kind === 11 && d.length >= 12 && a[1] === account) solOut += u64(d, 4); // TransferWithSeed
      if (kind === 3 && d.length >= 44 && a[0] === account) {
        // CreateAccountWithSeed: base(32), seed (u64 len + bytes), lamports u64, ...
        const seedLen = Number(u64(d, 36));
        if (seedLen <= 32 && d.length >= 44 + seedLen + 8) solOut += u64(d, 44 + seedLen);
        else problems.push("unreadable CreateAccountWithSeed");
      }
      if ((kind === 1 && a[0] === account) || (kind === 10 && a[1] === account)) problems.push("System Assign: gives the wallet account to another program");
      if ((kind === 8 && a[0] === account) || (kind === 9 && a[1] === account)) problems.push("System Allocate on the wallet account");
      if (kind === 4 || kind === 7) problems.push("nonce account instruction (a transaction that never expires)");
    }
    if (TOKEN_PROGRAMS.has(ix.programId) && d.length >= 1) {
      // owner/authority position per instruction (see spl-token instruction.rs)
      const auth: Record<number, number> = { 3: 2, 4: 2, 5: 1, 6: 1, 8: 2, 9: 2, 12: 3, 13: 3, 15: 2 };
      const who = auth[d[0]];
      if (who !== undefined && a[who] === account) {
        if (d[0] === 4 || d[0] === 13) problems.push(`SPL Approve: lets ${d[0] === 4 ? a[1] : a[2]} move your tokens`);
        if (d[0] === 6) problems.push("SPL SetAuthority: hands a token account (or mint) of yours to someone else");
        if (d[0] === 3 || d[0] === 12) problems.push(`SPL transfer of your tokens to ${d[0] === 3 ? a[1] : a[2]}`);
        if (d[0] === 8 || d[0] === 15) problems.push("SPL Burn of your tokens");
        if (d[0] === 9 && a[1] !== account) problems.push(`SPL CloseAccount sends the account's SOL to ${a[1]}`);
      }
    }
  }
  const unknownPrograms = programs.filter((p) => !allowed.has(p));
  if (unknownPrograms.length) problems.push(`unknown programs: ${unknownPrograms.join(", ")}`);
  if (policy.maxSolOutLamports !== undefined && solOut > policy.maxSolOutLamports)
    problems.push(`moves ${solOut} lamports out of the account, more than the ${policy.maxSolOutLamports} allowed`);
  return {
    feePayer: tx.feePayer,
    signers: tx.signers,
    programs,
    unknownPrograms,
    solOutLamports: solOut,
    problems,
    usesLookupTables: tx.lookupTables.length > 0,
  };
}
