/**
 * Input-validation tests for notification.service.ts
 *
 * Covers:
 *  1. markAllAsRead()      — blank and whitespace-only userId rejected before
 *                            any Supabase call; valid id proceeds normally.
 *  2. createNotification() — unknown runtime type rejected before insertion;
 *                            known types insert successfully.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist mock refs so they are available before vi.mock() calls ─────────────

const { mockSingle, mockSelect, mockUpdate, mockInsert, mockEq, mockFrom } =
  vi.hoisted(() => {
    const mockSingle = vi.fn();
    const mockSelect = vi.fn(() => ({ single: mockSingle }));
    const mockEq     = vi.fn();
    const mockUpdate = vi.fn(() => ({ eq: mockEq }));
    const mockInsert = vi.fn(() => ({ select: mockSelect }));
    const mockFrom   = vi.fn(() => ({
      update: mockUpdate,
      insert: mockInsert,
      select: mockSelect,
    }));
    return { mockSingle, mockSelect, mockUpdate, mockInsert, mockEq, mockFrom };
  });

vi.mock('../config/supabase.js', () => ({
  supabase: { from: mockFrom },
}));
vi.mock('../services/email.service.js', () => ({
  emailService: {
    sendBookingCreated:   vi.fn(),
    sendBookingConfirmed: vi.fn(),
    sendBookingCancelled: vi.fn(),
  },
}));
vi.mock('../services/preferenceToken.js', () => ({
  buildPreferenceUrlForUser: vi.fn().mockReturnValue('http://example.com/prefs'),
}));

import {
  markAllAsRead,
  createNotification,
  type NotificationType,
} from '../services/notification.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. markAllAsRead — userId guard
// ─────────────────────────────────────────────────────────────────────────────

describe('markAllAsRead() — userId validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Chain: update → eq (userId) → eq (read=false) → resolves
    mockEq.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  });

  it('rejects an empty string without calling Supabase', async () => {
    const result = await markAllAsRead('');

    expect(result.success).toBe(false);
    expect(result.error).toBe('user_id is required');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only string without calling Supabase', async () => {
    const result = await markAllAsRead('   ');

    expect(result.success).toBe(false);
    expect(result.error).toBe('user_id is required');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('proceeds and returns success for a valid userId', async () => {
    const result = await markAllAsRead('user-uuid-001');

    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('notifications');
    expect(mockUpdate).toHaveBeenCalledWith({ read: true });
  });

  it('is idempotent — calling twice with the same valid userId succeeds both times', async () => {
    const r1 = await markAllAsRead('user-uuid-001');
    const r2 = await markAllAsRead('user-uuid-001');

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. createNotification — NotificationType guard
// ─────────────────────────────────────────────────────────────────────────────

describe('createNotification() — type validation', () => {
  const NOTIF_ROW = {
    id:         'notif-uuid-001',
    user_id:    'user-uuid-001',
    type:       'booking_created',
    data:       {},
    read:       false,
    created_at: '2025-01-15T10:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: NOTIF_ROW, error: null });
    mockSelect.mockReturnValue({ single: mockSingle });
    mockInsert.mockReturnValue({ select: mockSelect });
    mockFrom.mockReturnValue({ update: mockUpdate, insert: mockInsert, select: mockSelect });
  });

  it('rejects an unknown runtime type without inserting', async () => {
    const result = await createNotification(
      'user-uuid-001',
      'totally_unknown_event' as NotificationType,
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown notification type/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects another fabricated type string without inserting', async () => {
    const result = await createNotification(
      'user-uuid-001',
      '' as NotificationType,
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown notification type/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('inserts successfully for a known type (booking_created)', async () => {
    const result = await createNotification('user-uuid-001', 'booking_created', {});

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe('booking_created');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'booking_created', user_id: 'user-uuid-001' }),
    );
  });

  it('inserts successfully for a known type (new_property)', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { ...NOTIF_ROW, type: 'new_property' },
      error: null,
    });

    const result = await createNotification('user-uuid-001', 'new_property', {
      propertyId: 'prop-001',
    });

    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'new_property' }),
    );
  });

  it('inserts successfully for every other known type without error', async () => {
    const knownTypes: NotificationType[] = [
      'booking_confirmed',
      'booking_cancelled',
      'booking_modification_requested',
      'booking_modification_accepted',
      'booking_modification_declined',
      'payment_received',
      'booking_reminder',
      'review_requested',
      'review_submitted',
      'host_response',
      'host_response_moderated',
      'review_moderation_update',
      'review_appeal_update',
      'dispute_initiated',
      'system_alert',
      'report_created',
      'message_received',
    ];

    for (const type of knownTypes) {
      vi.clearAllMocks();
      mockSingle.mockResolvedValue({ data: { ...NOTIF_ROW, type }, error: null });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });
      mockFrom.mockReturnValue({ update: mockUpdate, insert: mockInsert, select: mockSelect });

      const result = await createNotification('user-uuid-001', type, {});
      expect(result.success).toBe(true);
    }
  });
});
