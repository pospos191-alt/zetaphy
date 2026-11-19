// The Neuro validator: a second, independent signer for Saphan's ZETAPHY -> destination messages (docs/SAPHAN-NEURO-
// VALIDATOR.md). Hyperlane's own validator signs every message the Mailbox dispatches; this one signs a message only
// when every check passes, so a 2-of-2 ISM on the destination (our Hyperlane validator + this one) mints nothing that:
//   - did not leave one of OUR vaults (Mailbox Dispatch sender) for the route's own synthetic and domain;
//   - has no matching Sent(nonce, sender, to, amount, messageId) event of that vault in the same transaction;
//   - is larger than the destination's daily mint limit;
//   - sends from or to an address Neuro's ThreatRegistry holds (isContractHeld): such a message waits, re-checked on
//     every pass, and is signed once the hold is lifted.
// It computes the Mailbox's merkle tree itself from MerkleTreeHook InsertedIntoTree events and refuses to sign when
// its root differs from the hook's own (a tree it cannot reproduce is a chain it cannot trust).
// Pure parts here (tree, message, digest, decision, checkpoint files); scripts/neuro-validator.js runs it.
import { AbiCoder, Interface, getAddress, keccak256, concat, zeroPadValue, toBeHex, solidityPacked, getBytes, Signature, dataSlice, hexlify } from 'ethers';

export const ZERO32 = '0x' + '00'.repeat(32);
const DEPTH = 32;
/** Hyperlane's MerkleLib zero hashes: Z[0] = 0, Z[i] = keccak(Z[i-1] || Z[i-1]). */
export const ZEROES = (() => { const z = [ZERO32]; for (let i = 1; i < DEPTH; i++) z.push(keccak256(concat([z[i - 1], z[i - 1]]))); return z; })();

/** Hyperlane's incremental merkle tree (MerkleLib.Tree): insert leaves, read the root. */
export class MerkleTree {
  constructor(state = null) { this.branch = state?.branch ? [...state.branch] : Array(DEPTH).fill(ZERO32); this.count = state?.count ?? 0; }
  insert(leaf) {
    if (this.count >= 2 ** DEPTH - 1) throw new Error('merkle tree full');
    let size = ++this.count, node = leaf;
    for (let i = 0; i < DEPTH; i++) {
      if (size & 1) { this.branch[i] = node; return; }
      node = keccak256(concat([this.branch[i], node]));
      size = Math.floor(size / 2);
    }
    throw new Error('unreachable');
  }
  root() {
    let cur = ZERO32;
    for (let i = 0; i < DEPTH; i++) {
      cur = Math.floor(this.count / 2 ** i) % 2 === 1 ? keccak256(concat([this.branch[i], cur])) : keccak256(concat([cur, ZEROES[i]]));
    }
    return cur;
  }
  toJSON() { return { branch: this.branch, count: this.count }; }
}

/** A Hyperlane message (Message.sol, version 3) -> its fields. */
export function decodeMessage(m) {
  const b = getBytes(m);
  if (b.length < 77) throw new Error('message too short');
  const u = (o, n) => Number(BigInt(hexlify(b.slice(o, o + n))));
  return { version: b[0], nonce: u(1, 4), origin: u(5, 4), sender: hexlify(b.slice(9, 41)), destination: u(41, 4), recipient: hexlify(b.slice(45, 77)), body: hexlify(b.slice(77)), id: keccak256(m) };
}

/** The 32-byte form of an address (Hyperlane's addressToBytes32). */
export const b32 = (a) => zeroPadValue(getAddress(a), 32).toLowerCase();
const addrOf32 = (x) => getAddress(dataSlice(x, 12));

/** CheckpointLib.digest's inner hash (what is EIP-191 signed): domain hash, root, index, message id. */
export function checkpointHash({ origin, merkleTreeHook, root, index, messageId }) {
  const domainHash = keccak256(solidityPacked(['uint32', 'bytes32', 'string'], [origin, b32(merkleTreeHook), 'HYPERLANE']));
  return keccak256(solidityPacked(['bytes32', 'bytes32', 'uint32', 'bytes32'], [domainHash, root, index, messageId]));
}

const sigJson = (sig) => { const s = Signature.from(sig); return { r: toBeHex(BigInt(s.r)), s: toBeHex(BigInt(s.s)), v: s.v }; };

