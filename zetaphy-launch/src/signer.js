// Mainnet signers: the deployer's private key is never in a plain file, an environment variable or argv.
//   --keystore <file>        an Ethereum keystore JSON (scrypt), decrypted in memory only; the passphrase is asked on
//                            the terminal (no echo), or read from standard input with --passphrase-stdin (e.g. piped
//                            from a password manager). ZETAPHY_PASSPHRASE is not read on mainnet.
//   --remote-signer <url>    an external signer that holds the key (a hardware wallet behind clef, web3signer, Frame):
//                            every transaction is built here and sent to it with eth_signTransaction (or clef's
//                            account_signTransaction, --signer-method), and the signed transaction it returns is
//                            checked field by field against what was asked before it is broadcast.
//   --signer-address 0x…     the deployer address the remote signer signs for (required with --remote-signer)
// The dry run never needs the key: the address comes from the keystore's "address" field or --signer-address.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { AbstractSigner, Transaction, Wallet, getAddress, isAddress, toQuantity, resolveAddress } from 'ethers';

/** Refuses a file that other users may read (as the testnet key loader does). */
function privateFile(file, what) {
  if (!existsSync(file)) throw new Error(`${what}: no file at ${file}`);
  const st = statSync(file);
  if (process.platform !== 'win32' && (st.mode & 0o077)) throw new Error(`${file} can be read by other users (mode ${(st.mode & 0o777).toString(8)}): chmod 600 it`);
}

/** The keystore's JSON and its address, without decrypting it. A plain key (hex) is refused. */
export function readKeystore(file) {
  privateFile(file, '--keystore');
  const text = readFileSync(file, 'utf8').trim();
  if (!text.startsWith('{')) throw new Error(`${file} is not an encrypted keystore JSON: a plain private key is refused on mainnet (make a keystore: zetaphy keys encrypt, or geth/cast wallet import)`);
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`${file}: not JSON (an Ethereum keystore expected)`); }
  const c = j.crypto ?? j.Crypto;
  if (!c || !c.ciphertext || !c.kdf || !['scrypt', 'pbkdf2'].includes(String(c.kdf).toLowerCase())) throw new Error(`${file}: not an Ethereum keystore (crypto.kdf scrypt or pbkdf2 expected)`);
  if (!j.address || !isAddress('0x' + String(j.address).replace(/^0x/i, ''))) throw new Error(`${file}: the keystore has no address field`);
  return { json: text, address: getAddress('0x' + String(j.address).replace(/^0x/i, '')) };
}

/** The passphrase: from standard input (one line) with fromStdin, else asked on the terminal without echo. */
export async function readPassphrase({ fromStdin = false, input = process.stdin, output = process.stderr, prompt = 'keystore passphrase: ' } = {}) {
  if (fromStdin) {
    const chunks = [];
    for await (const c of input) chunks.push(Buffer.from(c));
    const line = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
    if (!line) throw new Error('--passphrase-stdin: no passphrase on standard input');
    return line;
  }
  if (!input.isTTY) throw new Error('no terminal to ask the keystore passphrase on: run it in a terminal, or pipe it with --passphrase-stdin');
  return new Promise((resolve, reject) => {
    output.write(prompt);
    let s = '';
    input.setRawMode(true);
    input.resume();
    const done = (err) => { input.setRawMode(false); input.pause(); input.off('data', on); output.write('\n'); err ? reject(err) : resolve(s); };
    const on = (d) => {
      for (const ch of String(d)) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1); else s += ch;
      }
    };
    input.on('data', on);
  });
}

/** A Wallet from the keystore (in memory only), connected to provider. */
export async function keystoreSigner({ json, address }, passphrase, provider) {
  let w;
  try { w = await Wallet.fromEncryptedJson(json, passphrase); } catch { throw new Error('the keystore passphrase is wrong'); }
  if (getAddress(w.address) !== address) throw new Error(`the keystore decrypts to ${w.address}, not its address field ${address}`);
  return w.connect(provider);
}

const isLoopbackHost = (h) => h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);

/** --remote-signer: https, or http on this machine only (the signer's own port, e.g. clef 127.0.0.1:8550). */
export function checkSignerUrl(u) {
  let url;
  try { url = new URL(String(u)); } catch { throw new Error('--remote-signer: not a URL'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(host))) throw new Error('--remote-signer: https://, or http:// on 127.0.0.1 / localhost only');
  if (url.username || url.password) throw new Error('--remote-signer: no user name or password in the URL');
  return String(u);
}

