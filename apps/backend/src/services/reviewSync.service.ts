/**
 * reviewSync.service.ts — on-chain review ↔ off-chain moderation reconciliation (#637).
 *
 * Chain fields (on_chain_id, rating when linked) are never rewritten by moderation.
 * Mismatches, duplicates, and missing events enter review_sync_repair_queue.
 */

import {
  NETWORK_PASSPHRASE,
  REVIEW_CONTRACT_ID,
  STELLAR_RPC_URL,
} from '@/blockchain/config.js';
import { ReviewClient } from '@/blockchain/reviewClient.js';
import { supabase } from '@/config/supabase.js';
import { createNotification } from './notification.service.js';
import type { ServiceResponse } from './index.js';

export type ReviewRepairIssue =
  | 'missing'
  | 'duplicate'
  | 'conflict'
  | 'orphan_chain'
  | 'rating_mismatch'
  | 'comment_mismatch';

export interface ReviewRepairItem {
  id: string;
  review_id: string | null;
  on_chain_id: number | null;
  issue_type: ReviewRepairIssue;
  details: Record<string, unknown>;
  status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  created_at?: string;
}

function buildReviewClient(): ReviewClient {
  return new ReviewClient(REVIEW_CONTRACT_ID, STELLAR_RPC_URL, NETWORK_PASSPHRASE);
}

async function writeSyncLog(
  entityId: string,
  status: 'success' | 'failed' | 'skipped',
  errorMessage?: string,
): Promise<void> {
  await supabase.from('sync_log').insert({
    entity_type: 'review',
    entity_id: entityId,
    status,
    error_message: errorMessage ?? null,
    synced_at: new Date().toISOString(),
  });
}

