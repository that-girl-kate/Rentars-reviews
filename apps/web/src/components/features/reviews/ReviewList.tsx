'use client';

import { useEffect, useState } from 'react';
import StarRating from './StarRating';
import HostResponseForm from './HostResponseForm';

export interface ReviewItem {
  id: string;
  reviewer_id: string;
  rating: number;
  comment?: string;
  host_response?: string | null;
  host_response_at?: string;
  host_response_status?: string;
  host_response_edit_deadline_at?: string;
  on_chain_id?: number;
  on_chain_tx_hash?: string;
  chain_sync_status?: string;
  created_at?: string;
  reviewer_name?: string;
  reviewer_avatar?: string;
  public_status_explanation?: string;
}

interface SafetyReason {
  code: string;
  label: string;
  appliesToReviews?: boolean;
}

interface ReviewListProps {
  reviews: ReviewItem[];
  /** Legacy: only used when RatingSummary is not rendered above */
  averageRating?: number;
  /** If provided, flag button is shown for users who aren't the reviewer */
  currentUserId?: string;
  /** If provided, the host can respond to reviews inline */
  hostId?: string;
  /** When true, hides the summary header (use when RatingSummary is rendered above) */
  hideSummaryHeader?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const FALLBACK_REASONS: SafetyReason[] = [
  { code: 'harassment', label: 'Harassment' },
  { code: 'discrimination', label: 'Discrimination' },
  { code: 'fraud', label: 'Fraud' },
  { code: 'privacy_violation', label: 'Privacy violation' },
  { code: 'retaliatory_review', label: 'Retaliatory review' },
  { code: 'spam', label: 'Spam' },
  { code: 'inappropriate', label: 'Inappropriate content' },
  { code: 'misleading', label: 'Misleading' },
  { code: 'other', label: 'Other' },
];

export default function ReviewList({
  reviews,
  averageRating = 0,
  currentUserId,
  hostId,
  hideSummaryHeader = false,
}: ReviewListProps) {
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [flagError, setFlagError] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState('spam');
  const [reasons, setReasons] = useState<SafetyReason[]>(FALLBACK_REASONS);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [editingResponse, setEditingResponse] = useState<string | null>(null);
  const [localResponses, setLocalResponses] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`${API_URL}/api/v1/policy/safety`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.reasons?.length) {
          setReasons(
            data.reasons.filter(
              (r: SafetyReason) => r.appliesToReviews !== false,
            ),
          );
        }
      })
      .catch(() => {
        // keep fallback taxonomy
      });
  }, []);

  async function handleFlag(reviewId: string) {
    setFlagError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/v1/reviews/${reviewId}/flag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: selectedReason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to report review');
      }
      setFlagged((prev) => new Set([...prev, reviewId]));
      setReportingId(null);
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : 'Failed to report review. Please try again.');
    }
  }

  function handleResponseSuccess(reviewId: string, responseText: string) {
    setLocalResponses((prev) => ({ ...prev, [reviewId]: responseText }));
    setRespondingTo(null);
    setEditingResponse(null);
  }

  const isHost = !!(hostId && currentUserId && hostId === currentUserId);

  function canEditResponse(review: ReviewItem): boolean {
    if (!isHost) return false;
    const status = review.host_response_status;
    if (status === 'hidden' || status === 'removed') return false;
    if (!review.host_response_edit_deadline_at) return Boolean(localResponses[review.id] ?? review.host_response);
    return new Date(review.host_response_edit_deadline_at).getTime() > Date.now();
  }

  return (
    <div className="space-y-4">
      {flagError && (
        <p role="alert" className="text-sm text-red-600">
          {flagError}
        </p>
      )}

      {!hideSummaryHeader && (
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold">{averageRating.toFixed(1)}</span>
          <div>
            <StarRating rating={Math.round(averageRating)} size={18} />
            <p className="text-sm text-gray-500">
              {reviews.length} {reviews.length !== 1 ? 'reviews' : 'review'}
            </p>
          </div>
        </div>
      )}

      {reviews.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          No reviews yet — be the first to share your experience!
        </p>
      ) : (
        reviews.map((review) => {
          const effectiveResponse = localResponses[review.id] ?? review.host_response;
          const chainVerified =
            review.chain_sync_status === 'linked' && review.on_chain_id != null;

          return (
            <div
              key={review.id}
              className="border-t border-gray-100 dark:border-gray-800 pt-4"
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  {review.reviewer_avatar ? (
                    <img
                      src={review.reviewer_avatar}
                      alt={review.reviewer_name}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300">
                      {(review.reviewer_name ?? 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="font-semibold text-sm text-gray-900 dark:text-white">
                    {review.reviewer_name ?? 'Anonymous'}
                  </span>
                  {chainVerified && (
                    <span
                      className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
                      title={`On-chain ID ${review.on_chain_id}${review.on_chain_tx_hash ? ` · ${review.on_chain_tx_hash}` : ''}`}
                    >
                      On-chain #{review.on_chain_id}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {review.created_at
                      ? new Date(review.created_at).toLocaleDateString()
                      : ''}
                  </span>
                  {currentUserId && currentUserId !== review.reviewer_id && (
                    <button
                      onClick={() =>
                        setReportingId(reportingId === review.id ? null : review.id)
                      }
                      disabled={flagged.has(review.id)}
                      className="text-xs text-gray-400 hover:text-red-500 disabled:text-gray-300 transition"
                      title="Report this review"
                    >
                      {flagged.has(review.id) ? 'Reported' : 'Report'}
                    </button>
                  )}
                </div>
              </div>

              {reportingId === review.id && !flagged.has(review.id) && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-gray-200 dark:border-gray-700 p-2">
                  <label className="text-xs text-gray-600 dark:text-gray-300" htmlFor={`reason-${review.id}`}>
                    Reason
                  </label>
                  <select
                    id={`reason-${review.id}`}
                    value={selectedReason}
                    onChange={(e) => setSelectedReason(e.target.value)}
                    className="text-xs border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600"
                  >
                    {reasons.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleFlag(review.id)}
                    className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                  >
                    Submit report
                  </button>
                  <button
                    onClick={() => setReportingId(null)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <StarRating rating={review.rating} size={14} />

              {review.comment && (
                <p className="text-gray-700 dark:text-gray-300 mt-1 text-sm">
                  {review.comment}
                </p>
              )}

              {effectiveResponse && (
                <div className="mt-2 ml-4 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                    Host response
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{effectiveResponse}</p>
                  {review.host_response_at && (
                    <p className="text-xs text-gray-400">
                      {new Date(review.host_response_at).toLocaleDateString()}
                    </p>
                  )}
                  {canEditResponse(review) && editingResponse !== review.id && (
                    <button
                      onClick={() => setEditingResponse(review.id)}
                      className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Edit response
                    </button>
                  )}
                </div>
              )}

              {isHost && !effectiveResponse && respondingTo !== review.id && (
                <button
                  onClick={() => setRespondingTo(review.id)}
                  className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Respond to this review
                </button>
              )}

              {isHost && respondingTo === review.id && (
                <div className="mt-2">
                  <HostResponseForm
                    reviewId={review.id}
                    onSuccess={(text) => handleResponseSuccess(review.id, text)}
                  />
                  <button
                    onClick={() => setRespondingTo(null)}
                    className="mt-1 text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {isHost && editingResponse === review.id && (
                <div className="mt-2">
                  <HostResponseForm
                    reviewId={review.id}
                    mode="edit"
                    initialValue={effectiveResponse ?? ''}
                    onSuccess={(text) => handleResponseSuccess(review.id, text)}
                  />
                  <button
                    onClick={() => setEditingResponse(null)}
                    className="mt-1 text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
