// zetaphy-chain/gov.sh airdrop in mainnet mode (AIRDROP_MAINNET=1, the owner's push airdrop of 2026-11-14,
// docs/AIRDROP.md "Push airdrop on mainnet"). A stand-in zetaphyd plays a one-validator chain: each `status` call is
// a new block that includes what its mempool holds (unless the chain is stalled), with the account sequence, the
// tx index (`q tx`, `q txs --query tx.acc_seq=…`), timeout heights, simulation (`--gas auto --generate-only`) and
// failures on demand.
// No real chain: the ledger / pending logic, the batch sizes, the gas cap and the refusals are what is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBytes } from 'ethers';
import { toBech32 } from '../src/pqtx.js';
import { run as cli } from '../airdrop/cli.js';

const GOV = new URL('../../zetaphy-chain/gov.sh', import.meta.url).pathname;
const FUND = toBech32(Uint8Array.from({ length: 20 }, () => 0x11));
const ZT = (n) => `${n}000000000000000000`;
const hexOf = (b) => '0x' + Buffer.from(b).toString('hex');
const list = (k) => Array.from({ length: k }, () => randomBytes(20)).map((b) => ({ hex: hexOf(b), bech: toBech32(b) }));

function chain({ balance = ZT(1000100) } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'zetaphy-push-'));
  const log = join(d, 'tx.log');
  writeFileSync(join(d, 'height'), '100\n');
  writeFileSync(join(d, 'seq'), '0\n');
  writeFileSync(join(d, 'mempool'), '');
  writeFileSync(join(d, 'map'), '');
  writeFileSync(join(d, 'genesis.json'), JSON.stringify({ chain_id: 'zetaphy_3659-1', app_state: { staking: { params: { bond_denom: 'azetaphy' } }, feemarket: { params: { min_gas_price: '1000000000.000000000000000000' } } } }));
  const sha = createHash('sha256').update(readFileSync(join(d, 'genesis.json'))).digest('hex');
  writeFileSync(join(d, 'pinned-chain.env'), `GENESIS_SHA256=${sha}\nGENESIS_EVM_CHAIN_ID=3659\n`);
  writeFileSync(join(d, 'zetaphyd'), `#!/bin/bash
D=${d}; log=${log}
h=$(cat $D/height); seq=$(cat $D/seq)
block() { # one block: what the mempool holds goes in (a tx past its timeout height is dropped)
  [ -f $D/stall ] && return
  h=$((h + 1)); echo $h > $D/height
  while read -r hash tmo fail; do
    [ -n "$hash" ] || continue
    if [ "$tmo" -lt "$h" ]; then echo "expired $hash" >> $log; continue; fi
    code=0; rl=""; [ "$fail" = 1 ] && { code=5; rl="insufficient funds"; }
    j="{\\"height\\":\\"$h\\",\\"txhash\\":\\"$hash\\",\\"code\\":$code,\\"raw_log\\":\\"$rl\\"}"
    echo "$j" > $D/tx-$hash; echo "$j" > $D/accseq-$seq
    seq=$((seq + 1)); echo $seq > $D/seq
  done < $D/mempool
  : > $D/mempool
}
case "$1 $2" in
  "status "*|"status") block; echo "{\\"node_info\\":{\\"network\\":\\"zetaphy_3659-1\\"},\\"sync_info\\":{\\"latest_block_height\\":\\"$h\\"}}" ;;
  "keys show") echo ${FUND} ;;
  "debug addr") r=$(grep -i "^$3 " $D/map | cut -d' ' -f2); [ -n "$r" ] && printf 'Address hex: %s\\nBech32 Acc: %s\\n' "$3" "$r"; exit 0 ;;
  "q bank") echo "{\\"balances\\":[{\\"denom\\":\\"azetaphy\\",\\"amount\\":\\"\${STUB_BALANCE:-${balance}}\\"}]}" ;;
  "q feemarket") echo "{\\"base_fee\\":\\"\${STUB_BASEFEE:-1000000000.000000000000000000}\\"}" ;;
  "q auth") echo "{\\"account\\":{\\"type\\":\\"/cosmos.auth.v1beta1.BaseAccount\\",\\"value\\":{\\"address\\":\\"$3\\",\\"account_number\\":\\"7\\",\\"sequence\\":\\"$seq\\"}}}" ;;
  "q tx") [ -f $D/tx-$3 ] && cat $D/tx-$3 || { echo "Error: tx ($3) not found" >&2; exit 1; } ;;
  "q txs") q=""; p=""; for a in "$@"; do [ "$p" = --query ] && q=$a; p=$a; done; s=\${q##*/}; s=\${s%\\'}
    echo "query $q" >> $log
    [ -f $D/accseq-$s ] && echo "{\\"txs\\":[$(cat $D/accseq-$s)]}" || echo '{"txs":[]}' ;;
  "tx bank")
    outs=0; for a in "$@"; do [[ "$a" == zetaphy1* ]] && outs=$((outs + 1)); done
    case " $* " in *" --generate-only "*)
      echo "sim $outs" >> $log
      echo "Enter keyring passphrase (attempt 1/3):" >&2
      case " $* " in *" --gas auto "*) ;; *) echo "simulation without --gas auto" >> $log ;; esac
      echo "gas estimate: $(( (outs * \${STUB_GPO:-25000} + 60000) * 3 / 2 ))" >&2
      echo '{"body":{"messages":[{"@type":"/cosmos.bank.v1beta1.MsgMultiSend"}]},"auth_info":{},"signatures":[]}'; exit 0 ;;
    esac
    k=$(( $(cat $D/n 2>/dev/null || echo 0) + 1 )); echo $k > $D/n
    [ -s $D/mempool ] && echo "OVERLAP" >> $log
    echo "send $k $*" >> $log
    t=""; p=""; for a in "$@"; do [ "$p" = --timeout-height ] && t=$a; p=$a; done
    hash=$(printf 'AB%062d' $k)
    [ "$k" = "\${STUB_CHECKFAIL_AT:-}" ] && { echo "{\\"code\\":13,\\"txhash\\":\\"$hash\\",\\"raw_log\\":\\"insufficient fee\\"}"; exit 0; }
    [ "$k" = "\${STUB_DROP_AT:-}" ] && { echo "{\\"code\\":0,\\"txhash\\":\\"$hash\\"}"; exit 0; }
    [ "$k" = "\${STUB_STALL_AT:-}" ] && touch $D/stall
    echo "$hash $t $([ "$k" = "\${STUB_FAIL_AT:-}" ] && echo 1 || echo 0)" >> $D/mempool
    [ "$k" = "\${STUB_CRASH_AT:-}" ] && { echo "Error: post failed: EOF" >&2; exit 1; }
    echo "{\\"code\\":0,\\"txhash\\":\\"$hash\\",\\"raw_log\\":\\"\\"}" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac`);
  chmodSync(join(d, 'zetaphyd'), 0o755);
  const lf = join(d, 'list.txt');
  const ledgerFile = join(d, 'airdrop-zetaphy_3659-1-paid.txt');
  const run = (rows, args = [], env = {}) => {
    if (rows != null) {
      writeFileSync(lf, rows.map((r) => r.hex ?? r).join('\n') + '\n');
      writeFileSync(join(d, 'map'), rows.filter((r) => r.hex).map((r) => `${r.hex.toLowerCase()} ${r.bech}`).join('\n') + '\n');
    }
    const r = spawnSync('bash', [GOV, 'airdrop', lf, ...args], {
      encoding: 'utf8', input: '',
      env: { ...process.env, ZETAPHYD: join(d, 'zetaphyd'), NODE_HOME: d, HOME: d, GENESIS_FILE: join(d, 'genesis.json'), PINNED: join(d, 'pinned-chain.env'),
        AIRDROP_MAINNET: '1', AIRDROP_POLL: '0', AIRDROP_TIMEOUT: '20', AIRDROP_TIMEOUT_BLOCKS: '4', ...env },
    });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const sends = () => lines().filter((l) => l.startsWith('send '));
  const outputs = (l) => l.split(' ').filter((w) => w.startsWith('zetaphy1'));
  const ledger = () => (existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean) : []);
  const pending = join(d, 'airdrop-zetaphy_3659-1-paid.txt.pending');
  return { run, lines, sends, outputs, ledger, pending, dir: d };
}

