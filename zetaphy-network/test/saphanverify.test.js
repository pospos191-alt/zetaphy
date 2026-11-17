// scripts/saphan-verify-input.js: the files for the explorers' free "Verify and Publish" form, for a route's synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface, ZeroAddress, ZeroHash } from 'ethers';
import solc from 'solc';
import { constructorArgs, formValues, standardInput } from '../scripts/saphan-verify-input.js';

const ART = JSON.parse(readFileSync(new URL('../artifacts/SaphanSyntheticToken.json', import.meta.url), 'utf8'));

test('the trimmed standard-JSON input (the synthetic\'s own file) compiles to exactly the committed bytecode', () => {
  const input = standardInput();
  assert.deepEqual(Object.keys(input.sources), ['contracts/SaphanTokens.sol']);
  assert.equal(input.settings.optimizer.runs, 200);
  assert.equal(input.settings.evmVersion, 'cancun');
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.deepEqual((out.errors ?? []).filter((e) => e.severity === 'error'), []);
  const c = out.contracts['contracts/SaphanTokens.sol'].SaphanSyntheticToken;
  assert.equal('0x' + c.evm.bytecode.object, ART.bytecode, 'byte for byte, metadata hash included');
});

test('constructor arguments: the creation input after the committed bytecode; any other bytecode is refused', () => {
  const iface = new Interface(ART.abi);
  const ctor = iface.deploy.inputs;
  // build arguments of the right shape from the ABI, whatever the Config tuple holds
  const sample = (p) => p.baseType === 'tuple' ? p.components.map(sample) : p.baseType === 'string' ? 'ZTPHY' : p.baseType === 'address' ? ZeroAddress
    : p.baseType === 'bytes32' ? ZeroHash : p.baseType === 'bool' ? false : 7n;
  const args = ctor.map(sample);
  assert.equal(args.length, 5, 'name, symbol, decimals, Config, supplyCap');
  const enc = iface.encodeDeploy(args).slice(2);
  assert.equal(constructorArgs(ART.bytecode + enc), enc);
  assert.equal(constructorArgs((ART.bytecode + enc).toUpperCase().replace(/^0X/, '0x')), enc.toLowerCase());
  const other = ART.bytecode.slice(0, -2) + (ART.bytecode.endsWith('00') ? '01' : '00');
  assert.throws(() => constructorArgs(other + enc), /does not start with the committed SaphanSyntheticToken bytecode/);
  assert.throws(() => constructorArgs(ART.bytecode + enc + 'ab'), /whole 32-byte words/);
});

test('the form values: standard JSON, the exact compiler, MIT, the fully qualified name', () => {
  assert.deepEqual(formValues(), { compilerType: 'Solidity (Standard-Json-Input)', compilerVersion: 'v0.8.26+commit.8a97fa7a', license: 'MIT License (MIT)',
    contractName: 'contracts/SaphanTokens.sol:SaphanSyntheticToken', optimizer: 'yes, 200 runs', evmVersion: 'cancun' });
  assert.match(readFileSync(new URL('../contracts/SaphanTokens.sol', import.meta.url), 'utf8'), /^\/\/ SPDX-License-Identifier: MIT/);
});
