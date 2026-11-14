// zetaphy-chain/gov.sh in mainnet mode (a node pinned by setup-node.sh, or --network mainnet): the chain id from the
// pinned genesis, no test keyring, testnet-only commands refused, the node's chain checked before signing, the
// deposit from the chain, and multisig (--generate-only + broadcast) and Ledger keys. Without a pin and without
// --network mainnet it is the testnet, as before. A stand-in zetaphyd records every tx it is asked to sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toBech32 } from '../src/pqtx.js';

const GOV = new URL('../../zetaphy-chain/gov.sh', import.meta.url).pathname;
const MS = 'zetaphy1msmsmsmsmsmsmsmsmsmsmsmsmsmsmsmsms0q';

function node({ network = 'zetaphy_3659-1', keyType = 'local', genesisChain = 'zetaphy_3659-1', pin = true, pinSha = null, minGas = '1000000000.000000000000000000' } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'zetaphy-govmain-'));
  const log = join(d, 'tx.log');
  writeFileSync(join(d, 'genesis.json'), JSON.stringify({ chain_id: genesisChain, app_state: { staking: { params: { bond_denom: 'azetaphy' } }, feemarket: { params: { min_gas_price: minGas } } } }));
  const sha = createHash('sha256').update(readFileSync(join(d, 'genesis.json'))).digest('hex');
  if (pin) writeFileSync(join(d, 'pinned-chain.env'), `GENESIS_SHA256=${pinSha ?? sha}\nGENESIS_EVM_CHAIN_ID=3659\nPUBLIC_RPC=0\n`);
  writeFileSync(join(d, 'zetaphyd'), `#!/bin/bash
case "$*" in
  *" status"|status*) echo '{"node_info":{"network":"${network}"},"sync_info":{"latest_block_height":"1000"}}' ;;
  *"keys show"*) echo '{"name":"x","type":"${keyType}","address":"zetaphy1x"}' ;;
  *"gov params"*) echo '{"params":{"min_deposit":[{"denom":"azetaphy","amount":"10000000000000000000000"}]}}' ;;
  *"module-account gov"*) echo '{"account":{"value":{"address":"zetaphy10d07y265gmmuvt4z0w9aw880jnsr700jvr86lj"}}}' ;;
  *"gov proposals"*) n=$(cat ${d}/n 2>/dev/null || echo 0); echo $((n+1)) > ${d}/n; [ "$n" = 0 ] && echo '{"proposals":[]}' || echo '{"proposals":[{"id":"1"}]}' ;;
  *"tx broadcast"*) echo "$*" >> ${log}; echo '{"code":0,"txhash":"CAFE"}' ;;
  *"tx "*)
    echo "$*" >> ${log}
    f=""; prev=""; for a in "$@"; do [ "$prev" = submit-proposal ] && f="$a"; prev="$a"; done; [ -n "$f" ] && cp "$f" ${d}/proposal.json
    case "$*" in *--generate-only*) echo '{"body":{"messages":[{"@type":"/cosmos.gov.v1.MsgVote"}]},"auth_info":{},"signatures":[]}' ;; *) echo '{"code":0,"txhash":"AB"}' ;; esac ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac`);
  chmodSync(join(d, 'zetaphyd'), 0o755);
  const run = (args, env = {}) => {
    const r = spawnSync('bash', [GOV, ...args], {
      encoding: 'utf8', input: '',
      env: { ...process.env, ZETAPHYD: join(d, 'zetaphyd'), NODE_HOME: d, HOME: d, GENESIS_FILE: join(d, 'genesis.json'), PINNED: join(d, 'pinned-chain.env'), PATH: `${d}:${process.env.PATH}`, ...env },
    });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const txs = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { run, txs, dir: d, sha };
}

test('without a pin file and without --network mainnet: the testnet, as before (test keyring, zetaphy_77390-1)', () => {
  const n = node({ pin: false, network: 'zetaphy_77390-1' });
  const r = n.run(['vote', '3', 'yes'], { KEYS_DIR: n.dir });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(n.txs().length, 1);
  assert.match(n.txs()[0], /tx gov vote 3 yes .*--keyring-backend test --keyring-dir \S+ --from validator --chain-id zetaphy_77390-1 --gas auto --gas-adjustment 1\.5 --gas-prices 1000000000azetaphy -y -o json$/);
  assert.doesNotMatch(r.out, /mainnet/);
  const k = n.run(['vote', '3', 'yes', '--keyring-backend', 'file']);
  assert.equal(k.code, 2);
  assert.match(k.out, /is for mainnet mode/);
});