// every address sent in a tx that made it into a block with code 0, counted once per tx
const paidOutputs = (c) => c.sends().filter((l) => {
  const hash = `AB${l.split(' ')[1].padStart(62, '0')}`;
  const f = join(c.dir, `tx-${hash}`);
  return existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).code === 0;
}).flatMap(c.outputs);

test('without AIRDROP_MAINNET=1, gov.sh airdrop on mainnet is refused before anything else', () => {
  const c = chain();
  const r = c.run(list(3), [], { AIRDROP_MAINNET: '', SEND: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /refused: gov\.sh airdrop on mainnet moves real ZTPHY: set AIRDROP_MAINNET=1/);
  assert.deepEqual(c.lines(), []);
});

test('dry run: 10 ZTPHY each from the airdrop key, the total, batches, gas reserve and the simulated first batch; nothing sent', () => {
  const c = chain();
  const rows = list(450);
  const r = c.run([...rows, rows[3], rows[7]]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /mainnet zetaphy_3659-1: key airdrop \(file keyring/);
  assert.match(r.out, new RegExp(`push airdrop on zetaphy_3659-1 from airdrop \\(${FUND}\\): 450 addresses, 4500 ZTPHY in all; the key has 1000100 ZTPHY`));
  assert.match(r.out, /skipped: 0 bad, 2 repeated, 0 paid before/);
  assert.match(r.out, /3 batches of up to 180 addresses, one transaction in flight/);
  assert.match(r.out, /gas price 1000000000azetaphy; gas reserve 1 ZTPHY \(3 batches x at most 10000000 gas\)/);
  assert.match(r.out, /first batch: 180 outputs, gas limit 6840000 \(simulated x 1\.5; cap 10000000\)/);
  assert.match(r.out, /dry run: nothing sent \(SEND=1 sends\)/);
  assert.deepEqual(c.sends(), []);
  assert.deepEqual(c.lines(), ['sim 180']);
  assert.ok(!existsSync(c.pending));
  assert.deepEqual(c.ledger(), []);
});

test('SEND=1: 180 + 180 + 90, strictly one tx in flight, each confirmed in a block before it is in the ledger; a rerun sends nothing', () => {
  const c = chain();
  const rows = list(450);
  const r = c.run(rows, [], { SEND: '1' });
  assert.equal(r.code, 0, r.out);
  const s = c.sends();
  assert.deepEqual(s.map((l) => c.outputs(l).length), [180, 180, 90]);
  assert.ok(!c.lines().includes('OVERLAP'), 'a tx was sent while another was in the mempool');
  for (const l of s) {
    assert.match(l, /^send \d+ tx bank multi-send airdrop .* 10000000000000000000azetaphy /);
    assert.match(l, /--keyring-backend file .*--from airdrop --chain-id zetaphy_3659-1 --gas-prices 1000000000azetaphy --gas \d+ --timeout-height \d+ -y -o json$/);
    assert.doesNotMatch(l, /--gas auto|--generate-only/);
  }
  // each simulation comes right before its send: sim, send, sim, send, …
  assert.deepEqual(c.lines().filter((l) => /^(sim|send) /.test(l)).map((l) => l.split(' ')[0]), ['sim', 'sim', 'send', 'sim', 'send', 'sim', 'send']);
  assert.deepEqual([...c.ledger()].sort(), rows.map((x) => x.bech).sort(), 'the ledger holds the bash bech32 of every 0x (checked against JS)');
  assert.match(r.out, /batch 1\/3: 180 x 10 ZTPHY, tx AB0+1 in block \d+ \(code 0\); 180 of 450 paid/);
  assert.match(r.out, /airdrop done: 450 addresses, 4500 ZTPHY/);
  assert.ok(!existsSync(c.pending));
  const again = c.run(rows, [], { SEND: '1' });
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /0 addresses, 0 ZTPHY in all/);
  assert.match(again.out, /450 paid before/);
  assert.match(again.out, /nothing to send/);
  assert.equal(c.sends().length, 3);
});

test('a batch that fails in its block stops the run, names the batch, and is not in the ledger; a rerun sends only the unpaid', () => {
  const c = chain();
  const rows = list(450);
  const r = c.run(rows, [], { SEND: '1', STUB_FAIL_AT: '2' });
  assert.equal(r.code, 1);
  assert.match(r.out, /STOPPED at batch 2\/3: tx AB0+2 failed in block \d+ with code 5: insufficient funds\. Not paid/);
  assert.match(r.out, /paid so far: 180 addresses/);
  assert.equal(c.ledger().length, 180);
  assert.ok(!existsSync(c.pending));
  assert.equal(c.sends().length, 2);
  const again = c.run(rows, [], { SEND: '1' });
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /270 addresses, 2700 ZTPHY in all/);
  assert.deepEqual(c.sends().slice(2).map((l) => c.outputs(l).length), [180, 90]);
  const paid = paidOutputs(c);
  assert.equal(paid.length, 450);
  assert.equal(new Set(paid).size, 450, 'nobody paid twice');
});