async function enqueueRepair(params: {
  reviewId?: string | null;
  onChainId?: number | null;
  issueType: ReviewRepairIssue;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('review_sync_repair_queue').upsert(
    {
      review_id: params.reviewId ?? null,
      on_chain_id: params.onChainId ?? null,
      issue_type: params.issueType,
      details: params.details ?? {},
      status: 'open',
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'review_id,issue_type,on_chain_id',
      ignoreDuplicates: false,
    },
  );

  // Unique partial index may not map to onConflict; fall back to insert-ignore
  if (error) {
    await supabase.from('review_sync_repair_queue').insert({
      review_id: params.reviewId ?? null,
      on_chain_id: params.onChainId ?? null,
      issue_type: params.issueType,
      details: params.details ?? {},
      status: 'open',
    });
  }

  await alertAdmins(params.issueType, params.onChainId ?? null, params.reviewId ?? null);
}

async function alertAdmins(
  issueType: ReviewRepairIssue,
  onChainId: number | null,
  reviewId: string | null,
): Promise<void> {
  const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
  if (!admins) return;

  for (const admin of admins as Array<{ id: string }>) {
    try {
      await createNotification(admin.id, 'system_alert', {
        kind: 'review_sync_mismatch',
        issueType,
        onChainId,
        reviewId,
        message: `Review sync repair queued: ${issueType}`,
      });
    } catch {
      // never block sync
    }
  }
}

/**
 * Link an off-chain review to an immutable on-chain ID.
 * Does not modify rating/comment from chain into a rewrite — only stores the reference.
 */
export async function linkReviewToChain(
  reviewId: string,
  onChainId: number,
  txHash?: string,
): Promise<ServiceResponse<void>> {
  const { data: existing } = await supabase
    .from('reviews')
    .select('id')
    .eq('on_chain_id', onChainId)
    .neq('id', reviewId)
    .maybeSingle();

  if (existing) {
    await enqueueRepair({
      reviewId,
      onChainId,
      issueType: 'duplicate',
      details: { otherReviewId: (existing as { id: string }).id },
    });
    await supabase
      .from('reviews')
      .update({ chain_sync_status: 'duplicate' })
      .eq('id', reviewId);
    return { success: false, error: 'on_chain_id already linked to another review' };
  }

  const { error } = await supabase
    .from('reviews')
    .update({
      on_chain_id: onChainId,
      on_chain_tx_hash: txHash ?? null,
      chain_sync_status: 'linked',
      chain_synced_at: new Date().toISOString(),
    })
    .eq('id', reviewId);

  if (error) return { success: false, error: error.message };
  await writeSyncLog(reviewId, 'success');
  return { success: true };
}

/**
 * Reconcile a single DB review against the chain.
 * Moderation projections are left untouched; only sync metadata is updated.
 */
export async function syncReviewFromChain(reviewId: string): Promise<ServiceResponse<void>> {
  if (!REVIEW_CONTRACT_ID) {
    return { success: false, error: 'REVIEW_CONTRACT_ID is not configured' };
  }

  const { data: review, error } = await supabase
    .from('reviews')
    .select('id, on_chain_id, rating, comment, original_comment')
    .eq('id', reviewId)
    .single();

  if (error || !review) {
    return { success: false, error: 'Review not found' };
  }

  const row = review as {
    id: string;
    on_chain_id: number | null;
    rating: number;
    comment: string | null;
    original_comment: string | null;
  };

  if (row.on_chain_id == null) {
    await supabase
      .from('reviews')
      .update({ chain_sync_status: 'unlinked' })
      .eq('id', reviewId);
    await writeSyncLog(reviewId, 'skipped', 'No on_chain_id');
    return { success: true };
  }

  try {
    const client = buildReviewClient();
    const chainReview = await client.getReview(BigInt(row.on_chain_id));

    const chainRating = Number(chainReview.rating);
    if (chainRating !== row.rating) {
      await enqueueRepair({
        reviewId,
        onChainId: row.on_chain_id,
        issueType: 'rating_mismatch',
        details: { dbRating: row.rating, chainRating },
      });
      await supabase
        .from('reviews')
        .update({ chain_sync_status: 'mismatch', chain_synced_at: new Date().toISOString() })
        .eq('id', reviewId);
      await writeSyncLog(reviewId, 'failed', 'rating_mismatch');
      return { success: false, error: 'rating_mismatch' };
    }

    const offchainBody = row.original_comment ?? row.comment ?? '';
    const chainComment = String(chainReview.comment ?? '');
    if (chainComment && offchainBody && chainComment !== offchainBody) {
      await enqueueRepair({
        reviewId,
        onChainId: row.on_chain_id,
        issueType: 'comment_mismatch',
        details: {
          note: 'Off-chain body differs from chain; chain not rewritten',
          issue: 'conflict',
        },
      });
      await enqueueRepair({
        reviewId,
        onChainId: row.on_chain_id,
        issueType: 'conflict',
        details: { source: 'comment_mismatch' },
      });
      await supabase
        .from('reviews')
        .update({
          chain_sync_status: 'mismatch',
          chain_synced_at: new Date().toISOString(),
        })
        .eq('id', reviewId);
      await writeSyncLog(reviewId, 'failed', 'comment_mismatch');
      return { success: false, error: 'comment_mismatch' };
    }

    await supabase
      .from('reviews')
      .update({
        chain_sync_status: 'linked',
        chain_synced_at: new Date().toISOString(),
      })
      .eq('id', reviewId);

    await writeSyncLog(reviewId, 'success');
    return { success: true };
  } catch (err) {
    const message = (err as Error).message;
    await enqueueRepair({
      reviewId,
      onChainId: row.on_chain_id,
      issueType: 'missing',
      details: { error: message },
    });
    await supabase
      .from('reviews')
      .update({ chain_sync_status: 'missing_on_chain' })
      .eq('id', reviewId);
    await writeSyncLog(reviewId, 'failed', message);
    return { success: false, error: message };
  }
}

/**
 * Sweep linked reviews and scan recent chain IDs for orphans.
 */
export async function syncAllReviews(): Promise<
  ServiceResponse<{ synced: number; failed: number; queued: number }>
> {
  if (!REVIEW_CONTRACT_ID) {
    return { success: false, error: 'REVIEW_CONTRACT_ID is not configured' };
  }

  let synced = 0;
  let failed = 0;
  let queued = 0;

  const { data: linked } = await supabase
    .from('reviews')
    .select('id')
    .not('on_chain_id', 'is', null);

  for (const row of (linked ?? []) as Array<{ id: string }>) {
    const result = await syncReviewFromChain(row.id);
    if (result.success) synced += 1;
    else failed += 1;
  }

  try {
    const client = buildReviewClient();
    const count = Number(await client.reviewCount());
    const scanFrom = Math.max(1, count - 50);

    for (let id = scanFrom; id <= count; id += 1) {
      const { data: match } = await supabase
        .from('reviews')
        .select('id')
        .eq('on_chain_id', id)
        .maybeSingle();

      if (!match) {
        try {
          await client.getReview(BigInt(id));
          await enqueueRepair({
            onChainId: id,
            issueType: 'orphan_chain',
            details: { source: 'syncAllReviews' },
          });
          queued += 1;
        } catch {
          // gap in ID space — ignore
        }
      }
    }
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
      data: { synced, failed, queued },
    };
  }

  return { success: true, data: { synced, failed, queued } };
}

export async function listOpenReviewRepairs(): Promise<ServiceResponse<ReviewRepairItem[]>> {
  const { data, error } = await supabase
    .from('review_sync_repair_queue')
    .select('*')
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as ReviewRepairItem[] };
}

export async function resolveReviewRepair(
  repairId: string,
  resolverId: string,
  status: 'resolved' | 'ignored',
): Promise<ServiceResponse<ReviewRepairItem>> {
  const { data, error } = await supabase
    .from('review_sync_repair_queue')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: resolverId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', repairId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Repair item not found' };
  return { success: true, data: data as ReviewRepairItem };
}
