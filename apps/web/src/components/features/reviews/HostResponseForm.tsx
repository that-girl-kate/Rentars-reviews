'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface HostResponseFormProps {
  reviewId: string;
  /** Called with the response text on successful submission */
  onSuccess?: (responseText: string) => void;
  mode?: 'create' | 'edit';
  initialValue?: string;
}

export default function HostResponseForm({
  reviewId,
  onSuccess,
  mode = 'create',
  initialValue = '',
}: HostResponseFormProps) {
  const [response, setResponse] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = response.trim();
    if (!trimmed) {
      setError('Response cannot be empty');
      return;
    }
    if (trimmed.length > 1000) {
      setError('Response must be at most 1000 characters');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/v1/reviews/${reviewId}/response`, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ response: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to submit response');
      }

      const saved = await res.json();
      onSuccess?.(saved.host_response ?? trimmed);
      if (mode === 'create') setResponse('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit response');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      <textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        rows={2}
        maxLength={1000}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
        placeholder="Write your response to this review..."
        aria-label="Host response"
      />
      <div className="flex items-center justify-between">
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <span className="text-xs text-gray-400 ml-auto">{response.length}/1000</span>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="text-sm bg-gray-800 dark:bg-gray-600 text-white px-4 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition"
      >
        {submitting
          ? mode === 'edit'
            ? 'Saving...'
            : 'Submitting...'
          : mode === 'edit'
            ? 'Save edits'
            : 'Post Response'}
      </button>
    </form>
  );
}