/** A signed checkpoint as Hyperlane's validators store it (checkpoint_{index}_with_id.json). `wallet`: ethers Wallet. */
export function signedCheckpoint(wallet, { origin, merkleTreeHook, root, index, messageId }) {
  const sig = wallet.signMessageSync(getBytes(checkpointHash({ origin, merkleTreeHook, root, index, messageId })));
  return { value: { checkpoint: { merkle_tree_hook_address: b32(merkleTreeHook), mailbox_domain: origin, root, index }, message_id: messageId }, signature: sigJson(sig), serialized_signature: sig };
}

/** The storage-location announcement (ValidatorAnnounce.announce) and its file (announcement.json). */
export function announcement(wallet, { mailbox, validatorAnnounce, domain, storageLocation }) {
  // ValidatorAnnounce: _domainHash = keccak256(abi.encodePacked(localDomain, address(mailbox).addressToBytes32(), "HYPERLANE_ANNOUNCEMENT"));
  // the script checks this against the contract's own getAnnouncementDigest before it sends anything
  void validatorAnnounce;
  const dh = keccak256(solidityPacked(['uint32', 'bytes32', 'string'], [domain, b32(mailbox), 'HYPERLANE_ANNOUNCEMENT']));
  const inner = keccak256(solidityPacked(['bytes32', 'string'], [dh, storageLocation]));
  const sig = wallet.signMessageSync(getBytes(inner));
  return { inner, signature: sig, file: { value: { validator: wallet.address, mailbox_address: b32(mailbox), mailbox_domain: domain, storage_location: storageLocation }, signature: sigJson(sig), serialized_signature: sig } };
}

export const EVENTS = new Interface([
  'event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)',
  'event InsertedIntoTree(bytes32 messageId, uint32 index)',
  'event Sent(uint256 indexed nonce, address indexed sender, address indexed to, uint256 amount, bytes32 messageId)',
]);
const BODY = ['uint256 srcChainId', 'address srcContract', 'uint256 srcNonce', 'address sender', 'address to', 'uint256 amount', 'uint256 dstChainId', 'address dstContract', 'address originToken'];

/**
 * Whether to sign one message. `routes`: [{ name, vault, synthetic, domain, chainId, mintDailyLimit (wei) }];
 * `sent`: the vault Sent events of the message's transaction (parsed); `held`: { address(lower): true } from Neuro.
 * Returns { sign: true, route } or { sign: false, reason, wait? } (wait: re-check later, e.g. a Neuro hold).
 */
export function decide(msg, { routes, origin, sent = [], held = {} }) {
  if (msg.origin !== origin) return { sign: false, reason: `origin ${msg.origin}, not ${origin}` };
  const sender = addrOf32(msg.sender);
  const r = routes.find((x) => getAddress(x.vault) === sender);
  if (!r) return { sign: false, reason: `not from a Saphan vault (sender ${sender})` };
  if (msg.destination !== r.domain) return { sign: false, reason: `${r.name} vault message to domain ${msg.destination}, not ${r.domain}` };
  if (msg.recipient.toLowerCase() !== b32(r.synthetic)) return { sign: false, reason: `${r.name} vault message to ${msg.recipient}, not the synthetic ${r.synthetic}` };
  let body;
  try { body = AbiCoder.defaultAbiCoder().decode(BODY, msg.body); } catch { return { sign: false, reason: 'body does not decode' }; }
  if (getAddress(body.srcContract) !== getAddress(r.vault) || getAddress(body.dstContract) !== getAddress(r.synthetic) || Number(body.dstChainId) !== r.chainId) {
    return { sign: false, reason: 'body names another source, destination or chain' };
  }
  const s = sent.find((e) => e.args.messageId.toLowerCase() === msg.id.toLowerCase() && getAddress(e.address) === getAddress(r.vault));
  if (!s) return { sign: false, reason: 'no Sent event of the vault for this message id in its transaction' };
  if (s.args.nonce !== body.srcNonce || getAddress(s.args.sender) !== getAddress(body.sender) || getAddress(s.args.to) !== getAddress(body.to) || s.args.amount !== body.amount) {
    return { sign: false, reason: 'the vault Sent event and the message body disagree' };
  }
  if (r.mintDailyLimit != null && body.amount > BigInt(r.mintDailyLimit)) return { sign: false, reason: `amount above the ${r.name} daily mint limit` };
  for (const [role, a] of [['sender', body.sender], ['receiver', body.to]]) {
    if (held[getAddress(a).toLowerCase()]) return { sign: false, wait: true, reason: `Neuro holds the ${role} ${getAddress(a)} (ThreatRegistry)` };
  }
  return { sign: true, route: r.name, to: getAddress(body.to), amount: body.amount };
}
