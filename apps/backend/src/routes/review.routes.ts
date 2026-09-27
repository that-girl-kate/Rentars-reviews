import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import {
  createReview,
  getPropertyReviews,
  getUserReviews,
  getUserAverageRating,
  respondToReview,
  editHostResponseHandler,
  moderateHostResponseHandler,
  hostResponseHistoryHandler,
  reportReview,
  moderateReviewHandler,
  listFlaggedReviews,
  listPendingReviews,
  listAppealedReviews,
  approveReviewHandler,
  rejectReviewHandler,
  hideReviewHandler,
  submitAppealHandler,
  resolveAppealHandler,
  linkReviewChainHandler,
  syncReviewHandler,
  syncAllReviewsHandler,
  listReviewRepairsHandler,
  resolveReviewRepairHandler,
} from '../controllers/review.controller.js';
import { validateBody } from '../validators/booking.validator.js';
import {
  createReviewSchema,
  flagReviewSchema,
  hostResponseSchema,
  appealSchema,
  hideReviewSchema,
  moderateHostResponseSchema,
  resolveAppealSchema,
  linkChainSchema,
} from '../validators/review.validator.js';
import { validatePagination } from '../validators/pagination.validator.js';

const router = Router();

// POST /api/reviews
router.post('/', authenticate, validateBody(createReviewSchema), createReview);

// GET /api/reviews/property/:id
router.get('/property/:id', validatePagination, getPropertyReviews);

// GET /api/reviews/user/:id
router.get('/user/:id', validatePagination, getUserReviews);

// GET /api/reviews/user/:id/average
router.get('/user/:id/average', getUserAverageRating);

// ── Moderation queues (admin) — before :id routes ───────────────────────────
router.get('/moderation/flagged', authenticate, requireRole('admin'), listFlaggedReviews);
router.get('/moderation/pending', authenticate, requireRole('admin'), listPendingReviews);
router.get('/moderation/appeals', authenticate, requireRole('admin'), listAppealedReviews);
router.get('/moderation/repairs', authenticate, requireRole('admin'), listReviewRepairsHandler);
router.post('/moderation/sync', authenticate, requireRole('admin'), syncAllReviewsHandler);
router.patch(
  '/moderation/repairs/:repairId',
  authenticate,
  requireRole('admin'),
  resolveReviewRepairHandler,
);

// Host response
router.post('/:id/response', authenticate, validateBody(hostResponseSchema), respondToReview);
router.patch('/:id/response', authenticate, validateBody(hostResponseSchema), editHostResponseHandler);
router.patch(
  '/:id/response/moderate',
  authenticate,
  requireRole('admin'),
  validateBody(moderateHostResponseSchema),
  moderateHostResponseHandler,
);
router.get(
  '/:id/response/history',
  authenticate,
  requireRole('admin'),
  hostResponseHistoryHandler,
);

// Report / flag
router.post('/:id/flag', authenticate, validateBody(flagReviewSchema), reportReview);

// Appeals
router.post('/:id/appeal', authenticate, validateBody(appealSchema), submitAppealHandler);
router.patch(
  '/:id/appeal',
  authenticate,
  requireRole('admin'),
  validateBody(resolveAppealSchema),
  resolveAppealHandler,
);

// Moderation actions
router.patch('/:id/moderate', authenticate, requireRole('admin'), moderateReviewHandler);
router.post('/:id/approve', authenticate, requireRole('admin'), approveReviewHandler);
router.post('/:id/reject', authenticate, requireRole('admin'), rejectReviewHandler);
router.post(
  '/:id/hide',
  authenticate,
  requireRole('admin'),
  validateBody(hideReviewSchema),
  hideReviewHandler,
);

// Chain sync
router.post(
  '/:id/chain',
  authenticate,
  requireRole('admin'),
  validateBody(linkChainSchema),
  linkReviewChainHandler,
);
router.post('/:id/sync', authenticate, requireRole('admin'), syncReviewHandler);

export default router;
