# Review Contract Synchronization

**Related issue:** #637  

On-chain review records and off-chain moderation state must stay related without
silently diverging rating displays.

## Field split

| Field | Layer | Mutable by moderation? |
|---|---|---|
| `on_chain_id` | Chain reference | **No** — immutable once linked |
| `on_chain_tx_hash` | Chain reference | **No** |
| `rating` (display source of truth when linked) | Chain | **No** — mismatch → repair queue |
| `comment` / `original_comment` | Off-chain projection | Hide/reject only; never rewrite chain |
| `moderation_status`, `policy_code`, `policy_version` | Off-chain | Yes |
| `visible_in_aggregates` | Off-chain projection | Yes |
| `host_response*` | Off-chain only | Yes (with audit history) |

## Event → database mapping

1. Ingest / poll review IDs via `ReviewClient.reviewCount` + `getReview`.
2. Match by `reviews.on_chain_id`.
3. On match: refresh `chain_synced_at`, set `chain_sync_status = linked`.
4. On missing DB row for a chain ID: enqueue `orphan_chain`.
5. On DB row with `on_chain_id` but chain read fails: enqueue `missing`.
6. On duplicate `on_chain_id`: enqueue `duplicate`.
7. On rating/comment conflict vs chain: enqueue `conflict` / `rating_mismatch`
   and raise a mismatch alert (`system_alert` to admins).

## Repair queue

Table: `review_sync_repair_queue`

Statuses: `open` → `in_progress` → `resolved` | `ignored`.

Moderation **cannot** rewrite chain data to “fix” a mismatch. Operators
reconcile by linking the correct off-chain row or ignoring false positives.

## Display rule

Every publicly displayed on-chain review must expose a verifiable reference
(`on_chain_id` and optionally `on_chain_tx_hash`). Reviews with
`chain_sync_status` in (`mismatch`, `duplicate`) stay out of “verified on-chain”
badges until repaired.
