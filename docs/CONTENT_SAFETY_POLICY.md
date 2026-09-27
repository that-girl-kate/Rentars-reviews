# Content Safety Policy

**Policy version:** `2026-09-27.1`  
**Effective date:** 2026-09-27  

This document is the human-readable counterpart of
`apps/backend/src/services/contentSafetyPolicy.service.ts`. UI copy, API reason
codes, and moderator tools must use the same versioned taxonomy. Changing this
policy **does not rewrite** historical moderation decisions — each decision
stores `policy_code` and `policy_version` at the time it was made.

## Covered categories

| Reason code | Label | Default enforcement | Appealable |
|---|---|---|---|
| `harassment` | Harassment | Hide content | Yes |
| `discrimination` | Discrimination | Hide content | Yes |
| `fraud` | Fraud | Escalate | Yes |
| `unsafe_property` | Unsafe property | Escalate (listings) | Yes |
| `privacy_violation` | Privacy violation | Hide content | Yes |
| `retaliatory_review` | Retaliatory review | Hide content | Yes |
| `spam` | Spam | Reject content | Yes |
| `inappropriate` | Inappropriate content | Hide content | Yes |
| `misleading` | Misleading | Flag for review | Yes |
| `other` | Other | Flag for review | Yes |

## Enforcement actions

| Action | Effect |
|---|---|
| `none` | No automatic visibility change |
| `flag_for_review` | Queues item for moderators; stays visible until decided |
| `hide_content` | Removes from public display and rating aggregates |
| `reject_content` | Rejects / removes from discovery; original body retained |
| `escalate` | High-priority moderator queue + optional ops alert |
| `notify_parties` | Status notifications without confidentiality leaks |

Moderator notes (`moderation_reason`, internal appeal notes) are **never**
returned to end users. Users receive only `public_status_explanation`.

## Appeal rules

- Appeal window: **14 days** from the visibility-changing decision
  (`appeal_deadline_at`).
- Eligible states: `rejected`, `hidden`.
- Outcomes: restore (`approved` + visible), uphold (`appeal_denied`), or expire.
- Appeals stamp the **current** policy version on the resolution; the original
  decision row keeps its prior `policy_version`.

## Retention

- Moderated content snapshots (`original_comment`, host response history):
  retained **730 days** unless a legal hold applies.
- Historical decisions keep their stamped policy codes forever for audit.

## Host responses

- Only the **current** authorized property owner may respond.
- One **visible** response per review.
- Edit window: **24 hours** after first publish; edits append to
  `host_response_history`.
- Moderated / removed responses leave public display but remain auditable in
  history.

## Alignment surfaces

| Surface | Source of truth |
|---|---|
| API validation | `SAFETY_REASON_CODES` / `assertReviewReason` |
| Report reasons | Mapped via `mapLegacyReportReason` |
| Moderator UI | `GET /api/v1/policy/safety` |
| Public UI copy | `publicStatusCopy` per reason |
| Fixtures | `apps/backend/src/fixtures/safetyPolicy.fixture.ts` |

## Version history

| Version | Date | Notes |
|---|---|---|
| `2026-09-27.1` | 2026-09-27 | Initial versioned safety taxonomy (#638) |
