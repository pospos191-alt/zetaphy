// The ZETAPHY token registry (src/tokenregistry.js, scripts/token-registry.js, docs/TOKEN-REGISTRY.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, getAddress } from 'ethers';
import * as R from '../src/tokenregistry.js';
import { compile } from '../scripts/token-registry.js';

const SRC = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
contract Mango {
  string public name = "Mango Coin"; string public symbol = "MANGO"; uint8 public constant decimals = 18;
  uint256 public totalSupply; address public immutable owner; mapping(address => uint256) public balanceOf;
  constructor() { owner = msg.sender; totalSupply = 1e24; balanceOf[msg.sender] = 1e24; }
}`;
const SOURCE = { compiler: 'v0.8.26+commit.8a97fa7a', contract: 'Mango.sol:Mango',
  input: { language: 'Solidity', sources: { 'Mango.sol': { content: SRC } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' } } };
const TOKEN = getAddress('0x' + 'ab'.repeat(20));
const creator = Wallet.createRandom(), stranger = Wallet.createRandom();
const TX = '0x' + '12'.repeat(32);
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#f90"/></svg>';
const INFO = { address: TOKEN, name: 'Mango Coin', symbol: 'MANGO', decimals: 18, website: 'https://mango.example.org',
  description: 'A community token on ZETAPHY for the mango growers co-op.', creationTx: TX, links: { x: 'https://x.com/mango' } };

let compiled;
const chainWith = (code, over = {}) => ({
  code: async (a) => (getAddress(a) === TOKEN ? code : '0x'),
  tx: async (h) => (h === TX ? { from: creator.address, data: compiled.bytecode + '00'.repeat(0) } : null),
  receipt: async (h) => (h === TX ? { contractAddress: TOKEN } : null),
  call: async (to, data) => {
    const fn = R.ERC20.getFunction(data.slice(0, 10)).name;
    const v = { name: 'Mango Coin', symbol: 'MANGO', decimals: 18, totalSupply: 10n ** 24n, owner: creator.address, ...over }[fn];
    return R.ERC20.encodeFunctionResult(fn, [v]);
  },
});
// the code a real deploy leaves: the compiler's runtime with the immutable `owner` filled in
const deployed = (c) => {
  const b = Buffer.from(c.deployedBytecode.slice(2), 'hex');
  for (const refs of Object.values(c.immutableReferences)) for (const { start } of refs) Buffer.from(creator.address.slice(2).padStart(64, '0'), 'hex').copy(b, start);
  return '0x' + b.toString('hex');
};

test('info.json and logo.svg rules: impersonation, promises, unsafe SVGs are refused', () => {
  assert.deepEqual(R.checkInfo(INFO, TOKEN), []);
  assert.match(R.checkInfo({ ...INFO, symbol: 'ZTPHY' }, TOKEN).join(), /imitates/);
  assert.match(R.checkInfo({ ...INFO, name: 'USDT Pro' }, TOKEN).join(), /imitates/);
  assert.match(R.checkInfo({ ...INFO, description: 'Guaranteed 100x returns for every holder, soon.' }, TOKEN).join(), /profit/);
  assert.match(R.checkInfo({ ...INFO, website: 'http://mango.example.org' }, TOKEN).join(), /website/);
  assert.match(R.checkInfo(INFO, '0x' + 'cd'.repeat(20)).join(), /folder/);
  assert.match(R.checkInfo({ ...INFO, extra: 1 }, TOKEN).join(), /unknown field/);
  assert.deepEqual(R.checkLogo(LOGO), []);
  for (const bad of [LOGO.replace('width="32"', 'width="64"'), LOGO.replace('</svg>', '<script>x()</script></svg>'), LOGO.replace('<circle', '<image href="https://x/y.png"/><circle'),
    LOGO.replace('<circle', '<circle onload="x()"'), LOGO.replace('fill="#f90"', 'fill="url(https://x/p)"'), LOGO.replace('</svg>', '<animate/></svg>'), 'not svg'])
    assert.ok(R.checkLogo(bad).length, bad.slice(0, 80));
});

test('bytecodeMatch: full, partial (metadata only), immutables masked, anything else refused', async () => {
  compiled = await compile(SOURCE);
  const code = deployed(compiled);
  assert.equal(R.bytecodeMatch(code, compiled.deployedBytecode, compiled.immutableReferences), 'full');
  const b = Buffer.from(code.slice(2), 'hex'); b[b.length - 10] ^= 1; // inside the metadata hash
  assert.equal(R.bytecodeMatch('0x' + b.toString('hex'), compiled.deployedBytecode, compiled.immutableReferences), 'partial');
  const c = Buffer.from(code.slice(2), 'hex'); c[5] ^= 1; // an opcode
  assert.equal(R.bytecodeMatch('0x' + c.toString('hex'), compiled.deployedBytecode, compiled.immutableReferences), null);
  assert.equal(R.bytecodeMatch(code, compiled.deployedBytecode, {}), null, 'without masking the filled immutable differs');
});

test('a whole entry: accepted when the creator signs; every forgery is refused', async () => {
  compiled ??= await compile(SOURCE);
  const sign = async (w, info = INFO, logo = LOGO) => ({ signer: w.address, signature: await w.signMessage(R.message(info, logo)) });
  const entry = { folder: TOKEN, info: INFO, logo: LOGO, source: SOURCE, signature: await sign(creator) };
  const chain = chainWith(deployed(compiled));
  const ok = await R.checkEntry(entry, chain, compile);
  assert.deepEqual([ok.ok, ok.match, ok.signer], [true, 'full', creator.address], ok.problems?.join('\n'));
  // a stranger signs
  assert.match((await R.checkEntry({ ...entry, signature: await sign(stranger) }, chain, compile)).problems.join(), /neither the creator nor the owner/);
  // the signature was for another logo (the logo was swapped after signing)
  assert.match((await R.checkEntry({ ...entry, logo: LOGO.replace('#f90', '#000') }, chain, compile)).problems.join(), /signed by/);
  // the token says another symbol
  assert.match((await R.checkEntry(entry, chainWith(deployed(compiled), { symbol: 'MNG' }), compile)).problems.join(), /symbol\(\)/);
  // another contract's source (other runtime code)
  const src = (x) => ({ ...SOURCE, input: { ...SOURCE.input, sources: { 'Mango.sol': { content: x } } } });
  assert.match((await R.checkEntry({ ...entry, source: src(SRC.replace('decimals = 18', 'decimals = 8')) }, chain, compile)).problems.join(), /is not the code/);
  // the same runtime with another constructor (e.g. a hidden mint to someone else): the creation code differs
  assert.match((await R.checkEntry({ ...entry, source: src(SRC.replaceAll('1e24', '2e24')) }, chain, compile)).problems.join(), /creation code/);
  // creationTx of something else
  assert.match((await R.checkEntry({ ...entry, info: { ...INFO, creationTx: '0x' + '34'.repeat(32) } }, chain, compile)).problems.join(), /did not create/);
});

test('tokenlist.json: the Uniswap token-list shape, sorted, logos from the registry folder', () => {
  const l = R.tokenList([{ info: INFO }], { timestamp: '2026-11-20T00:00:00.000Z' });
  assert.deepEqual(l.tokens, [{ chainId: 3659, address: TOKEN, name: 'Mango Coin', symbol: 'MANGO', decimals: 18,
    logoURI: `https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-tokens/3659/${TOKEN}/logo.svg` }]);
  assert.equal(l.name, 'ZETAPHY token registry');
});
