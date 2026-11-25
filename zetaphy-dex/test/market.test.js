// lib/market.js: GeckoTerminal answers parsed from ZTPHY's side whichever token GeckoTerminal calls the base, candles
// cleaned and ordered, trades classified as buys and sells, and the numbers formatted the way trading sites show them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../web/lib/market.js';

const Z = '0x68aa0f0144605024eCe1aDccFCC1626352779569', U = '0x55d398326f99059fF775485246999027B3197955';

test('market: URLs name the pool, the frame and ZTPHY; an unknown frame is refused', () => {
  assert.equal(K.ohlcvUrl('0xpool', '4H', Z, 50), `https://api.geckoterminal.com/api/v2/networks/bsc/pools/0xpool/ohlcv/hour?aggregate=4&limit=50&currency=usd&token=${Z}`);
  assert.equal(K.tradesUrl('0xpool'), 'https://api.geckoterminal.com/api/v2/networks/bsc/pools/0xpool/trades');
  assert.throws(() => K.ohlcvUrl('0xpool', '2m', Z), /unknown frame/);
});

test('market: candles oldest first, duplicates and bad rows dropped, high/low widened to the body', () => {
  const c = K.parseOhlcv({ data: { attributes: { ohlcv_list: [[300, 2, 3, 1, 2.5, 10], [100, 1, 1, 1, 1, 0], [200, 1, 0.5, 2, 2, 1], [200, 9, 9, 9, 9, 9], ['x', 1, 1, 1, 1], [400, -1, 1, 1, 1, 1]] } } });
  assert.deepEqual(c.map((x) => x.t), [100, 200, 300]);
  assert.deepEqual(c[1], { t: 200, o: 1, h: 2, l: 1, c: 2, v: 1 });
  assert.deepEqual(K.parseOhlcv({}), []);
  assert.deepEqual(K.parseOhlcv(null), []);
});

test('market: trades from ZTPHY\'s side (buy = ZTPHY out of the pool), newest first; other tokens and bad rows ignored', () => {
  const row = (ts, from, to, fa, ta, pf, pt, tx) => ({ attributes: { block_timestamp: new Date(ts).toISOString(), from_token_address: from.toLowerCase(), to_token_address: to.toLowerCase(), from_token_amount: fa, to_token_amount: ta, price_from_in_usd: pf, price_to_in_usd: pt, volume_in_usd: '1', tx_hash: tx } });
  const tr = K.parseTrades({ data: [
    row(1000, U, Z, '1', '9000', '1', '0.000111', '0x' + 'a'.repeat(64)),
    row(5000, Z, U, '5000', '0.5', '0.0001', '1', 'not-a-hash'),
    row(3000, U, '0x' + '1'.repeat(40), '1', '1', '1', '1', null),
    { attributes: { block_timestamp: 'nope', from_token_address: Z, to_token_address: U } },
  ] }, Z);
  assert.equal(tr.length, 2);
  assert.deepEqual(tr.map((x) => [x.side, x.amount, x.price]), [['sell', 5000, 0.0001], ['buy', 9000, 0.000111]]);
  assert.equal(tr[0].tx, null, 'a malformed hash is not linked');
  assert.equal(tr[1].tx, '0x' + 'a'.repeat(64));
});

test('market: pool stats when ZTPHY is the base, and when it is the quote (price, change and buys/sells turned around)', () => {
  const attrs = { base_token_price_usd: '0.0001', quote_token_price_usd: '1', reserve_in_usd: '100', volume_usd: { h24: '5' }, price_change_percentage: { h24: '100' }, transactions: { h24: { buys: 4, sells: 1 } }, fdv_usd: '10' };
  const asBase = K.parsePool({ data: { attributes: attrs, relationships: { base_token: { data: { id: `bsc_${Z.toLowerCase()}` } } } } }, Z);
  assert.deepEqual(asBase, { price: 0.0001, change24: 100, volume24: 5, liquidity: 100, buys24: 4, sells24: 1, fdv: 10 });
  const asQuote = K.parsePool({ data: { attributes: { ...attrs, base_token_price_usd: '1', quote_token_price_usd: '0.0002' }, relationships: { base_token: { data: { id: `bsc_${U.toLowerCase()}` } } } } }, Z);
  assert.equal(asQuote.price, 0.0002);
  assert.equal(asQuote.change24, -50, 'the base doubling is the quote halving');
  assert.deepEqual([asQuote.buys24, asQuote.sells24], [1, 4]);
  assert.equal(K.parsePool({}, Z), null);
});

test('market: candles from trades, the range change and axis ticks', () => {
  const c = K.candlesFromTrades([{ time: 3_700_000, price: 3, usd: 1 }, { time: 1_000, price: 1, usd: 2 }, { time: 2_000, price: 2, usd: 3 }], 3600);
  assert.deepEqual(c, [{ t: 0, o: 1, h: 2, l: 1, c: 2, v: 5 }, { t: 3600, o: 3, h: 3, l: 3, c: 3, v: 1 }]);
  assert.deepEqual(K.rangeChange(c), { abs: 2, pct: 200 });
  assert.equal(K.rangeChange([]), null);
  assert.deepEqual(K.ticks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  const flat = K.ticks(0.0001, 0.0001);
  assert.ok(flat.length >= 2 && flat[0] < 0.0001 && flat.at(-1) > 0.0001, 'a flat price still gets an axis');
});

test('market: prices, USD, amounts, percentages and ages read like a trading site', () => {
  assert.equal(K.fmtPrice(0.0001), '0.0001');
  assert.equal(K.fmtPrice(0.00012345), '0.0001235');
  assert.equal(K.fmtPrice(0.0000012345), '0.0₅1235');
  assert.equal(K.fmtPrice(1.5), '1.5');
  assert.equal(K.fmtPrice(12345.678), '12,345.68');
  assert.equal(K.fmtPrice(null), '–');
  assert.equal(K.fmtUsd(12.345), '$12.35');
  assert.equal(K.fmtUsd(12_345), '$12.3K');
  assert.equal(K.fmtUsd(4_500_000), '$4.50M');
  assert.equal(K.fmtUsd(0.05), '$0.05');
  assert.equal(K.fmtAmount(9500), '9,500');
  assert.equal(K.fmtAmount(500_000), '500.0K');
  assert.equal(K.fmtPct(2.5), '+2.50%');
  assert.equal(K.fmtPct(-1), '-1.00%');
  assert.equal(K.ago(0, 59_000), '59s');
  assert.equal(K.ago(0, 3_600_000), '1h');
  assert.equal(K.ago(0, 2 * 86_400_000), '2d');
  assert.deepEqual([50, 299, 999, 1000].map(K.impactLevel), ['low', 'medium', 'high', 'severe']);
  assert.equal(K.portion(1000n, 25), 250n);
  assert.equal(K.portion(999n, 100), 999n);
});

test('bsc.js trimDec: trailing zeros go only after the decimal point (500 stays 500)', async () => {
  const { trimDec } = await import('../web/bsc.js');
  assert.deepEqual(['500', '500.000', '0.250', '1.0', '10'].map(trimDec), ['500', '500', '0.25', '1', '10']);
});
