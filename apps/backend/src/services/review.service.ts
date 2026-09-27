import { supabase } from '../config/supabase.js';
import * as cache from './cache.service.js';
import type { ServiceResponse } from './index.js';
import { sanitizeLongText, sanitizeResponse } from '../utils/sanitize.js';
import type { PaginatedResult } from '../types/pagination.js';
import { executePaginatedQuery } from '../utils/pagination.js';
import {
  APPEAL_WINDOW_DAYS,
  CURRENT_SAFETY_POLICY_VERSION,
  HOST_RESPONSE_EDIT_WINDOW_HOURS,
  SAFETY_REASON_POLICIES,
  assertReviewReason,
  enforcementForReason,
  isValidSafetyReason,
  publicStatusForReason,
  type SafetyReasonCode,
} from './contentSafetyPolicy.service.js';

export type ModerationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'hidden'
  | 'appealed'
  | 'appeal_denied';

export type AppealStatus = 'none' | 'pending' | 'approved' | 'denied' | 'expired';
export type HostResponseStatus = 'none' | 'visible' | 'edited' | 'hidden' | 'removed';

export interface Review {
  id: string;
  booking_id: string;
  reviewer_id: string;
  target_id: string;
  property_id?: string;
  rating: number;
  comment?: string;
  original_comment?: string;
  on_chain_id?: number;
  on_chain_tx_hash?: string;
  chain_sync_status?: string;
  host_response?: string | null;
  host_response_at?: string;
  host_response_status?: HostResponseStatus;
  host_response_edited_at?: string;
  host_response_edit_deadline_at?: string;
  is_flagged?: boolean;
  flag_reason?: string;
  is_approved?: boolean;
  moderation_status?: ModerationStatus;
  moderation_reason?: string;
  policy_code?: string;
  policy_version?: string;
  public_status_explanation?: string;
  visible_in_aggregates?: boolean;
  appeal_status?: AppealStatus;
  appeal_reason?: string;
  appeal_deadline_at?: string;
  moderated_at?: string;
  created_at?: string;
}

const MAX_HOST_RESPONSE_LENGTH = 1000;

const VISIBLE_FOR_DISPLAY: ModerationStatus[] = ['approved'];
const AGGREGATE_ELIGIBLE: ModerationStatus[] = ['approved'];

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function notifyUser(
  userId: string,
  type:
    | 'review_submitted'
    | 'host_response'
    | 'review_moderation_update'
    | 'review_appeal_update'
    | 'host_response_moderated',
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const { createNotification } = await import('./notification.service.js');
    await createNotification(userId, type, data);
  } catch {
    // Notification failure must never block moderation
  }
}

async function invalidatePropertyCache(propertyId?: string | null): Promise<void> {
  if (propertyId) await cache.del(`property:${propertyId}`);
}

