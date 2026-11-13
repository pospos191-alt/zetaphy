// Round-1 link collection (docs/AIRDROP-ROUND1.md): holders submit their Solana -> EVM link publicly, as a GitHub
// issue made with the form .github/ISSUE_TEMPLATE/airdrop-link.yml (no server, nothing private). The owner downloads
// the issues as the GitHub REST API returns them:
//
//   gh api --paginate --slurp 'repos/pospos191-alt/zetaphy/issues?state=all&per_page=100' > issues.json
//   curl -s 'https://api.github.com/repos/pospos191-alt/zetaphy/issues?state=all&per_page=100&page=1' > issues.json
//
// and turns them into links.json for `cli.js link-solana`: every link's signature is checked with link.js for the
// round's chain id (3659); invalid, duplicate and conflicting links are dropped and reported the way link-solana does.
// Accepted input: an array of issues, `gh --paginate` output (several arrays one after another), `--slurp` output
// (an array of arrays) or a search result ({items: [...]}). Pull requests and issues that are not this form are
// skipped; issues closed as "not planned" (a holder withdrawing a wrong link, or the owner rejecting spam) are skipped
// and listed. With a deadline, issues created after it are rejected.

import { verifyLink } from './link.js';

/** The form's fields: [label in the form, …other labels accepted]. The labels are the `### headings` of the issue body. */
export const FIELDS = {
  solana: ['Solana address', 'Solana wallet', 'Solana'],
  evm: ['EVM address', 'ZETAPHY address', 'EVM'],
  chain: ['Chain id', 'Chain ID', 'Chain'],
  signature: ['Signature'],
  safety: ['Safety'],
};
const NORM = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const BY_LABEL = new Map(Object.entries(FIELDS).flatMap(([k, labels]) => labels.map((l) => [NORM(l), k])));
const NO_ANSWER = /^_?no response_?$/i;

/** One field's text: code fences, backticks, quotes, zero-width characters and all whitespace removed (the values have none). */
const clean = (v) => v.replace(/^```[^\n]*\n?|```$/g, '').replace(/[`'"​-‍﻿<>]/g, '').replace(/\s+/g, '');

/**
 * Parses an issue body of the form into {solana, evm, chainId, signature, confirmed}; null when it is not the form
 * (no Solana and no signature heading).
 */
export function parseIssue(body) {
  if (typeof body !== 'string') return null;
  const parts = {};
  let key = null;
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) { key = BY_LABEL.get(NORM(h[1])) ?? null; if (key) parts[key] = ''; continue; }
    if (key) parts[key] += `${line}\n`;
  }
  if (parts.solana == null && parts.signature == null) return null;
  const val = (k) => { const t = (parts[k] ?? '').trim(); return NO_ANSWER.test(t) ? '' : clean(t); };
  const safety = parts.safety ?? '';
  return {
    solana: val('solana'),
    evm: val('evm'),
    chainId: val('chain'),
    signature: val('signature'),
    confirmed: /^\s*[-*]\s*\[[xX]\]/m.test(safety),
  };
}

/** The issues of a GitHub API answer (see the top of this file). */
export function issuesOf(text) {
  const values = [];
  const s = String(text).trim();
  try { values.push(JSON.parse(s)); } catch {
    // `gh api --paginate` without --slurp: JSON documents one after another
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '[' || c === '{') { if (depth++ === 0) start = i; }
      else if (c === ']' || c === '}') { if (--depth === 0) values.push(JSON.parse(s.slice(start, i + 1))); }
    }
    if (!values.length || depth !== 0) throw new Error('not the JSON of the GitHub issues API');
  }
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && Array.isArray(v.items)) v.items.forEach(walk);
    else if (v && typeof v === 'object' && 'number' in v) out.push(v);
  };
  values.forEach(walk);
  return out;
}

/**
 * Issues -> verified links.
 * @param {Array<object>} issues  GitHub issue objects ({number, html_url, user, body, created_at, state, state_reason, pull_request?})
 * @param {{chainId?: number, deadline?: number|null}} [o]  deadline: unix ms; issues created after it are rejected
 */
export function linksFromIssues(issues, { chainId = 3659, deadline = null } = {}) {
  const seen = new Set();
  const skipped = [];
  const rejected = [];
  const accepted = [];
  let duplicates = 0;
  const sorted = [...issues].filter((i) => {
    if (seen.has(i.number)) return false; // the same issue twice in the input (overlapping pages)
    seen.add(i.number);
    return true;
  }).sort((a, b) => a.number - b.number);
  for (const iss of sorted) {
    if (iss.pull_request) continue;
    const f = parseIssue(iss.body);
    const where = { issue: iss.number, url: iss.html_url ?? null, author: iss.user?.login ?? null };
    if (!f) { skipped.push({ ...where, reason: 'not-the-link-form' }); continue; }
    if (iss.state === 'closed' && iss.state_reason === 'not_planned') { skipped.push({ ...where, solana: f.solana || null, reason: 'closed-not-planned' }); continue; }
    const fail = (reason) => rejected.push({ ...where, solana: f.solana || null, evm: f.evm || null, reason });
    if (deadline != null && Date.parse(iss.created_at) > deadline) { fail('after-deadline'); continue; }
    if (!f.confirmed) { fail('safety-box-not-ticked'); continue; }
    const v = verifyLink({ solana: f.solana, evm: f.evm, signature: f.signature, chainId: f.chainId === '' ? undefined : f.chainId }, chainId);
    if (!v.ok) { fail(v.reason); continue; }
    accepted.push({ ...where, solana: v.solana, evm: v.evm, signature: f.signature });
  }
  // one EVM address per Solana owner (link.js linkSolana's rule): the same link again counts once (the first issue
  // is kept); different EVM addresses for one owner is a conflict and every issue of that owner is left out
  const byOwner = new Map();
  for (const a of accepted) byOwner.set(a.solana, [...(byOwner.get(a.solana) ?? []), a]);
  const links = [];
  const conflicts = [];
  for (const [solana, list] of byOwner) {
    const evms = [...new Set(list.map((a) => a.evm))];
    if (evms.length > 1) { conflicts.push({ solana, evms, issues: list.map((a) => a.issue), reason: 'conflict: several EVM addresses for one Solana owner' }); continue; }
    duplicates += list.length - 1;
    const [first] = list;
    links.push({ solana, evm: first.evm, signature: first.signature, chainId, issue: first.issue, ...(list.length > 1 ? { alsoIn: list.slice(1).map((a) => a.issue) } : {}), author: first.author });
  }
  links.sort((a, b) => a.issue - b.issue);
  return {
    chainId,
    message: 'ZETAPHY airdrop: link <solanaOwner> to <0xEVM> on <chainId>',
    ...(deadline != null ? { deadline: new Date(deadline).toISOString() } : {}),
    issues: sorted.length,
    count: links.length,
    duplicates,
    conflicts,
    rejected,
    skipped,
    links,
  };
}
