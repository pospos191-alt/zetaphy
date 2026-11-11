// Forced exit (contracts/ZetaphyForcedExit.sol, docs/ANTI-ROLLBACK-OFFCHAIN.md item Q): turns the proof a holder
// keeps (the wallet stores ZETAPHY's eth_getProof answer for token(X)'s balanceOf[holder] at a block it saw
// certified) into the arguments of ZetaphyForcedExit.prove.
//
// cosmos/evm's eth_getProof(token, [slot], H) answers storageProof[0].proof = [iavl, multistore]: each the hex of an
// ICS23 CommitmentProof (the evm store's IAVL existence proof of 0x02 || token || slot, then the multistore's
// existence proof of "evm"), queried at IAVL version H - 1, i.e. against the app hash in header H (the EVM block's
// stateRoot), which is StarkLightClient.appHashAt(H). Shape checked here against synthetic proofs
// (test/forcedexit.test.js); to be checked against a devnet node's real answers before it is relied on.
import { keccak256, AbiCoder, getAddress, hexlify, getBytes } from 'ethers';
import { protoFields } from './pqcert.js';

export const BRIDGED_TOKEN_BALANCE_SLOT = 3n; // BridgedToken: name, symbol, totalSupply, balanceOf
const abi = AbiCoder.defaultAbiCoder();

/** The storage slot of balanceOf[holder] (a Solidity mapping at `slot`). */
export function balanceSlot(holder, slot = BRIDGED_TOKEN_BALANCE_SLOT) {
  return keccak256(abi.encode(['address', 'uint256'], [getAddress(holder), BigInt(slot)]));
}

const lastField = (fields, n) => { let v; for (const f of fields) if (f.field === n) v = f.value; return v; };
const all = (fields, n) => fields.filter((f) => f.field === n).map((f) => f.value);

/** An ICS23 CommitmentProof (bytes or hex) holding an ExistenceProof: { key, value, leaf: { hash, prehashKey, prehashValue, length, prefix }, path: [{ hash, prefix, suffix }] }. */
export function decodeExistenceProof(bytes) {
  const b = typeof bytes === 'string' ? getBytes(bytes.startsWith('0x') ? bytes : '0x' + bytes) : bytes;
  const top = protoFields(b);
  const exist = lastField(top, 1);
  if (!exist) throw new Error('not an ICS23 existence proof (a non-existence or batch proof?)');
  const e = protoFields(exist);
  const leafF = protoFields(lastField(e, 3) ?? new Uint8Array());
  const num = (f, n) => Number(lastField(f, n) ?? 0n);
  return {
    key: lastField(e, 1) ?? new Uint8Array(),
    value: lastField(e, 2) ?? new Uint8Array(),
    leaf: { hash: num(leafF, 1), prehashKey: num(leafF, 2), prehashValue: num(leafF, 3), length: num(leafF, 4), prefix: lastField(leafF, 5) ?? new Uint8Array() },
    path: all(e, 4).map((op) => { const f = protoFields(op); return { hash: num(f, 1), prefix: lastField(f, 2) ?? new Uint8Array(), suffix: lastField(f, 3) ?? new Uint8Array() }; }),
  };
}

/**
 * ZetaphyForcedExit.prove arguments from a stored eth_getProof answer of token(X):
 *   { proof: the eth_getProof result (storageProof[0] for balanceSlot(holder)), height: the block it was asked at,
 *     holder, token } -> [holder, height, balance, [leafPrefix, iavlPath, storePath]]
 * Checks that the proof is for that key (0x02 || token || slot), that the IAVL leaf is the IavlSpec one the contract
 * hashes (sha256, value prehashed with sha256, varint lengths) and that the store proof is for "evm".
 */
export function forcedExitArgs({ proof, height, holder, token, slot = BRIDGED_TOKEN_BALANCE_SLOT }) {
  const sp = proof?.storageProof?.[0];
  if (!sp || !Array.isArray(sp.proof) || sp.proof.length !== 2) throw new Error('expected eth_getProof with one storage proof of two ICS23 ops (evm store, multistore)');
  const want = balanceSlot(holder, slot);
  if (BigInt(sp.key) !== BigInt(want)) throw new Error(`the storage proof is for slot ${sp.key}, not balanceOf[${holder}] (${want})`);
  const iavl = decodeExistenceProof(sp.proof[0]);
  const store = decodeExistenceProof(sp.proof[1]);
  const key = hexlify(iavl.key).toLowerCase();
  const expectKey = ('0x02' + getAddress(token).slice(2) + want.slice(2)).toLowerCase();
  if (key !== expectKey) throw new Error(`the IAVL proof is for key ${key}, not ${expectKey}`);
  if (iavl.leaf.hash !== 1 || iavl.leaf.prehashKey !== 0 || iavl.leaf.prehashValue !== 1 || iavl.leaf.length !== 1) throw new Error('the IAVL leaf is not the IavlSpec one (sha256, value prehashed, varint lengths)');
  if (new TextDecoder().decode(store.key) !== 'evm') throw new Error('the multistore proof is not for the evm store');
  if (iavl.value.length !== 32) throw new Error('the storage value is not 32 bytes');
  const balance = BigInt(hexlify(iavl.value));
  if (sp.value != null && BigInt(sp.value) !== balance) throw new Error(`eth_getProof says ${BigInt(sp.value)}, its IAVL proof says ${balance}`);
  const op = (o) => [hexlify(o.prefix), hexlify(o.suffix)];
  return [getAddress(holder), BigInt(height), balance, [hexlify(iavl.leaf.prefix), iavl.path.map(op), store.path.map(op)]];
}
