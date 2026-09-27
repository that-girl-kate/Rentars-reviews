'use client';

import { useEffect, useRef, useState } from 'react';
import StarRating from './StarRating';

interface FlaggedReview {
  id: string;
  reviewer_id: string;
  target_id: string;
  rating: number;
  comment?: string;
  flag_reason?: string;
  policy_code?: string;
  host_response?: string | null;
  host_response_status?: string;
  created_at?: string;
}

interface AppealReview {
  id: string;
  rating: number;
  comment?: string;
  appeal_reason?: string;
  policy_code?: string;
  public_status_explanation?: string;
  created_at?: string;
}

interface SafetyReason {
  code: string;
  label: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const FALLBACK_REASONS: SafetyReason[] = [
  { code: 'harassment', label: 'Harassment' },
  { code: 'spam', label: 'Spam' },
  { code: 'inappropriate', label: 'Inappropriate' },
  { code: 'other', label: 'Other' },
];

export default function ReviewModerationPanel() {
  const [tab, setTab] = useState<'flagged' | 'appeals'>('flagged');
  const [reviews, setReviews] = useState<FlaggedReview[]>([]);
  const [appeals, setAppeals] = useState<AppealReview[]>([]);
  const [reasons, setReasons] = useState<SafetyReason[]>(FALLBACK_REASONS);
  const [policyByReview, setPolicyByReview] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const activeRequest = useRef<AbortController | null>(null);

  async function load() {
    if (activeRequest.current) {
      activeRequest.current.abort();
    }
    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      const token = localStorage.getItem('token');
      const [flaggedRes, appealsRes, policyRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/reviews/moderation/flagged`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }),
        fetch(`${API_URL}/api/v1/reviews/moderation/appeals`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }),
        fetch(`${API_URL}/api/v1/policy/safety`, { signal: controller.signal }),
      ]);
      if (flaggedRes.ok) setReviews(await flaggedRes.json());
      if (appealsRes.ok) setAppeals(await appealsRes.json());
      if (policyRes.ok) {
        const policy = await policyRes.json();
        if (policy?.reasons?.length) setReasons(policy.reasons);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    } finally {
      if (activeRequest.current === controller) {
        setLoading(false);
        activeRequest.current = null;
      }
    }
  }

  useEffect(() => {
    load();
    return () => {
      activeRequest.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function moderate(reviewId: string, approve: boolean) {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/v1/reviews/${reviewId}/moderate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        approve,
        policyCode: approve ? undefined : policyByReview[reviewId] ?? 'other',
      }),
    });
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  }

  async function hideWithPolicy(reviewId: string) {
    const token = localStorage.getItem('token');
    const policyCode = policyByReview[reviewId] ?? 'other';
    await fetch(`${API_URL}/api/v1/reviews/${reviewId}/hide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ policyCode }),
    });
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  }

  async function resolveAppeal(reviewId: string, approve: boolean) {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/v1/reviews/${reviewId}/appeal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ approve }),
    });
    setAppeals((prev) => prev.filter((r) => r.id !== reviewId));
  }

  async function moderateHostResponse(reviewId: string, action: 'hide' | 'remove') {
    const token = localStorage.getItem('token');
    const policyCode = policyByReview[reviewId] ?? 'other';
    await fetch(`${API_URL}/api/v1/reviews/${reviewId}/response/moderate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, policyCode }),
    });
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId
          ? { ...r, host_response_status: action === 'hide' ? 'hidden' : 'removed' }
          : r,
      ),
    );
  }

  if (loading) return <p className="text-sm text-gray-500">Loading flagged reviews...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold text-lg">Review moderation</h2>
        <button
          onClick={() => setTab('flagged')}
          className={`text-sm px-2 py-1 rounded ${tab === 'flagged' ? 'bg-gray-800 text-white' : 'text-gray-500'}`}
        >
          Flagged
        </button>
        <button
          onClick={() => setTab('appeals')}
          className={`text-sm px-2 py-1 rounded ${tab === 'appeals' ? 'bg-gray-800 text-white' : 'text-gray-500'}`}
        >
          Appeals
        </button>
      </div>

      {tab === 'flagged' && (
        reviews.length === 0 ? (
          <p className="text-gray-500 text-sm">No flagged reviews.</p>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="border rounded-lg p-4 space-y-2">
              <StarRating rating={review.rating} size={14} />
              {review.comment && <p className="text-sm text-gray-700">{review.comment}</p>}
              <p className="text-xs text-gray-400">
                Reason: {review.flag_reason ?? review.policy_code ?? 'n/a'} · Reviewer:{' '}
                {review.reviewer_id}
              </p>
              {review.host_response && (
                <div className="text-xs border-l-2 pl-2 text-gray-600">
                  Host response ({review.host_response_status ?? 'visible'}): {review.host_response}
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => moderateHostResponse(review.id, 'hide')}
                      className="text-xs text-amber-700 hover:underline"
                    >
                      Hide response
                    </button>
                    <button
                      onClick={() => moderateHostResponse(review.id, 'remove')}
                      className="text-xs text-red-700 hover:underline"
                    >
                      Remove response
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={policyByReview[review.id] ?? 'other'}
                  onChange={(e) =>
                    setPolicyByReview((prev) => ({ ...prev, [review.id]: e.target.value }))
                  }
                  className="text-xs border rounded px-2 py-1"
                  aria-label="Policy code"
                >
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => moderate(review.id, true)}
                  className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  onClick={() => moderate(review.id, false)}
                  className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                >
                  Remove
                </button>
                <button
                  onClick={() => hideWithPolicy(review.id)}
                  className="text-sm bg-amber-600 text-white px-3 py-1 rounded hover:bg-amber-700"
                >
                  Hide
                </button>
              </div>
            </div>
          ))
        )
      )}

      {tab === 'appeals' && (
        appeals.length === 0 ? (
          <p className="text-gray-500 text-sm">No pending appeals.</p>
        ) : (
          appeals.map((review) => (
            <div key={review.id} className="border rounded-lg p-4 space-y-2">
              <StarRating rating={review.rating} size={14} />
              {review.comment && <p className="text-sm text-gray-700">{review.comment}</p>}
              <p className="text-xs text-gray-500">
                Appeal: {review.appeal_reason}
              </p>
              <p className="text-xs text-gray-400">
                Public status: {review.public_status_explanation ?? 'n/a'} · Policy:{' '}
                {review.policy_code ?? 'n/a'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => resolveAppeal(review.id, true)}
                  className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                >
                  Approve appeal
                </button>
                <button
                  onClick={() => resolveAppeal(review.id, false)}
                  className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                >
                  Deny appeal
                </button>
              </div>
            </div>
          ))
        )
      )}
    </div>
  );
}