test('a pinned node: the chain id and gas price from the pinned genesis, the file keyring in ~/.zetaphy-keys; never test', () => {
  const n = node();
  const r = n.run(['vote', '3', 'yes']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /mainnet zetaphy_3659-1: key validator \(file keyring .*\.zetaphy-keys\)/);
  assert.equal(n.txs().length, 1);
  assert.match(n.txs()[0], new RegExp(`tx gov vote 3 yes .*--keyring-backend file --keyring-dir ${n.dir}/\\.zetaphy-keys --from validator --chain-id zetaphy_3659-1 .*--gas-prices 1000000000azetaphy -y`));
  assert.doesNotMatch(n.txs()[0], /--keyring-backend test/);
  const t = n.run(['vote', '3', 'yes', '--keyring-backend', 'test']);
  assert.equal(t.code, 1);
  assert.match(t.out, /refused: --keyring-backend test on mainnet/);
  const os = n.run(['vote', '4', 'no', '--keyring-backend', 'os', '--from', 'gov-voter']);
  assert.equal(os.code, 0, os.out);
  assert.match(n.txs()[1], /tx gov vote 4 no .*--keyring-backend os .*--from gov-voter --chain-id zetaphy_3659-1/);
  assert.equal(n.txs().length, 2);
});

test('mainnet refuses: a genesis that is not the pinned one, another --chain-id, a node of another chain, the testnet\'s id', () => {
  const tampered = node({ pinSha: 'ab'.repeat(32) });
  assert.match(tampered.run(['vote', '1', 'yes']).out, /refused: .* is not the pinned genesis/);
  const n = node();
  const c = n.run(['vote', '1', 'yes', '--chain-id', 'zetaphy_3660-1']);
  assert.equal(c.code, 1);
  assert.match(c.out, /refused: --chain-id zetaphy_3660-1, but the pinned genesis is zetaphy_3659-1/);
  const other = node({ network: 'zetaphy_77390-1' });
  const o = other.run(['vote', '1', 'yes']);
  assert.equal(o.code, 1);
  assert.match(o.out, /refused: the node at \S+ serves chain zetaphy_77390-1, not zetaphy_3659-1: nothing signed/);
  assert.deepEqual(other.txs(), []);
  const nopin = node({ pin: false });
  assert.match(nopin.run(['vote', '1', 'yes', '--network', 'mainnet']).out, /without a pin file .*: pass --chain-id/);
  assert.match(nopin.run(['vote', '1', 'yes', '--network', 'mainnet', '--chain-id', 'zetaphy_77390-1']).out, /zetaphy_77390-1 is the testnet/);
  const flag = nopin.run(['vote', '1', 'yes', '--network', 'mainnet', '--chain-id', 'zetaphy_3659-1']);
  assert.equal(flag.code, 0, flag.out);
  assert.match(nopin.txs()[0], /--keyring-backend file .*--chain-id zetaphy_3659-1/);
  assert.match(n.run(['vote', '1', 'yes', '--network', 'testnet']).out, /refused: this node is pinned to a chain/);
  assert.deepEqual(n.txs(), []);
});

