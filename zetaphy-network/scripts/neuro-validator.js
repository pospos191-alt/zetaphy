#!/usr/bin/env node
// The Neuro validator (src/neurovalidator.js, docs/SAPHAN-NEURO-VALIDATOR.md): the second signer of Saphan's
// ZETAPHY -> BSC / Base messages, run on a machine that is NOT the sentry (another cloud, another key). It signs a
// message only when every check passes, and writes the signed checkpoints where Hyperlane's relayer reads them.
//
//   node scripts/neuro-validator.js keygen --key /etc/neuro-validator/key       [เปลี่ยนไฟล์] a new key, on THIS machine (0600)
//   node scripts/neuro-validator.js address --key …                              [อ่าน] the validator address
//   node scripts/neuro-validator.js announce --key … --location gs://BUCKET/neuro [--send yes]   [เปลี่ยนเชน] ValidatorAnnounce
//   node scripts/neuro-validator.js run --key … --location gs://BUCKET/neuro --state /var/lib/neuro-validator/state.json [--once]
//
// --location: gs://bucket/folder (written with the machine's own Google service account, objects public-read through
// the bucket's IAM) or file:///dir (tests, local). env ZETAPHY_RPC overrides the config's RPC list.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Wallet, Contract, Interface, JsonRpcProvider, getAddress, hashMessage, parseEther } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import { MerkleTree, EVENTS, decodeMessage, decide, signedCheckpoint, announcement } from '../src/neurovalidator.js';

const HOOK = ['function root() view returns (bytes32)', 'function count() view returns (uint32)'];
const VA = ['function announce(address validator, string storageLocation, bytes signature) returns (bool)', 'function getAnnouncementDigest(string storageLocation) view returns (bytes32)',
  'function getAnnouncedStorageLocations(address[] validators) view returns (string[][])'];
const THREATS = new Interface(['function isContractHeld(address who) view returns (bool, uint8)']);
const T = (s) => new Date().toISOString().slice(0, 19) + 'Z ' + s;

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(argv[i]);
  return o;
}

/** Everything the validator needs from the committed config: core addresses, routes, threat registry. */
export function setup({ cfg = M.loadMainnet(), state = M.loadState(), core = M.loadCore() } = {}) {
  if (!core?.mailbox || !core?.merkleTreeHook || !core?.validatorAnnounce) throw new Error('no Hyperlane core on ZETAPHY in the registry');
  const routes = M.routeNames(cfg).map((n) => [n, M.deployedRoute(cfg, state, n), M.route(cfg, n)]).filter(([, d]) => d)
    .map(([name, d, R]) => ({ name, vault: getAddress(d.vault), synthetic: getAddress(d.synthetic), domain: R.domain, chainId: R.chainId, mintDailyLimit: parseEther(String(R.limits.mintDailyLimit)) }));
  return { origin: cfg.zetaphy.domain, rpc: cfg.zetaphy.rpc, mailbox: getAddress(core.mailbox), merkleTreeHook: getAddress(core.merkleTreeHook), validatorAnnounce: getAddress(core.validatorAnnounce),
    threats: cfg.zetaphy.threats ? getAddress(cfg.zetaphy.threats) : null, routes };
}