test('accepted but never in a block: after its timeout height the batch is known unpaid, nothing pending; the rerun sends it', () => {
  const c = chain();
  const rows = list(250);
  const r = c.run(rows, [], { SEND: '1', STUB_DROP_AT: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /STOPPED at batch 1\/2: tx AB0+1 not in a block by its timeout height \d+ \(the sender's sequence is still 0\)\. Not paid/);
  assert.deepEqual(c.ledger(), []);
  assert.ok(!existsSync(c.pending));
  const again = c.run(rows, [], { SEND: '1' });
  assert.equal(again.code, 0, again.out);
  assert.equal(new Set(paidOutputs(c)).size, 250);
  assert.equal(paidOutputs(c).length, 250);
});

test('the chain stalls after a broadcast: the batch stays pending; the next run finds it was included later and never sends it again', () => {
  const c = chain();
  const rows = list(450);
  const r = c.run(rows, [], { SEND: '1', STUB_STALL_AT: '2', AIRDROP_TIMEOUT: '2' });
  assert.equal(r.code, 1);
  assert.match(r.out, /STOPPED at batch 2\/3: tx AB0+2: no answer within 2s .* Kept in .*\.pending: the next run checks it first, so it is never paid twice/);
  assert.equal(c.ledger().length, 180);
  const p = readFileSync(c.pending, 'utf8');
  assert.match(p, /^txhash=AB0+2\nsequence=1\ntimeout_height=\d+\nbatch=2\/3\nsender=zetaphy1/);
  assert.equal(p.split('--\n')[1].trim().split('\n').length, 180);
  // a run while it is still stalled: cannot tell, sends nothing, keeps the pending file
  const stuck = c.run(rows, [], { SEND: '1', AIRDROP_TIMEOUT: '1' });
  assert.equal(stuck.code, 1);
  assert.match(stuck.out, /refused: cannot tell yet whether that batch was paid: no answer within 1s.*Nothing sent/);
  assert.ok(existsSync(c.pending));
  assert.equal(c.sends().length, 2);
  rmSync(join(c.dir, 'stall')); // the chain goes on and includes the tx (before its timeout height)
  const again = c.run(rows, [], { SEND: '1' });
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /an earlier batch \(2\/3, tx AB0+2\) was not confirmed: checking it first/);
  assert.match(again.out, /it is in block \d+ with code 0 \(tx AB0+2\): its addresses are recorded as paid/);
  assert.match(again.out, /90 addresses, 900 ZTPHY in all/);
  assert.equal(c.sends().length, 3);
  const paid = paidOutputs(c);
  assert.equal(paid.length, 450);
  assert.equal(new Set(paid).size, 450, 'nobody paid twice');
  assert.equal(new Set(c.ledger()).size, 450);
});

test('zetaphyd fails after the broadcast (no hash): the batch is found by the sender\'s sequence (tx.acc_seq) and counted once', () => {
  const c = chain();
  const rows = list(250);
  const r = c.run(rows, [], { SEND: '1', STUB_CRASH_AT: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /batch 1\/2: zetaphyd did not confirm the broadcast \(Error: post failed: EOF\): checking the chain/);
  assert.ok(c.lines().some((l) => l.startsWith(`query tx.acc_seq='${FUND}/0'`)));
  assert.equal(c.sends().length, 2);
  assert.equal(new Set(c.ledger()).size, 250);
});

test('CheckTx refuses a batch: stopped, nothing pending, nothing paid', () => {
  const c = chain();
  const r = c.run(list(10), [], { SEND: '1', STUB_CHECKFAIL_AT: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /STOPPED at batch 1\/1: the node refused the tx \(code 13: insufficient fee\)\. Not paid/);
  assert.ok(!existsSync(c.pending));
  assert.deepEqual(c.ledger(), []);
});

test('refused: test keyring, more than MAX_EACH, too little for the total + gas reserve, a batch over the gas cap, a dirty list, a multisig', () => {
  const c = chain();
  const rows = list(20);
  const t = c.run(rows, ['--keyring-backend', 'test'], { SEND: '1' });
  assert.equal(t.code, 1);
  assert.match(t.out, /refused: --keyring-backend test on mainnet/);
  const big = c.run(rows, ['11'], { SEND: '1' });
  assert.equal(big.code, 1);
  assert.match(big.out, /refused: 11 ZTPHY each is above MAX_EACH \(10, the mainnet default\): set MAX_EACH=<whole ZTPHY> to allow it/);
  const ok = c.run(rows, ['50'], { MAX_EACH: '50' });
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /20 addresses, 1000 ZTPHY in all/);
  const low = c.run(rows, [], { SEND: '1', STUB_BALANCE: ZT(200) });
  assert.equal(low.code, 1);
  assert.match(low.out, /refused: the key has 200 ZTPHY; the airdrop needs 200 \+ 1 gas reserve = 201 ZTPHY/);
  const price = c.run(list(450), [], { STUB_BASEFEE: '400000000000.5', STUB_BALANCE: ZT(4510) });
  assert.equal(price.code, 1, 'a base fee above the genesis minimum is the price used for the reserve');
  assert.match(price.out, /gas price 400000000001azetaphy; gas reserve 13 ZTPHY/);
  const gas = c.run(list(450), [], { STUB_GPO: '40000' });
  assert.equal(gas.code, 1);
  assert.match(gas.out, /refused: a batch of 180 needs 10890000 gas, above MAX_TX_GAS 10000000: set BATCH=148/);
  const small = c.run(null, [], { STUB_GPO: '40000', BATCH: '148' });
  assert.equal(small.code, 0, small.out);
  assert.match(small.out, /4 batches of up to 148/);
  const dirty = c.run([...rows, '0x0000000000000000000000000000000000000800', 'zetaphy1notanaddress'], [], { SEND: '1' });
  assert.equal(dirty.code, 1);
  assert.match(dirty.out, /skip \(system \/ precompile address\): 0x0+800/);
  assert.match(dirty.out, /refused: 2 lines of .* are not a clean address/);
  const ms = c.run(rows, ['--from', FUND, '--generate-only', join(c.dir, 'u.json')], { SEND: '1' });
  assert.equal(ms.code, 1);
  assert.match(ms.out, /refused: a push airdrop is hundreds of transactions; a multisig cannot sign them/);
  assert.equal(c.sends().length, 0);
});

test('end to end: the BigQuery CSV -> cli.js push-list -> gov.sh airdrop pays each clean EOA exactly once', async () => {
  const people = list(230);
  const contract = list(1)[0];
  const csv = ['address,score', ...people.map((p, i) => `${p.hex},${1000 - i}`), `${people[0].hex},1`, `${contract.hex},999`,
    '0x0000000000000000000000000000000000000000,999', '0x0000000000000000000000000000000000000802,999'].join('\n');
  const c = chain();
  writeFileSync(join(c.dir, 'active.csv'), csv);
  const fetchImpl = async (_u, init) => ({ json: async () => JSON.parse(init.body).map((q) => ({ jsonrpc: '2.0', id: q.id, result: q.params[0].toLowerCase() === contract.hex ? '0x60' : '0x' })) });
  const r = await cli(['push-list', join(c.dir, 'active.csv'), '--rpc', 'https://eth.example', '--max', '100000', '--out', join(c.dir, 'push.txt')], { log: () => {}, fetchImpl });
  assert.equal(r.count, 230);
  const rows = readFileSync(join(c.dir, 'push.txt'), 'utf8').trim().split('\n').map((hex) => ({ hex, bech: toBech32(getBytes(hex)) }));
  const g = c.run(rows, [], { SEND: '1' });
  assert.equal(g.code, 0, g.out);
  assert.match(g.out, /230 addresses, 2300 ZTPHY in all/);
  assert.deepEqual(c.sends().map((l) => c.outputs(l).length), [180, 50]);
  assert.deepEqual(new Set(paidOutputs(c)), new Set(people.map((p) => p.bech)));
  assert.equal(paidOutputs(c).length, 230);
});
