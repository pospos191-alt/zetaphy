// Plan helpers shared by the mainnet steps (src/mainnet.js, src/mainnetall.js): a deployment is described once
// (contract, constructor arguments) and used by the dry run (printed and priced) and by the run (deployed).

import { Contract, ContractFactory, getAddress } from 'ethers';
import { art } from './steps.js';

/** A not-yet-deployed address in a plan: printed by name, priced with the deployer's address in its place. */
export const later = (label, stand) => ({ later: label, ...(stand !== undefined ? { stand } : {}) });
export const isLater = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && 'later' in v;
/** The argument with every not-yet-deployed address refused (at any depth: arrays of tuples too). */
export const real = (v) => { if (isLater(v)) throw new Error(`${v.later} is not deployed yet`); return Array.isArray(v) ? v.map(real) : v; };
export const ref = (o, key, label) => o[key] ?? later(label);
/** The arguments with `stand` for every not-yet-deployed address (at any depth), for a gas estimate. */
export const resolveArgs = (args, stand) => args.map((a) => (isLater(a) ? (a.stand ?? stand) : Array.isArray(a) ? resolveArgs(a, stand) : a));

/** A deployment of `name` (zetaphy-network unless pkg) with `args`. */
export const dep = (key, name, args, { pkg = 'zetaphy-network', note } = {}) => ({ key, pkg, name, args, note });

export const deployOne = async (ctx, s, d) => {
  const a = art(d.pkg, d.name);
  const k = await new ContractFactory(a.abi, a.bytecode, s).deploy(...d.args.map(real));
  await k.waitForDeployment();
  const address = getAddress(await k.getAddress());
  ctx.log(`  ${d.name} ${address}`);
  return new Contract(address, a.abi, s);
};