/** Storage: gs://bucket/folder (GCS JSON API with the VM's metadata token) or file:///dir. */
export function storage(location, { fetchImpl = fetch } = {}) {
  if (location.startsWith('file://')) {
    const dir = location.slice('file://'.length);
    return { write: async (name, body) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name) + '.tmp', body); renameSync(join(dir, name) + '.tmp', join(dir, name)); } };
  }
  const m = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])(?:\/(.+?))?\/?$/.exec(location);
  if (!m) throw new Error('--location: gs://bucket/folder or file:///dir');
  const [, bucket, folder] = m;
  let tok = null, until = 0;
  const token = async () => {
    if (tok && Date.now() < until) return tok;
    const r = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    if (!r.ok) throw new Error(`metadata token: HTTP ${r.status} (run this on the GCP VM, whose service account may write the bucket)`);
    const j = await r.json(); tok = j.access_token; until = Date.now() + (j.expires_in - 60) * 1000; return tok;
  };
  return {
    write: async (name, body) => {
      const obj = folder ? `${folder}/${name}` : name;
      const meta = JSON.stringify({ name: obj, cacheControl: 'no-store', contentType: 'application/json' });
      const b = 'neuro-validator-part';
      const data = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
      const r = await fetchImpl(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=multipart`, { method: 'POST', body: data,
        headers: { authorization: `Bearer ${await token()}`, 'content-type': `multipart/related; boundary=${b}` } });
      if (!r.ok) throw new Error(`gs://${bucket}/${obj}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    },
  };
}

function loadKey(path) {
  if (!path || !existsSync(path)) throw new Error(`--key: no key file ${path ?? ''} (keygen makes one)`);
  return new Wallet(readFileSync(path, 'utf8').trim());
}

/**
 * One pass: every leaf the hook inserted since the last pass, rebuilt into the tree and checked against the hook's own
 * root and count at the same block, then each new (and each waiting) message decided and, if it passes, signed and
 * written. Returns { state, signed: [index], refused: [{index, reason}], waiting: [index] }.
 */
export async function pass({ p, conf, wallet, store, state, log = () => {}, chunk = 5000, confirmations = 1 }) {
  const st = state ?? { tree: null, next: 0, waiting: [], latest: -1 };
  const head = (await p.getBlockNumber()) - confirmations;
  const tree = new MerkleTree(st.tree);
  const fromBlock = st.next;
  const fresh = [];
  for (let a = fromBlock; a <= head; a += chunk) {
    const b = Math.min(head, a + chunk - 1);
    const logs = await p.getLogs({ address: conf.merkleTreeHook, topics: [EVENTS.getEvent('InsertedIntoTree').topicHash], fromBlock: a, toBlock: b });
    for (const lg of logs) {
      const ev = EVENTS.parseLog(lg);
      const index = Number(ev.args.index);
      if (index !== tree.count) throw new Error(`leaf ${index} where ${tree.count} was expected: the hook's events are not contiguous; nothing signed`);
      tree.insert(ev.args.messageId);
      fresh.push({ index, messageId: ev.args.messageId, root: tree.root(), tx: lg.transactionHash });
    }
  }
  // the tree must be the hook's own tree at `head`
  const hook = new Contract(conf.merkleTreeHook, HOOK, p);
  const [r, c] = await Promise.all([hook.root({ blockTag: head }), hook.count({ blockTag: head })]);
  if (Number(c) !== tree.count || r.toLowerCase() !== tree.root().toLowerCase()) throw new Error(`the rebuilt tree (count ${tree.count}, root ${tree.root()}) is not the hook's (count ${c}, root ${r}) at block ${head}; nothing signed`);
  const signed = [], refused = [], waiting = [];
  const todo = [...st.waiting, ...fresh];
  for (const leaf of todo) {
    const rc = await p.getTransactionReceipt(leaf.tx);
    const logs = rc?.logs ?? [];
    const dispatch = logs.map((l) => { try { return getAddress(l.address) === conf.mailbox ? EVENTS.parseLog(l) : null; } catch { return null; } })
      .find((e) => e?.name === 'Dispatch' && decodeMessage(e.args.message).id.toLowerCase() === leaf.messageId.toLowerCase());
    if (!dispatch) { refused.push({ index: leaf.index, reason: 'no Dispatch of this message id in its transaction' }); continue; }
    const msg = decodeMessage(dispatch.args.message);
    const sent = logs.filter((l) => conf.routes.some((x) => x.vault === getAddress(l.address))).map((l) => { try { const e = EVENTS.parseLog(l); return e?.name === 'Sent' ? { ...e, address: l.address } : null; } catch { return null; } }).filter(Boolean);
    const held = {};
    if (conf.threats) {
      for (const e of sent) {
        for (const a of [e.args.sender, e.args.to]) {
          const out = await p.call({ to: conf.threats, data: THREATS.encodeFunctionData('isContractHeld', [a]) });
          if (THREATS.decodeFunctionResult('isContractHeld', out)[0]) held[getAddress(a).toLowerCase()] = true;
        }
      }
    }
    const d = decide(msg, { routes: conf.routes, origin: conf.origin, sent, held });
    if (!d.sign) {
      if (d.wait) waiting.push(leaf);
      refused.push({ index: leaf.index, reason: d.reason, wait: !!d.wait });
      log(T(`leaf ${leaf.index} ${leaf.messageId}: NOT signed: ${d.reason}${d.wait ? ' (re-checked every pass)' : ''}`));
      continue;
    }
    const cp = signedCheckpoint(wallet, { origin: conf.origin, merkleTreeHook: conf.merkleTreeHook, root: leaf.root, index: leaf.index, messageId: leaf.messageId });
    await store.write(`checkpoint_${leaf.index}_with_id.json`, JSON.stringify(cp));
    signed.push(leaf.index);
    log(T(`leaf ${leaf.index} ${leaf.messageId}: signed (${d.route}, ${d.amount} wei to ${d.to})`));
  }
  const latest = Math.max(st.latest, ...signed);
  if (signed.length) await store.write('checkpoint_latest_index.json', JSON.stringify(latest));
  return { state: { tree: tree.toJSON(), next: head + 1, waiting, latest }, signed, refused: refused.filter((x) => !x.wait), waiting: waiting.map((x) => x.index) };
}

async function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  if (cmd === 'keygen') {
    if (!o.key) throw new Error('--key /etc/neuro-validator/key');
    if (existsSync(o.key)) throw new Error(`${o.key} exists: refusing to replace a validator key`);
    mkdirSync(dirname(o.key), { recursive: true, mode: 0o700 });
    const w = Wallet.createRandom();
    writeFileSync(o.key, w.privateKey + '\n', { mode: 0o600 });
    console.log(`new Neuro validator key in ${o.key} (0600, never leaves this machine): ${w.address}`);
    return;
  }
  const wallet = loadKey(o.key);
  if (cmd === 'address') { console.log(wallet.address); return; }
  const conf = setup();
  const p = new JsonRpcProvider((process.env.ZETAPHY_RPC || conf.rpc[0]).split(',')[0], conf.origin, { staticNetwork: true });
  if (!o.location) throw new Error('--location gs://bucket/folder');
  const store = storage(o.location);
  if (cmd === 'announce') {
    const va = new Contract(conf.validatorAnnounce, VA, p);
    const a = announcement(wallet, { mailbox: conf.mailbox, validatorAnnounce: conf.validatorAnnounce, domain: conf.origin, storageLocation: o.location });
    const onchain = await va.getAnnouncementDigest(o.location);
    if (onchain.toLowerCase() !== hashMessage(Buffer.from(a.inner.slice(2), 'hex')).toLowerCase()) throw new Error('the announcement digest differs from the contract\'s: nothing sent');
    const have = (await va.getAnnouncedStorageLocations([wallet.address]))[0] ?? [];
    await store.write('announcement.json', JSON.stringify(a.file));
    console.log(`validator ${wallet.address}; wrote announcement.json to ${o.location}; announced already: ${have.length ? have.join(', ') : 'none'}`);
    if (have.includes(o.location)) return console.log('already announced: nothing to send');
    if (o.send !== 'yes') return console.log('add --send yes to announce it on ZETAPHY (the key needs a little ZTPHY for gas)');
    const tx = await va.connect(wallet.connect(p)).announce(wallet.address, o.location, a.signature);
    await tx.wait();
    console.log(`announced: tx ${tx.hash}`);
    return;
  }
  if (cmd === 'run') {
    const sp = o.state ?? '/var/lib/neuro-validator/state.json';
    let state = existsSync(sp) ? JSON.parse(readFileSync(sp, 'utf8')) : null;
    const every = Number(o.every ?? 20) * 1000;
    console.log(T(`Neuro validator ${wallet.address}: routes ${conf.routes.map((r) => r.name).join(', ')}, hook ${conf.merkleTreeHook}, storage ${o.location}`));
    for (;;) {
      try {
        const res = await pass({ p, conf, wallet, store, state, log: (m) => console.log(m) });
        state = res.state;
        mkdirSync(dirname(sp), { recursive: true });
        writeFileSync(sp + '.tmp', JSON.stringify(state)); renameSync(sp + '.tmp', sp);
        if (res.signed.length || res.refused.length) console.log(T(`pass: signed ${res.signed.length}, refused ${res.refused.length}, waiting ${res.waiting.length}, tree ${state.tree.count}`));
      } catch (e) { console.log(T(`pass failed: ${e.shortMessage ?? e.message}`)); }
      if (o.once) return;
      await new Promise((r) => setTimeout(r, every));
    }
  }
  throw new Error('usage: keygen | address | announce | run (see the head of scripts/neuro-validator.js)');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
