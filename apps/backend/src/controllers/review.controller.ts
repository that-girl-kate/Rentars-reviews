import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import {
  submitReview,
  getReviewsForProperty,
  getReviewsForUser,
  getAverageRating,
  addHostResponse,
  editHostResponse,
  moderateHostResponse,
  getHostResponseHistory,
  flagReview,
  moderateReview,
  getFlaggedReviews,
  approveReview,
  rejectReview,
  hideReview,
  getPendingReviews,
  submitReviewAppeal,
  resolveReviewAppeal,
  getAppealedReviews,
} from '../services/review.service.js';
import {
  linkReviewToChain,
  syncReviewFromChain,
  syncAllReviews,
  listOpenReviewRepairs,
  resolveReviewRepair,
} from '../services/reviewSync.service.js';
import type { SafetyReasonCode } from '../services/contentSafetyPolicy.service.js';

export async function createReview(req: AuthRequest, res: Response): Promise<void> {
  const { bookingId, targetId, rating, comment, propertyId } = req.body;
  const reviewerId = req.userId;

  if (!reviewerId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const result = await submitReview(bookingId, reviewerId, targetId, rating, comment, propertyId);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json(result.data);
}

export async function getPropertyReviews(req: Request, res: Response): Promise<void> {
  const pagination = (req as Request & { parsedPagination?: { page: number; pageSize: number } }).parsedPagination;
  const result = await getReviewsForProperty(req.params.id, pagination?.page ?? 1, pagination?.pageSize ?? 20);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function getUserReviews(req: Request, res: Response): Promise<void> {
  const pagination = (req as Request & { parsedPagination?: { page: number; pageSize: number } }).parsedPagination;
  const result = await getReviewsForUser(req.params.id, pagination?.page ?? 1, pagination?.pageSize ?? 20);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function getUserAverageRating(req: Request, res: Response): Promise<void> {
  const result = await getAverageRating(req.params.id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ average: result.data });
}

export async function respondToReview(req: AuthRequest, res: Response): Promise<void> {
  const hostId = req.userId;
  if (!hostId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { response } = req.body;
  if (!response || typeof response !== 'string' || !response.trim()) {
    res.status(400).json({ error: 'response is required' });
    return;
  }
  if (response.trim().length > 1000) {
    res.status(400).json({ error: 'Response must be at most 1000 characters' });
    return;
  }
  const result = await addHostResponse(req.params.id, hostId, response.trim());
  if (!result.success) {
    const isOwnershipError =
      result.error === 'Only the property owner can respond to this review' ||
      result.error === 'Only the reviewed host can respond';
    res.status(isOwnershipError ? 403 : 400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function editHostResponseHandler(req: AuthRequest, res: Response): Promise<void> {
  const hostId = req.userId;
  if (!hostId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { response } = req.body;
  if (!response || typeof response !== 'string' || !response.trim()) {
    res.status(400).json({ error: 'response is required' });
    return;
  }
  const result = await editHostResponse(req.params.id, hostId, response.trim());
  if (!result.success) {
    const isOwnershipError =
      result.error === 'Only the property owner can respond to this review' ||
      result.error === 'Only the reviewed host can respond';
    res.status(isOwnershipError ? 403 : 400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function moderateHostResponseHandler(req: AuthRequest, res: Response): Promise<void> {
  const moderatorId = req.userId;
  if (!moderatorId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { action, policyCode, note } = req.body;
  if (!['hide', 'remove', 'restore'].includes(action)) {
    res.status(400).json({ error: 'action must be hide, remove, or restore' });
    return;
  }
  if (!policyCode || typeof policyCode !== 'string') {
    res.status(400).json({ error: 'policyCode is required' });
    return;
  }
  const result = await moderateHostResponse(
    req.params.id,
    moderatorId,
    action,
    policyCode as SafetyReasonCode,
    note,
  );
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function hostResponseHistoryHandler(req: AuthRequest, res: Response): Promise<void> {
  const result = await getHostResponseHistory(req.params.id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function reportReview(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { reason } = req.body;
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'Flag reason is required' });
    return;
  }
  const result = await flagReview(req.params.id, userId, reason);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ message: 'Review reported for moderation' });
}

export async function moderateReviewHandler(req: AuthRequest, res: Response): Promise<void> {
  const { approve, policyCode } = req.body;
  if (typeof approve !== 'boolean') {
    res.status(400).json({ error: 'approve (boolean) is required' });
    return;
  }
  const result = await moderateReview(req.params.id, approve, req.userId, policyCode);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function listFlaggedReviews(_req: Request, res: Response): Promise<void> {
  const result = await getFlaggedReviews();
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function listPendingReviews(_req: Request, res: Response): Promise<void> {
  const result = await getPendingReviews();
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function listAppealedReviews(_req: Request, res: Response): Promise<void> {
  const result = await getAppealedReviews();
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function approveReviewHandler(req: AuthRequest, res: Response): Promise<void> {
  const result = await approveReview(req.params.id, req.userId);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function rejectReviewHandler(req: AuthRequest, res: Response): Promise<void> {
  const { reason, policyCode } = req.body;
  if (!reason || typeof reason !== 'string') {
    res.status(400).json({ error: 'reason (string) is required' });
    return;
  }
  const result = await rejectReview(req.params.id, reason, req.userId, policyCode);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function hideReviewHandler(req: AuthRequest, res: Response): Promise<void> {
  const moderatorId = req.userId;
  if (!moderatorId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { policyCode, reason } = req.body;
  if (!policyCode || typeof policyCode !== 'string') {
    res.status(400).json({ error: 'policyCode is required' });
    return;
  }
  const result = await hideReview(req.params.id, policyCode, moderatorId, reason);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function submitAppealHandler(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { reason } = req.body;
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'Appeal reason is required' });
    return;
  }
  const result = await submitReviewAppeal(req.params.id, userId, reason.trim());
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function resolveAppealHandler(req: AuthRequest, res: Response): Promise<void> {
  const moderatorId = req.userId;
  if (!moderatorId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { approve, note } = req.body;
  if (typeof approve !== 'boolean') {
    res.status(400).json({ error: 'approve (boolean) is required' });
    return;
  }
  const result = await resolveReviewAppeal(req.params.id, moderatorId, approve, note);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function linkReviewChainHandler(req: AuthRequest, res: Response): Promise<void> {
  const { onChainId, txHash } = req.body;
  if (typeof onChainId !== 'number' || !Number.isFinite(onChainId)) {
    res.status(400).json({ error: 'onChainId (number) is required' });
    return;
  }
  const result = await linkReviewToChain(req.params.id, onChainId, txHash);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ message: 'Review linked to chain', onChainId });
}

export async function syncReviewHandler(req: AuthRequest, res: Response): Promise<void> {
  const result = await syncReviewFromChain(req.params.id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ message: 'Review synced' });
}

export async function syncAllReviewsHandler(_req: AuthRequest, res: Response): Promise<void> {
  const result = await syncAllReviews();
  if (!result.success) {
    res.status(400).json({ error: result.error, data: result.data });
    return;
  }
  res.json(result.data);
}

export async function listReviewRepairsHandler(_req: AuthRequest, res: Response): Promise<void> {
  const result = await listOpenReviewRepairs();
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json(result.data);
}

export async function resolveReviewRepairHandler(req: AuthRequest, res: Response): Promise<void> {
  const resolverId = req.userId;
  if (!resolverId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { status } = req.body;
  if (status !== 'resolved' && status !== 'ignored') {
    res.status(400).json({ error: 'status must be resolved or ignored' });
    return;
  }
  const result = await resolveReviewRepair(req.params.repairId, resolverId, status);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.data);
}
