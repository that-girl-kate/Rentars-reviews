/**
 * Policy routes — unauthenticated endpoints that return versioned platform
 * policy snapshots. Clients read these before confirmation flows so they can
 * display current fees, refund rules, and risk disclosures.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getCurrentPolicySnapshot } from '@/services/platformPolicy.service.js';
import { getCurrentSafetyPolicySnapshot } from '@/services/contentSafetyPolicy.service.js';

const router = Router();

/**
 * GET /api/v1/policy/current
 *
 * Returns the active policy snapshot. Clients should store the returned
 * `version` string and submit it as `terms_version` in the booking payload.
 *
 * @openapi
 * /api/v1/policy/current:
 *   get:
 *     tags: [Policy]
 *     summary: Get current platform policy snapshot
 *     description: |
 *       Returns fees, refund tiers, escrow behaviour, and risk disclosures
 *       that must be displayed to users before they confirm a booking.
 *       The `version` field must be submitted as `terms_version` in the
 *       POST /api/v1/bookings request body.
 *     responses:
 *       200:
 *         description: Current policy snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:        { type: string }
 *                 effectiveDate:  { type: string, format: date }
 *                 platformFeePct: { type: number }
 *                 refundTiers:    { type: array }
 *                 escrow:         { type: object }
 *                 blockchainRisks: { type: array }
 *                 termsUrl:       { type: string }
 *                 privacyUrl:     { type: string }
 */
router.get('/current', (_req: Request, res: Response): void => {
  const snapshot = getCurrentPolicySnapshot();
  // 1-hour public cache — short enough to pick up same-day changes
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.json(snapshot);
});

/**
 * GET /api/v1/policy/safety
 *
 * Versioned content-safety taxonomy shared by UI, API validators, and
 * moderator tools. Historical decisions keep the stamped policy_version.
 */
router.get('/safety', (_req: Request, res: Response): void => {
  const snapshot = getCurrentSafetyPolicySnapshot();
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.json(snapshot);
});

export default router;