test('mainnet refuses gov.sh airdrop before anything else unless AIRDROP_MAINNET=1 (test/govairdrop-mainnet.test.js)', () => {
  const n = node();
  const f = join(n.dir, 'list.txt');
  writeFileSync(f, `zetaphy1${'q'.repeat(38)}\n`);
  const r = n.run(['airdrop', f, '100'], { SEND: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /refused: gov\.sh airdrop on mainnet moves real ZTPHY: set AIRDROP_MAINNET=1/);
  assert.deepEqual(n.txs(), []);
});

test('a proposal on mainnet carries the chain\'s full min_deposit (10,000 ZTPHY), not the testnet\'s 1,000', () => {
  const n = node();
  const r = n.run(['propose-text', 'signal', 'a mainnet signalling vote']);
  assert.equal(r.code, 0, r.out);
  const p = JSON.parse(readFileSync(join(n.dir, 'proposal.json'), 'utf8'));
  assert.equal(p.deposit, '10000000000000000000000azetaphy');
  const d = n.run(['propose-text', 'signal', 'x'], { DEPOSIT: '20000000000000000000000azetaphy' });
  assert.equal(d.code, 0, d.out);
  assert.equal(JSON.parse(readFileSync(join(n.dir, 'proposal.json'), 'utf8')).deposit, '20000000000000000000000azetaphy');
});

test('a multisig: --generate-only writes the unsigned tx (fixed gas, no simulation), sends nothing; broadcast sends the signed one', () => {
  const n = node();
  const out = join(n.dir, 'unsigned.json');
  const r = n.run(['vote', '7', 'yes', '--from', MS, '--generate-only', out]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`unsigned transaction written to ${out} \\(from ${MS}, chain zetaphy_3659-1\\); nothing was sent`));
  assert.match(r.out, /tx sign .* --multisig zetaphy1ms.* --sign-mode amino-json/);
  assert.match(r.out, /gov\.sh broadcast signed\.json/);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).body.messages[0]['@type'], '/cosmos.gov.v1.MsgVote');
  assert.match(n.txs()[0], new RegExp(`tx gov vote 7 yes .*--from ${MS} --chain-id zetaphy_3659-1 --gas 900000 --gas-prices 1000000000azetaphy --generate-only$`));
  assert.doesNotMatch(n.txs()[0], /--gas auto| -y/);
  const up = n.run(['propose-upgrade', 'zetaphy-v9', '5000', 'mainnet upgrade', '--from', MS, '--generate-only', join(n.dir, 'up.json')], { FORCE: '1' });
  assert.equal(up.code, 0, up.out);
  assert.equal(JSON.parse(readFileSync(join(n.dir, 'proposal.json'), 'utf8')).messages[0]['@type'], '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade');
  assert.equal(JSON.parse(readFileSync(join(n.dir, 'proposal.json'), 'utf8')).deposit, '10000000000000000000000azetaphy');
  writeFileSync(join(n.dir, 'signed.json'), JSON.stringify({ body: { messages: [{}] }, signatures: ['c2ln'] }));
  const b = n.run(['broadcast', join(n.dir, 'signed.json')]);
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /broadcast: txhash CAFE/);
  assert.match(n.txs().at(-1), /tx broadcast .*signed\.json .*--chain-id zetaphy_3659-1/);
  writeFileSync(join(n.dir, 'unsigned2.json'), JSON.stringify({ body: { messages: [{}] }, signatures: [] }));
  assert.match(n.run(['broadcast', join(n.dir, 'unsigned2.json')]).out, /not a signed transaction/);
});

test('a Ledger key: amino-json on the device; a key that is not a Ledger key is refused', () => {
  const local = node({ keyType: 'local' });
  const r = local.run(['vote', '2', 'yes', '--keyring-backend', 'ledger', '--from', 'hw']);
  assert.equal(r.code, 1);
  assert.match(r.out, /refused: --keyring-backend ledger, but "hw" is not a Ledger key/);
  assert.deepEqual(local.txs(), []);
  const hw = node({ keyType: 'ledger' });
  const ok = hw.run(['vote', '2', 'yes', '--keyring-backend', 'ledger', '--from', 'hw']);
  assert.equal(ok.code, 0, ok.out);
  assert.match(hw.txs()[0], /tx gov vote 2 yes .*--keyring-backend file .*--from hw --chain-id zetaphy_3659-1 .*--sign-mode amino-json -y -o json$/);
});

test('transfer: a named sender only; from the Community multisig it writes the unsigned bank send (decimals to azetaphy)', () => {
  const n = node();
  const hot = toBech32(Uint8Array.from({ length: 20 }, () => 0x22));
  const none = n.run(['transfer', hot, '1000100']);
  assert.equal(none.code, 1);
  assert.match(none.out, /transfer: name the sender with --from/);
  const out = join(n.dir, 'unsigned.json');
  const r = n.run(['transfer', hot, '1000100', '--from', MS, '--generate-only', out]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`transfer 1000100 ZTPHY \\(1000100000000000000000000 azetaphy\\) from ${MS} to ${hot} on zetaphy_3659-1`));
  assert.match(r.out, /unsigned transaction written to .*unsigned\.json .*nothing was sent/);
  assert.match(n.txs()[0], new RegExp(`^tx bank send ${MS} ${hot} 1000100000000000000000000azetaphy .*--from ${MS} .*--generate-only$`));
  const community = toBech32(Uint8Array.from({ length: 20 }, () => 0x33));
  const back = n.run(['transfer', community, '95.25', '--from', 'airdrop'], { SEND: '1' });
  assert.equal(back.code, 0, back.out);
  assert.match(n.txs()[1], new RegExp(`^tx bank send airdrop ${community} 95250000000000000000azetaphy .*--keyring-backend file .*--from airdrop .*-y -o json$`));
  assert.match(back.out, /txhash AB/);
  const typo = hot.slice(0, -1) + (hot.endsWith('q') ? 'p' : 'q');
  assert.match(n.run(['transfer', typo, '1', '--from', 'airdrop']).out, /receiver: a zetaphy1… address with a valid checksum/);
  assert.equal(n.txs().length, 2);
});