export async function submitReview(
  bookingId: string,
  reviewerId: string,
  targetId: string,
  rating: number,
  comment: string,
  propertyId?: string,
): Promise<ServiceResponse<Review>> {
  if (rating < 1 || rating > 5) {
    return { success: false, error: 'Rating must be between 1 and 5' };
  }

  const cleanComment = sanitizeLongText(comment, 2_000);
  if (cleanComment.length === 0) {
    return { success: false, error: 'Comment is required' };
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, status, check_out')
    .eq('id', bookingId)
    .eq('tenant_id', reviewerId)
    .single();

  if (bookingError || !booking) {
    return { success: false, error: 'Booking not found or not owned by reviewer' };
  }

  const b = booking as { id: string; status: string; check_out: string };

  if (b.status === 'Cancelled') {
    return { success: false, error: 'Cannot review a cancelled booking' };
  }
  if (b.status === 'Disputed') {
    return { success: false, error: 'Cannot review a disputed booking' };
  }
  if (b.status !== 'Completed') {
    return { success: false, error: 'Can only review after the stay is completed' };
  }
  if (new Date(b.check_out) >= new Date()) {
    return { success: false, error: 'Cannot review before the checkout date has passed' };
  }

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      booking_id: bookingId,
      reviewer_id: reviewerId,
      target_id: targetId,
      property_id: propertyId,
      rating,
      comment: cleanComment,
      original_comment: cleanComment,
      moderation_status: 'approved',
      is_approved: true,
      visible_in_aggregates: true,
      host_response_status: 'none',
      chain_sync_status: 'unlinked',
      appeal_status: 'none',
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  await invalidatePropertyCache(propertyId);
  await notifyUser(targetId, 'review_submitted', {
    reviewId: (data as Review).id,
    reviewerId,
    propertyId: propertyId ?? null,
    rating,
    message: `A guest left you a ${rating}-star review.`,
  });

  return { success: true, data: data as Review };
}

/** Public list: only approved reviews; host responses only when visible. */
export async function getReviewsForProperty(
  propertyId: string,
  page = 1,
  pageSize = 20,
): Promise<ServiceResponse<PaginatedResult<Review>>> {
  const query = supabase
    .from('reviews')
    .select('*', { count: 'exact' })
    .eq('property_id', propertyId)
    .in('moderation_status', VISIBLE_FOR_DISPLAY)
    .order('created_at', { ascending: false });

  const response = await executePaginatedQuery(query, page, pageSize);
  if (response.error) return { success: false, error: response.error };

  const items = (response.result?.data ?? []).map(projectPublicReview);
  return {
    success: true,
    data: { ...response.result!, data: items },
  };
}

export async function getReviewsForUser(
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<ServiceResponse<PaginatedResult<Review>>> {
  const query = supabase
    .from('reviews')
    .select('*', { count: 'exact' })
    .eq('target_id', userId)
    .in('moderation_status', VISIBLE_FOR_DISPLAY)
    .order('created_at', { ascending: false });

  const response = await executePaginatedQuery(query, page, pageSize);
  if (response.error) return { success: false, error: response.error };

  const items = (response.result?.data ?? []).map(projectPublicReview);
  return {
    success: true,
    data: { ...response.result!, data: items },
  };
}

function projectPublicReview(review: Review): Review {
  const status = review.host_response_status ?? (review.host_response ? 'visible' : 'none');
  const hostResponseHidden = status === 'hidden' || status === 'removed';

  // Public projection: never leak confidential moderator notes / appeal internals.
  // Chain references stay verifiable; moderation never rewrites on_chain_id.
  return {
    id: review.id,
    booking_id: review.booking_id,
    reviewer_id: review.reviewer_id,
    target_id: review.target_id,
    property_id: review.property_id,
    rating: review.rating,
    comment: review.comment,
    on_chain_id: review.on_chain_id,
    on_chain_tx_hash: review.on_chain_tx_hash,
    chain_sync_status: review.chain_sync_status,
    host_response: hostResponseHidden ? null : review.host_response,
    host_response_at: hostResponseHidden ? undefined : review.host_response_at,
    host_response_status: hostResponseHidden ? status : review.host_response_status,
    host_response_edited_at: hostResponseHidden ? undefined : review.host_response_edited_at,
    host_response_edit_deadline_at: review.host_response_edit_deadline_at,
    moderation_status: review.moderation_status,
    public_status_explanation: review.public_status_explanation,
    created_at: review.created_at,
  };
}

export async function getAverageRating(userId: string): Promise<ServiceResponse<number>> {
  const { data, error } = await supabase
    .from('reviews')
    .select('rating')
    .eq('target_id', userId)
    .eq('visible_in_aggregates', true)
    .in('moderation_status', AGGREGATE_ELIGIBLE);

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: true, data: 0 };

  const rows = data as { rating: number }[];
  const avg = rows.reduce((sum, r) => sum + r.rating, 0) / rows.length;
  return { success: true, data: Math.round(avg * 10) / 10 };
}

async function assertCurrentHost(
  review: { target_id: string; property_id: string | null },
  hostId: string,
): Promise<ServiceResponse<true>> {
  if (review.property_id) {
    const { data: property } = await supabase
      .from('properties')
      .select('owner_id')
      .eq('id', review.property_id)
      .single();

    if (!property || (property as { owner_id: string }).owner_id !== hostId) {
      return { success: false, error: 'Only the property owner can respond to this review' };
    }
  } else if (review.target_id !== hostId) {
    return { success: false, error: 'Only the reviewed host can respond' };
  }
  return { success: true, data: true };
}

export async function addHostResponse(
  reviewId: string,
  hostId: string,
  response: string,
): Promise<ServiceResponse<Review>> {
  if (response.trim().length > MAX_HOST_RESPONSE_LENGTH) {
    return {
      success: false,
      error: `Response must be at most ${MAX_HOST_RESPONSE_LENGTH} characters`,
    };
  }

  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .select(
      'id, target_id, property_id, host_response, host_response_status, reviewer_id',
    )
    .eq('id', reviewId)
    .single();

  if (reviewError || !review) {
    return { success: false, error: 'Review not found' };
  }

  const r = review as {
    id: string;
    target_id: string;
    property_id: string | null;
    host_response: string | null;
    host_response_status: HostResponseStatus | null;
    reviewer_id: string;
  };

  const status = r.host_response_status ?? (r.host_response ? 'visible' : 'none');
  if (status !== 'none' && r.host_response) {
    return { success: false, error: 'This review already has a host response' };
  }

  const auth = await assertCurrentHost(r, hostId);
  if (!auth.success) return { success: false, error: auth.error };

  const cleanResponse = sanitizeResponse(response, MAX_HOST_RESPONSE_LENGTH);
  if (!cleanResponse) {
    return { success: false, error: 'Response text is required' };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('reviews')
    .update({
      host_response: cleanResponse,
      host_response_at: now,
      host_response_status: 'visible',
      host_response_edit_deadline_at: hoursFromNow(HOST_RESPONSE_EDIT_WINDOW_HOURS),
    })
    .eq('id', reviewId)
    .is('host_response', null)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  if (!data) {
    return { success: false, error: 'This review already has a host response' };
  }

  await supabase.from('host_response_history').insert({
    review_id: reviewId,
    host_id: hostId,
    body: cleanResponse,
    action: 'created',
    policy_version: CURRENT_SAFETY_POLICY_VERSION,
  });

  await notifyUser(r.reviewer_id, 'host_response', {
    reviewId,
    hostId,
    propertyId: r.property_id ?? null,
    message: 'The host responded to your review.',
  });

  return { success: true, data: data as Review };
}

/**
 * Edit host response within the bounded edit window. Keeps history.
 */
export async function editHostResponse(
  reviewId: string,
  hostId: string,
  response: string,
): Promise<ServiceResponse<Review>> {
  if (response.trim().length > MAX_HOST_RESPONSE_LENGTH) {
    return {
      success: false,
      error: `Response must be at most ${MAX_HOST_RESPONSE_LENGTH} characters`,
    };
  }

  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .select(
      'id, target_id, property_id, host_response, host_response_status, host_response_edit_deadline_at, reviewer_id',
    )
    .eq('id', reviewId)
    .single();

  if (reviewError || !review) {
    return { success: false, error: 'Review not found' };
  }

  const r = review as {
    id: string;
    target_id: string;
    property_id: string | null;
    host_response: string | null;
    host_response_status: HostResponseStatus | null;
    host_response_edit_deadline_at: string | null;
    reviewer_id: string;
  };

  if (!r.host_response || r.host_response_status === 'none') {
    return { success: false, error: 'No host response to edit' };
  }
  if (r.host_response_status === 'removed' || r.host_response_status === 'hidden') {
    return { success: false, error: 'Moderated responses cannot be edited' };
  }
  if (
    r.host_response_edit_deadline_at &&
    new Date(r.host_response_edit_deadline_at).getTime() < Date.now()
  ) {
    return { success: false, error: 'Host response edit window has closed' };
  }

  const auth = await assertCurrentHost(r, hostId);
  if (!auth.success) return { success: false, error: auth.error };

  const cleanResponse = sanitizeResponse(response, MAX_HOST_RESPONSE_LENGTH);
  if (!cleanResponse) {
    return { success: false, error: 'Response text is required' };
  }

  const { data, error } = await supabase
    .from('reviews')
    .update({
      host_response: cleanResponse,
      host_response_status: 'edited',
      host_response_edited_at: new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await supabase.from('host_response_history').insert({
    review_id: reviewId,
    host_id: hostId,
    body: cleanResponse,
    action: 'edited',
    policy_version: CURRENT_SAFETY_POLICY_VERSION,
  });

  return { success: true, data: data as Review };
}

export async function moderateHostResponse(
  reviewId: string,
  moderatorId: string,
  action: 'hide' | 'remove' | 'restore',
  policyCode: SafetyReasonCode,
  note?: string,
): Promise<ServiceResponse<Review>> {
  if (!isValidSafetyReason(policyCode)) {
    return { success: false, error: 'Unsupported policy code' };
  }

  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .select('id, host_response, host_response_status, reviewer_id, target_id, property_id')
    .eq('id', reviewId)
    .single();

  if (reviewError || !review) {
    return { success: false, error: 'Review not found' };
  }

  const r = review as Review;
  if (!r.host_response) {
    return { success: false, error: 'No host response to moderate' };
  }

  const statusMap = {
    hide: 'hidden',
    remove: 'removed',
    restore: 'visible',
  } as const;

  const historyAction = action === 'restore' ? 'restored' : action === 'hide' ? 'hidden' : 'removed';

  const { data, error } = await supabase
    .from('reviews')
    .update({
      host_response_status: statusMap[action],
      host_response_policy_code: policyCode,
      // Keep body for audit even when removed from display
    })
    .eq('id', reviewId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await supabase.from('host_response_history').insert({
    review_id: reviewId,
    host_id: r.target_id,
    body: r.host_response,
    action: historyAction,
    policy_code: policyCode,
    policy_version: CURRENT_SAFETY_POLICY_VERSION,
    moderator_id: moderatorId,
    moderator_note: note ?? null,
  });

  const { record } = await import('./auditLog.service.js');
  await record(moderatorId, `host_response.${action}`, 'review', reviewId, {
    policyCode,
    policyVersion: CURRENT_SAFETY_POLICY_VERSION,
  });

  await notifyUser(r.target_id, 'host_response_moderated', {
    reviewId,
    action,
    statusExplanation: publicStatusForReason(policyCode),
    message: publicStatusForReason(policyCode),
  });

  return { success: true, data: projectPublicReview(data as Review) };
}

export async function flagReview(
  reviewId: string,
  reporterId: string,
  reason: string,
): Promise<ServiceResponse<void>> {
  let policyCode: SafetyReasonCode;
  try {
    policyCode = assertReviewReason(reason.trim());
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  const policy = SAFETY_REASON_POLICIES[policyCode];

  const { data: review, error: findError } = await supabase
    .from('reviews')
    .select('id, reviewer_id, target_id')
    .eq('id', reviewId)
    .single();

  if (findError || !review) {
    return { success: false, error: 'Review not found' };
  }

  const { error } = await supabase
    .from('reviews')
    .update({
      is_flagged: true,
      flag_reason: policyCode,
      // Do not rewrite historical policy stamps on prior decisions
    })
    .eq('id', reviewId);

  if (error) return { success: false, error: error.message };

  // Also create a report row so moderator tools share the same taxonomy
  try {
    const { submitReport } = await import('./report.service.js');
    await submitReport(reporterId, 'review', reviewId, policyCode, `policy:${policyCode}`);
  } catch {
    // Report insert failure should not undo the flag
  }

  const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
  for (const admin of (admins ?? []) as Array<{ id: string }>) {
    await notifyUser(admin.id, 'review_moderation_update', {
      reviewId,
      reason: policyCode,
      severity: policy.severity,
      message: `Review flagged: ${policy.label}`,
    });
  }

  return { success: true };
}

async function applyModerationDecision(
  reviewId: string,
  nextStatus: ModerationStatus,
  policyCode: SafetyReasonCode | null,
  actorId: string | undefined,
  internalReason: string,
  options?: {
    /** When set, keep the historical policy_version (policy bumps must not rewrite). */
    preservePolicyVersion?: string | null;
    publicStatusExplanation?: string | null;
  },
): Promise<ServiceResponse<Review>> {
  const publicCopy =
    options?.publicStatusExplanation ??
    (policyCode
      ? publicStatusForReason(policyCode)
      : nextStatus === 'approved'
        ? 'This review is visible.'
        : 'This review is not currently visible.');

  const visible = nextStatus === 'approved';
  const appealDeadline =
    nextStatus === 'rejected' || nextStatus === 'hidden'
      ? daysFromNow(APPEAL_WINDOW_DAYS)
      : null;

  const policyVersion =
    options?.preservePolicyVersion !== undefined
      ? options.preservePolicyVersion
      : policyCode
        ? CURRENT_SAFETY_POLICY_VERSION
        : null;

  const { data, error } = await supabase
    .from('reviews')
    .update({
      moderation_status: nextStatus,
      is_approved: visible,
      is_flagged: false,
      moderation_reason: internalReason,
      policy_code: policyCode,
      policy_version: policyVersion,
      public_status_explanation: publicCopy,
      visible_in_aggregates: visible,
      moderated_at: new Date().toISOString(),
      moderated_by: actorId ?? null,
      appeal_status: appealDeadline ? 'none' : undefined,
      appeal_deadline_at: appealDeadline,
    })
    .eq('id', reviewId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  const review = data as Review;

  if (actorId) {
    const { record } = await import('./auditLog.service.js');
    await record(actorId, `review.${nextStatus}`, 'review', reviewId, {
      policyCode,
      policyVersion: CURRENT_SAFETY_POLICY_VERSION,
      reason: internalReason,
    });
  }

  await invalidatePropertyCache(review.property_id);
  await notifyUser(review.reviewer_id, 'review_moderation_update', {
    reviewId,
    status: nextStatus,
    statusExplanation: publicCopy,
    message: publicCopy,
  });
  await notifyUser(review.target_id, 'review_moderation_update', {
    reviewId,
    status: nextStatus,
    statusExplanation: publicCopy,
    message: publicCopy,
  });

  return { success: true, data: review };
}

export async function approveReview(
  reviewId: string,
  actorId?: string,
): Promise<ServiceResponse<Review>> {
  return applyModerationDecision(reviewId, 'approved', null, actorId, 'Approved by moderator');
}

export async function rejectReview(
  reviewId: string,
  reason: string,
  actorId?: string,
  policyCode?: string,
): Promise<ServiceResponse<Review>> {
  if (!reason || reason.trim().length === 0) {
    return { success: false, error: 'Rejection reason is required' };
  }

  let code: SafetyReasonCode = 'other';
  if (policyCode) {
    try {
      code = assertReviewReason(policyCode);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  const action = enforcementForReason(code);
  const nextStatus: ModerationStatus =
    action === 'reject_content' ? 'rejected' : action === 'hide_content' ? 'hidden' : 'rejected';

  return applyModerationDecision(reviewId, nextStatus, code, actorId, reason.trim());
}

export async function hideReview(
  reviewId: string,
  policyCode: string,
  actorId: string,
  internalReason?: string,
): Promise<ServiceResponse<Review>> {
  let code: SafetyReasonCode;
  try {
    code = assertReviewReason(policyCode);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
  return applyModerationDecision(
    reviewId,
    'hidden',
    code,
    actorId,
    internalReason ?? `Hidden: ${code}`,
  );
}

export async function submitReviewAppeal(
  reviewId: string,
  appellantId: string,
  reason: string,
): Promise<ServiceResponse<Review>> {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return { success: false, error: 'Appeal reason is required' };
  }

  const { data: review, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('id', reviewId)
    .single();

  if (error || !review) {
    return { success: false, error: 'Review not found' };
  }

  const r = review as Review;
  if (r.reviewer_id !== appellantId && r.target_id !== appellantId) {
    return { success: false, error: 'Only the reviewer or host may appeal' };
  }
  if (!['rejected', 'hidden'].includes(r.moderation_status ?? '')) {
    return { success: false, error: 'Review is not in an appealable state' };
  }
  if (r.appeal_deadline_at && new Date(r.appeal_deadline_at).getTime() < Date.now()) {
    await supabase
      .from('reviews')
      .update({ appeal_status: 'expired' })
      .eq('id', reviewId);
    return { success: false, error: 'Appeal deadline has passed' };
  }
  if (r.appeal_status === 'pending') {
    return { success: false, error: 'An appeal is already pending' };
  }

  const { data, error: updateError } = await supabase
    .from('reviews')
    .update({
      appeal_status: 'pending',
      appeal_reason: trimmed,
      appeal_submitted_at: new Date().toISOString(),
      moderation_status: 'appealed',
    })
    .eq('id', reviewId)
    .select()
    .single();

  if (updateError) return { success: false, error: updateError.message };

  const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
  for (const admin of (admins ?? []) as Array<{ id: string }>) {
    await notifyUser(admin.id, 'review_appeal_update', {
      reviewId,
      message: 'A review appeal was submitted',
    });
  }

  return { success: true, data: data as Review };
}

export async function resolveReviewAppeal(
  reviewId: string,
  moderatorId: string,
  approve: boolean,
  resolutionNote?: string,
): Promise<ServiceResponse<Review>> {
  const { data: review, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('id', reviewId)
    .single();

  if (error || !review) {
    return { success: false, error: 'Review not found' };
  }

  const r = review as Review;
  if (r.appeal_status !== 'pending') {
    return { success: false, error: 'No pending appeal' };
  }

  if (approve) {
    const restored = await applyModerationDecision(
      reviewId,
      'approved',
      null,
      moderatorId,
      resolutionNote ?? 'Appeal approved — review restored',
    );
    if (!restored.success) return restored;

    const { data } = await supabase
      .from('reviews')
      .update({
        appeal_status: 'approved',
        appeal_resolved_at: new Date().toISOString(),
        appeal_resolution_note: resolutionNote ?? null,
      })
      .eq('id', reviewId)
      .select()
      .single();

    await notifyUser(r.reviewer_id, 'review_appeal_update', {
      reviewId,
      outcome: 'approved',
      statusExplanation: 'Your appeal was approved. The review is visible again.',
      message: 'Your appeal was approved. The review is visible again.',
    });

    return { success: true, data: data as Review };
  }

  const denied = await applyModerationDecision(
    reviewId,
    'appeal_denied',
    (r.policy_code as SafetyReasonCode) ?? 'other',
    moderatorId,
    resolutionNote ?? 'Appeal denied',
    {
      preservePolicyVersion: r.policy_version ?? null,
      publicStatusExplanation:
        r.public_status_explanation ??
        'Your appeal was denied. The review remains hidden.',
    },
  );
  if (!denied.success) return denied;

  const { data } = await supabase
    .from('reviews')
    .update({
      appeal_status: 'denied',
      appeal_resolved_at: new Date().toISOString(),
      appeal_resolution_note: resolutionNote ?? null,
      // Keep original policy_version from the hiding decision — do not rewrite
      policy_version: r.policy_version ?? null,
    })
    .eq('id', reviewId)
    .select()
    .single();

  await notifyUser(r.reviewer_id, 'review_appeal_update', {
    reviewId,
    outcome: 'denied',
    statusExplanation:
      r.public_status_explanation ?? 'Your appeal was denied. The review remains hidden.',
    message:
      r.public_status_explanation ?? 'Your appeal was denied. The review remains hidden.',
  });

  return { success: true, data: data as Review };
}

/** User-facing status without confidential moderator notes. */
export function getPublicModerationStatus(review: Review): {
  status: ModerationStatus | undefined;
  explanation: string | null;
  onChainId: number | null;
} {
  return {
    status: review.moderation_status,
    explanation: review.public_status_explanation ?? null,
    onChainId: review.on_chain_id ?? null,
  };
}

export async function getPendingReviews(): Promise<ServiceResponse<Review[]>> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('moderation_status', 'pending')
    .order('created_at', { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as Review[] };
}

export async function moderateReview(
  reviewId: string,
  approve: boolean,
  actorId?: string,
  policyCode?: string,
): Promise<ServiceResponse<Review>> {
  return approve
    ? approveReview(reviewId, actorId)
    : rejectReview(reviewId, 'Rejected by moderator', actorId, policyCode);
}

export async function getFlaggedReviews(): Promise<ServiceResponse<Review[]>> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('is_flagged', true)
    .order('created_at', { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as Review[] };
}

export async function getAppealedReviews(): Promise<ServiceResponse<Review[]>> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('appeal_status', 'pending')
    .order('appeal_submitted_at', { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as Review[] };
}

export async function getHostResponseHistory(
  reviewId: string,
): Promise<ServiceResponse<unknown[]>> {
  const { data, error } = await supabase
    .from('host_response_history')
    .select('id, review_id, host_id, body, action, policy_code, policy_version, created_at')
    .eq('review_id', reviewId)
    .order('created_at', { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}
