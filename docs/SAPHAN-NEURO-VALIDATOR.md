**English** | [ภาษาไทย](SAPHAN-NEURO-VALIDATOR.th.md)

# The Neuro validator: a second, independent signer for Saphan

Today one key on the sentry signs every ZETAPHY -> BSC / Base message (the ISM on each synthetic is **1 of 1**): a
stolen key could mint unbacked ZTPHY up to the caps, stopped only by the 1-hour delay and a guardian veto. The Neuro
validator is a second signer on **another machine, another cloud, another key**. Once the ISM on each synthetic is
**2 of 2** (our Hyperlane validator + the Neuro validator), the sentry's key alone mints nothing.

| | |
|---|---|
| Signer | [`zetaphy-network/scripts/neuro-validator.js`](../zetaphy-network/scripts/neuro-validator.js) ([`src/neurovalidator.js`](../zetaphy-network/src/neurovalidator.js)) |
| Its machine | [`neuro-validator-host.sh`](../zetaphy-network/scripts/neuro-validator-host.sh): a Google Cloud e2-micro VM (free tier), Docker, systemd |
| The ISM switch | [`saphan-ism.js`](../zetaphy-network/scripts/saphan-ism.js): a new ISM through Hyperlane's factory, set through each route's timelock (48 h) |
| Tests | `cd zetaphy-network && node --test test/neurovalidator.test.js` |

## What it signs

It follows the Mailbox's merkle tree (MerkleTreeHook `InsertedIntoTree`), rebuilds it and refuses to sign anything if
its root and count differ from the hook's own. For each new leaf it reads the transaction and signs the message
(a Hyperlane message-id checkpoint, the exact format Hyperlane's validators store) **only if**:

1. the Mailbox `Dispatch` came from one of OUR vaults, to that route's domain and synthetic;
2. the body names that vault, that synthetic and that chain;
3. the vault emitted `Sent(nonce, sender, to, amount, messageId)` for this message id in the same transaction, and it
   agrees with the body;
4. the amount is within the destination's daily mint limit;
5. **Neuro**: neither the sender nor the receiver is held in the ThreatRegistry (`isContractHeld`). A held message is not
   refused for good: it waits, is re-checked on every pass, and is signed once the hold is lifted.

Anything else (another app's message, a forged one) is never signed, so the relayer cannot deliver it through a 2-of-2
ISM. The return direction (BSC / Base -> ZETAPHY) already needs 3 of Hyperlane's 5 validators and is unchanged.

## Limits (read before relying on it)

- **Its view of ZETAPHY comes from the sentry's RPC** (there is no other public node yet). It protects against a
  stolen validator key, the likeliest attack; an attacker who controls the sentry's node itself could feed both signers
  the same false chain. A second full node anywhere (a community validator) removes this.
- **2 of 2 means either signer down stops ZETAPHY -> destination transfers** (nothing is lost: messages wait). The
  watch reports it; the systemd service restarts the validator.
- The relayer reads the Neuro validator's checkpoints from a **public-read Cloud Storage bucket** (`gs://…`). Hyperlane's agents read a GCS validator's latest index from the object `gcsLatestIndexKey`. They also parse `gs://bucket/folder` as the bucket with no folder. So the validator writes its checkpoints and `gcsLatestIndexKey` in the folder and again at the bucket root, which is where the relayer reads them (2026-11-25: the first Base message waited for quorum until this was done).

## Setting it up

### 1. The machine and the bucket (Google Cloud Shell) [เปลี่ยนการตั้งค่า]

```bash
BUCKET=zetaphy-neuro-$(openssl rand -hex 3); ZONE=us-central1-a; echo "bucket: $BUCKET"
gcloud storage buckets create gs://$BUCKET --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=allUsers --role=roles/storage.objectViewer
gcloud compute instances create neuro-validator --zone=$ZONE --machine-type=e2-micro --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --scopes=storage-rw
SA=$(gcloud compute instances describe neuro-validator --zone $ZONE --format='value(serviceAccounts[0].email)')
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
gcloud compute ssh neuro-validator --zone $ZONE --command "curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-network/scripts/neuro-validator-host.sh -o h.sh && sudo bash h.sh install gs://$BUCKET/neuro"
```

e2-micro in us-central1, a 30 GB standard disk and 5 GB of Cloud Storage are in Google's free tier. The last line
prints the **validator address**; the key never leaves the VM.

### 2. Announce it [เปลี่ยนเชน]

Send it 0.1 ZTPHY on ZETAPHY, then on the VM: `sudo bash h.sh announce --send yes`.

### 3. Switch each route's ISM to 2 of 2 [เปลี่ยนเชน]

On Oracle Cloud Shell, in `~/zetaphy/zetaphy-network`, for `bsc` and then `base`:

```bash
KEYFILE=/dev/shm/dk node scripts/saphan-ism.js deploy --route bsc --add 0xNEURO --send yes   # the new ISM (deployer pays gas)
read -rs M; export M; node scripts/saphan-ism.js propose --route bsc; unset M                 # guardian 1
read -rs M; export M; node scripts/saphan-ism.js confirm <n> --route bsc; unset M             # guardian 2
# 48 hours later:
KEYFILE=/dev/shm/dk node scripts/saphan-ism.js execute --route bsc --send yes
node scripts/saphan-ism.js status --route bsc                                                # 2 of [...], both announced
```

**Before the execute**, check with `status` that the Neuro validator is announced and that its bucket holds
`checkpoint_<n>_with_id.json` for the latest transfers: otherwise the switch stops the route until it signs.
Key watch reports the schedule as CRITICAL ("the ISM … changed"): expected.
