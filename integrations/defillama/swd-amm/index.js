// DefiLlama TVL adapter for SWD AMM (https://swd-zetaphy.sawasdeecoin.com).
//
// Goes in the DefiLlama-Adapters repo as projects/swd-amm/index.js.
// Test there with:  node test.js projects/swd-amm/index.js
//
// TVL = the token balances of every pool vault of the swd_amm program.
// The program has three pool account types. All three store vault_a at
// bytes 72..104 and vault_b at bytes 104..136 (8-byte Anchor
// discriminator, then mint_a, mint_b, vault_a, vault_b as 32-byte keys):
//   Pool         (constant product)  discriminator f19a6d0411b16dbc
//   DlmmPool     (bin-based)         discriminator e630d88cee86b894
//   SwdmmV2Pool  (SWDMM v2)          discriminator 3c6f01cf3a1e13d7
// (sha256("account:<Name>")[0..8], written in base58 below for memcmp.)
// Vaults hold the pool reserves plus LP fees not yet claimed and protocol
// fees not yet withdrawn, which is what DefiLlama counts for other DEXes.
//
// PROGRAM_ID: set to the MAINNET program id after the mainnet deploy.
// The value below is the devnet id; on mainnet it has no accounts, so the
// adapter returns 0 until it is replaced.

const { PublicKey } = require('@solana/web3.js')
const { getConnection, sumTokens2 } = require('../helper/solana')

const PROGRAM_ID = '3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL' // TODO: mainnet program id

const POOL_DISCRIMINATORS = {
  Pool: 'hQrXeCntzbV',
  DlmmPool: 'fW956v6sbZD',
  SwdmmV2Pool: 'B7HM5JaZuSn',
}
const VAULT_A_OFFSET = 72
const VAULT_B_OFFSET = 104

async function tvl(api) {
  const connection = getConnection()
  const programId = new PublicKey(PROGRAM_ID)
  const tokenAccounts = []
  for (const discriminator of Object.values(POOL_DISCRIMINATORS)) {
    const accounts = await connection.getProgramAccounts(programId, {
      // only the two vault addresses are needed
      dataSlice: { offset: VAULT_A_OFFSET, length: 64 },
      filters: [{ memcmp: { offset: 0, bytes: discriminator } }],
    })
    for (const { account } of accounts) {
      const data = account.data
      tokenAccounts.push(new PublicKey(data.subarray(0, 32)).toString())
      tokenAccounts.push(new PublicKey(data.subarray(32, 64)).toString())
    }
  }
  return sumTokens2({ api, tokenAccounts })
}

module.exports = {
  timetravel: false,
  methodology:
    'TVL is the sum of the token balances held in the vaults of every SWD AMM pool (constant-product, DLMM and SWDMM v2), found with getProgramAccounts on the swd_amm program.',
  solana: { tvl },
}
