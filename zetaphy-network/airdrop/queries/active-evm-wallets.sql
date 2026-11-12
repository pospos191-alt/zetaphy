-- Active Ethereum wallets for a retroactive, CLAIM-BASED ZTPHY airdrop (docs/AIRDROP.md, "Recipients from public chains").
-- Runs on Google BigQuery's public dataset bigquery-public-data.crypto_ethereum, in the owner's own Google Cloud project.
-- Output: address,score (score = distinct active days in the window), the top 100,000; feed it to
--   node airdrop/cli.js from-csv active.csv --weight score --cap <ZTPHY> --rpc <Ethereum RPC>    (or --equal)
--
-- Who is kept (an EOA that a person plausibly uses):
--   * >= min_success_txs successful transactions sent (receipt_status = 1) in the window
--   * activity in >= min_months distinct calendar months
--   * last transaction within the last recent_months before window_end (still active)
--   * first transaction in the window at least min_age_months before window_end (not a fresh farm wallet)
--   * not a high-volume address: <= max_total_txs in the window and <= max_txs_per_day on its busiest day
--     (exchanges, market makers, bots, airdrop farms that batch)
--   * not a contract (anti-join on crypto_ethereum.contracts). Transaction senders are EOAs anyway; the join is a
--     guard. EIP-7702-delegated EOAs are people's keys and stay. The CLI's --rpc eth_getCode check runs again later.
-- Sybil farms that fund many wallets from one source within a short window are NOT filtered here (future step,
-- docs/AIRDROP.md); the activity rules above and the per-address cap in the CLI limit what a farm can get.
--
-- Cost (free tier = 1 TB of query processing per month): BigQuery bills the columns read in the partitions read.
-- `transactions` is partitioned by DAY on block_timestamp; the WHERE below prunes to the window. Columns read:
-- from_address (~44 B), block_timestamp (8 B), receipt_status (8 B) = ~60 B per transaction. Ethereum has carried
-- ~1.1-1.4 M transactions a day in 2024-2026, so a 24-month window is ~1.0 B rows, ~60 GB; `contracts`.address is a
-- few GB. Expect ~60-70 GB per run (about 15 runs fit in the free 1 TB). Before running: set "Maximum bytes billed"
-- (Query settings -> Advanced) to e.g. 150 GB so a mistake fails instead of billing, and check the editor's estimate.
-- (The estimate of a script with DECLAREd dates may show the whole table; the run itself still prunes partitions.
-- To see the pruned estimate, replace window_start / window_end below by literal dates once.)

DECLARE window_end DATE DEFAULT CURRENT_DATE();
DECLARE lookback_months INT64 DEFAULT 24;     -- how far back the window starts (and how old a wallet can look)
DECLARE recent_months INT64 DEFAULT 6;        -- last activity within this many months of window_end
DECLARE min_age_months INT64 DEFAULT 6;       -- first activity at least this many months before window_end
DECLARE min_success_txs INT64 DEFAULT 10;
DECLARE min_months INT64 DEFAULT 3;
DECLARE max_total_txs INT64 DEFAULT 50000;
DECLARE max_txs_per_day INT64 DEFAULT 500;
DECLARE top_n INT64 DEFAULT 100000;
DECLARE window_start DATE DEFAULT DATE_SUB(window_end, INTERVAL lookback_months MONTH);

WITH daily AS (
  SELECT
    from_address AS address,
    DATE(block_timestamp) AS day,
    COUNT(*) AS txs,
    COUNTIF(receipt_status = 1) AS ok_txs
  FROM `bigquery-public-data.crypto_ethereum.transactions`
  WHERE block_timestamp >= TIMESTAMP(window_start)            -- partition filter
    AND block_timestamp < TIMESTAMP(DATE_ADD(window_end, INTERVAL 1 DAY))
  GROUP BY address, day
),
per_address AS (
  SELECT
    address,
    SUM(txs) AS total_txs,
    SUM(ok_txs) AS ok_txs,
    MAX(txs) AS busiest_day_txs,
    COUNTIF(ok_txs > 0) AS active_days,
    COUNT(DISTINCT DATE_TRUNC(day, MONTH)) AS active_months,
    MIN(day) AS first_day,
    MAX(day) AS last_day
  FROM daily
  GROUP BY address
)
SELECT p.address, p.active_days AS score
FROM per_address AS p
LEFT JOIN `bigquery-public-data.crypto_ethereum.contracts` AS c ON c.address = p.address
WHERE c.address IS NULL
  AND p.ok_txs >= min_success_txs
  AND p.active_months >= min_months
  AND p.last_day >= DATE_SUB(window_end, INTERVAL recent_months MONTH)
  AND p.first_day <= DATE_SUB(window_end, INTERVAL min_age_months MONTH)
  AND p.total_txs <= max_total_txs
  AND p.busiest_day_txs <= max_txs_per_day
ORDER BY score DESC, p.address
LIMIT top_n;
