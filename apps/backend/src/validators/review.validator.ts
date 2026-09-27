import { z } from 'zod';
import {
  getHostResponseReasonCodes,
  getReviewReasonCodes,
} from '../services/contentSafetyPolicy.service.js';

const reviewReasonEnum = z.enum(
  getReviewReasonCodes() as [string, ...string[]],
  {
    errorMap: () => ({
      message: `reason must be one of: ${getReviewReasonCodes().join(', ')}`,
    }),
  },
);

const hostResponseReasonEnum = z.enum(
  getHostResponseReasonCodes() as [string, ...string[]],
  {
    errorMap: () => ({
      message: `policyCode must be one of: ${getHostResponseReasonCodes().join(', ')}`,
    }),
  },
);

export const createReviewSchema = z.object({
  bookingId: z
    .string({ required_error: 'bookingId is required' })
    .uuid('bookingId must be a valid UUID'),
  targetId: z
    .string({ required_error: 'targetId is required' })
    .uuid('targetId must be a valid UUID'),
  rating: z
    .number({ required_error: 'rating is required', invalid_type_error: 'rating must be a number' })
    .int('rating must be an integer')
    .min(1, 'Rating must be between 1 and 5')
    .max(5, 'Rating must be between 1 and 5'),
  comment: z.string().max(2000, 'Comment must be at most 2000 characters').optional(),
  propertyId: z.string().uuid('propertyId must be a valid UUID').optional(),
});

export const flagReviewSchema = z.object({
  reason: reviewReasonEnum,
});

export const hostResponseSchema = z.object({
  response: z
    .string({ required_error: 'response is required' })
    .trim()
    .min(1, 'Response cannot be blank')
    .max(1000, 'Response must be at most 1000 characters'),
});

export const appealSchema = z.object({
  reason: z
    .string({ required_error: 'reason is required' })
    .trim()
    .min(1, 'Appeal reason cannot be blank')
    .max(2000),
});

export const resolveAppealSchema = z.object({
  approve: z.boolean({ required_error: 'approve is required' }),
  note: z.string().trim().max(2000).optional(),
});

export const hideReviewSchema = z.object({
  policyCode: reviewReasonEnum,
  reason: z.string().trim().max(2000).optional(),
});

export const moderateHostResponseSchema = z.object({
  action: z.enum(['hide', 'remove', 'restore']),
  policyCode: hostResponseReasonEnum,
  note: z.string().trim().max(2000).optional(),
});

export const linkChainSchema = z.object({
  onChainId: z.number({ required_error: 'onChainId is required' }).int().positive(),
  txHash: z.string().trim().min(1).optional(),
});
