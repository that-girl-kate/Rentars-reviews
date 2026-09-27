/**
 * Tests for versioned review flag reasons (#638 / #500).
 * Reasons must match the safety taxonomy — free-text is rejected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flagReview } from '../services/review.service.js';
import { flagReviewSchema } from '../validators/review.validator.js';
import { assertCompleteReviewTaxonomy } from '../fixtures/safetyPolicy.fixture.js';

const mockFrom = vi.fn();

vi.mock('../config/supabase.js', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../services/report.service.js', () => ({
  submitReport: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../services/notification.service.js', () => ({
  createNotification: vi.fn().mockResolvedValue({ success: true }),
}));

const REVIEW_ID = 'review-uuid-1234';
const REPORTER_ID = 'user-uuid-5678';

function mockFlagSuccess() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'reviews') {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { id: REVIEW_ID, reviewer_id: 'r1', target_id: 't1' },
                error: null,
              }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      };
    }
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    }
    return {};
  });
}

describe('safety taxonomy completeness', () => {
  it('maps every review reason to enforcement + public copy', () => {
    expect(() => assertCompleteReviewTaxonomy()).not.toThrow();
  });
});

describe('flagReview() service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlagSuccess();
  });

  it('rejects an empty reason string', async () => {
    const result = await flagReview(REVIEW_ID, REPORTER_ID, '');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsupported review reason/i);
  });

  it('rejects a free-text reason outside the taxonomy', async () => {
    const result = await flagReview(REVIEW_ID, REPORTER_ID, 'inappropriate content');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsupported review reason/i);
  });

  it('succeeds with a taxonomy reason code', async () => {
    const result = await flagReview(REVIEW_ID, REPORTER_ID, 'spam');
    expect(result.success).toBe(true);
  });

  it('accepts privacy_violation from the versioned taxonomy', async () => {
    const result = await flagReview(REVIEW_ID, REPORTER_ID, 'privacy_violation');
    expect(result.success).toBe(true);
  });
});

describe('flagReviewSchema validator', () => {
  it('rejects when reason is missing', () => {
    const result = flagReviewSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects free-text reasons', () => {
    const result = flagReviewSchema.safeParse({ reason: 'inappropriate language' });
    expect(result.success).toBe(false);
  });

  it('accepts taxonomy codes', () => {
    const result = flagReviewSchema.safeParse({ reason: 'harassment' });
    expect(result.success).toBe(true);
    expect(result.data!.reason).toBe('harassment');
  });

  it('rejects unsafe_property for reviews', () => {
    const result = flagReviewSchema.safeParse({ reason: 'unsafe_property' });
    expect(result.success).toBe(false);
  });
});