let rpcId = 0;
async function jsonRpc(url, method, params, fetchImpl = fetch) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  if (!res.ok) throw new Error(`remote signer: HTTP ${res.status} for ${method}`);
  const j = await res.json();
  if (j.error) throw new Error(`remote signer refused ${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.result;
}

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/**
 * Checks the signed transaction the remote signer returned is exactly the one that was asked for (a signer that
 * changes the destination, the data, the value, the nonce, the chain or raises the fees is refused). Returns it.
 */
export function checkSigned(raw, want, { address, chainId }) {
  let t;
  try { t = Transaction.from(raw); } catch { throw new Error('remote signer: the answer is not a signed transaction'); }
  const p = [];
  if (!t.signature || !t.from || !same(t.from, address)) p.push(`signed by ${t.from ?? 'nobody'}, not ${address}`);
  if (t.chainId !== BigInt(chainId)) p.push(`chain id ${t.chainId}, not ${chainId}`);
  if (!same(t.to, want.to ?? null)) p.push(`to ${t.to}, not ${want.to ?? '(contract creation)'}`);
  if (String(t.data).toLowerCase() !== String(want.data ?? '0x').toLowerCase()) p.push('other calldata');
  if (t.value !== BigInt(want.value ?? 0)) p.push(`value ${t.value}, not ${want.value ?? 0}`);
  if (t.nonce !== Number(want.nonce)) p.push(`nonce ${t.nonce}, not ${want.nonce}`);
  if (t.gasLimit !== BigInt(want.gasLimit)) p.push(`gas limit ${t.gasLimit}, not ${want.gasLimit}`);
  const fee = (x) => BigInt(x ?? 0);
  if (want.maxFeePerGas != null) {
    if (fee(t.maxFeePerGas) > fee(want.maxFeePerGas) || fee(t.maxPriorityFeePerGas) > fee(want.maxPriorityFeePerGas)) p.push('higher fees than asked');
  } else if (fee(t.gasPrice) > fee(want.gasPrice)) p.push('a higher gas price than asked');
  if (p.length) throw new Error(`remote signer: the signed transaction is not the one asked for (${p.join('; ')}): refused, nothing sent`);
  return t.serialized;
}

/** An ethers signer whose key lives in an external signer reached over JSON-RPC. */
export class RemoteSigner extends AbstractSigner {
  constructor(url, address, provider, { chainId, method = 'eth_signTransaction', fetchImpl = fetch } = {}) {
    super(provider);
    if (!['eth_signTransaction', 'account_signTransaction'].includes(method)) throw new Error('--signer-method: eth_signTransaction or account_signTransaction (clef)');
    this.url = checkSignerUrl(url);
    this.address = getAddress(address);
    this.chainId = BigInt(chainId);
    this.method = method;
    this.fetchImpl = fetchImpl;
  }

  async getAddress() { return this.address; }

  connect(provider) { return new RemoteSigner(this.url, this.address, provider, { chainId: this.chainId, method: this.method, fetchImpl: this.fetchImpl }); }

  /** Does the signer say it holds the address? (eth_accounts / account_list; a signer without either is not refused.) */
  async holds() {
    try {
      const list = await jsonRpc(this.url, this.method === 'account_signTransaction' ? 'account_list' : 'eth_accounts', [], this.fetchImpl);
      return Array.isArray(list) ? list.some((a) => same(a, this.address)) : null;
    } catch { return null; }
  }

  async signTransaction(tx) {
    // read field by field: an ethers Transaction keeps its fields behind getters (a spread copies none)
    const want = {};
    for (const k of ['to', 'from', 'data', 'value', 'nonce', 'gasLimit', 'chainId', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'type']) if (tx[k] != null) want[k] = tx[k];
    if (want.type === 2 || want.maxFeePerGas != null) delete want.gasPrice;
    if (want.to != null) want.to = getAddress(await resolveAddress(want.to, this.provider));
    if (want.from != null && !same(await resolveAddress(want.from, this.provider), this.address)) throw new Error('remote signer: a transaction from another address');
    if (want.chainId != null && BigInt(want.chainId) !== this.chainId) throw new Error(`remote signer: chain id ${want.chainId}, not ${this.chainId}`);
    for (const k of ['nonce', 'gasLimit']) if (want[k] == null) throw new Error(`remote signer: the transaction has no ${k}`);
    const q = (v) => (v == null ? undefined : toQuantity(v));
    const req = {
      from: this.address, to: want.to ?? undefined, data: want.data ?? '0x', value: q(want.value ?? 0), nonce: q(want.nonce), gas: q(want.gasLimit), chainId: q(this.chainId),
      ...(want.maxFeePerGas != null ? { maxFeePerGas: q(want.maxFeePerGas), maxPriorityFeePerGas: q(want.maxPriorityFeePerGas ?? 0), type: '0x2' } : { gasPrice: q(want.gasPrice), type: '0x0' }),
    };
    if (this.method === 'account_signTransaction') req.input = req.data; // clef names the calldata "input"
    const r = await jsonRpc(this.url, this.method, [req], this.fetchImpl);
    const raw = typeof r === 'string' ? r : r?.raw;
    if (typeof raw !== 'string') throw new Error('remote signer: no signed transaction in the answer');
    return checkSigned(raw, want, { address: this.address, chainId: this.chainId });
  }

  async signMessage() { throw new Error('remote signer: the launch signs transactions only'); }

  async signTypedData() { throw new Error('remote signer: the launch signs transactions only'); }
}
