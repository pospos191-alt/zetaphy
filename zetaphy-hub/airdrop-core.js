// "Claim airdrop" card (airdrop.js), pure parts: where an address's claim lives in the published list
// (zetaphy-network/airdrop/distributor.js: summary.json + shards/<prefix>.json), checking its Merkle proof against the
// root before anything is sent, and the ZtphyMerkleDistributor calls. keccak is passed in (bytes -> 32 bytes), so the
// same code runs in the page (neuro/src/keccak.js) and in the tests.

const strip = (h) => String(h).replace(/^0x/, '');
export const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => strip(a).toLowerCase().padStart(64, '0');
const hexToBytes = (h) => Uint8Array.from(strip(h).match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
const bytesToHex = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

// keccak256 selectors (checked against ethers in test/airdrop.test.mjs)
export const SEL = {
  claim: '0x2e7ba6ef',          // claim(uint256,address,uint256,bytes32[])
  isClaimed: '0x9e34070f',      // isClaimed(uint256)
  merkleRoot: '0x2eb4a7ab',     // merkleRoot()
  claimStart: '0xf04d688f',     // claimStart()
  claimDeadline: '0x3ba86c44',  // claimDeadline()
  aborted: '0x80b62b70',        // aborted()
};

export const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a));
/** The shard file of an address (summary.shardPrefixLength hex characters of the lower-case address). */
export function shardPath(address, summary) {
  const n = Number(summary?.shardPrefixLength);
  if (!isAddr(address) || !Number.isInteger(n) || n < 1 || n > 6) throw new Error('bad-list');
  return `shards/${address.toLowerCase().slice(2, 2 + n)}.json`;
}

/** The address's entry of a shard, or null; throws on a malformed entry. */
export function findClaim(shard, address) {
  const c = shard?.claims?.[String(address).toLowerCase()];
  if (!c) return null;
  if (!Number.isSafeInteger(c.index) || c.index < 0 || !/^\d{1,78}$/.test(String(c.amount)) || !Array.isArray(c.proof) || c.proof.length > 64
    || !c.proof.every((p) => /^0x[0-9a-fA-F]{64}$/.test(p))) throw new Error('bad-list');
  return { index: c.index, amount: BigInt(c.amount), proof: c.proof };
}

/** keccak256(bytes.concat(keccak256(abi.encode(index, account, amount)))), the contract's leafOf. */
export function leafOf(keccak, index, account, amount) {
  return keccak(keccak(hexToBytes(`${word(index)}${addrWord(account)}${word(amount)}`)));
}

/** The root a proof leads to (sorted pairs), 0x-hex. */
export function rootOf(keccak, index, account, amount, proof) {
  let h = leafOf(keccak, index, account, amount);
  for (const p of proof) {
    const s = hexToBytes(p);
    const hHex = bytesToHex(h), sHex = bytesToHex(s);
    const both = new Uint8Array(64);
    if (hHex < sHex) { both.set(h); both.set(s, 32); } else { both.set(s); both.set(h, 32); }
    h = keccak(both);
  }
  return bytesToHex(h);
}

export const encodeClaim = (index, account, amount, proof) =>
  `${SEL.claim}${word(index)}${addrWord(account)}${word(amount)}${word(128)}${word(proof.length)}${proof.map(strip).join('')}`;
export const encodeIsClaimed = (index) => `${SEL.isClaimed}${word(index)}`;
