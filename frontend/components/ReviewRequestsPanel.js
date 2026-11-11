import { useState } from 'react';
import { api, ApiError } from '../lib/api';

// Phase 6 / DPDP human-review path, reviewer side: shows candidate requests
// for a person to review the AI-assisted assessment, and lets any org_user
// record an outcome. Internal notes stay internal; the candidate response is
// shown on the candidate's invite page.

const OUTCOME_LABELS = { upheld: 'Assessment upheld', revised: 'Assessment revised' };
// Set by the Phase 7 anonymization, not chosen by a reviewer.
const CLOSED_LABELS = { ...OUTCOME_LABELS, data_erased: 'Closed: candidate data erased' };

function ResolveForm({ sessionId, request, onResolved }) {
  const [outcome, setOutcome] = useState('upheld');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [candidateResponse, setCandidateResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = resolutionNotes.trim() && candidateResponse.trim() && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.resolveReviewRequest(sessionId, request.id, { outcome, resolutionNotes, candidateResponse });
      await onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the review outcome.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-3">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Outcome</legend>
        {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name={`outcome-${request.id}`}
              value={value}
              checked={outcome === value}
              onChange={() => setOutcome(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">
        <span className="text-slate-700">Internal notes (not shown to the candidate)</span>
        <textarea
          value={resolutionNotes}
          onChange={(e) => setResolutionNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
          placeholder="What you checked and why you reached this outcome"
        />
      </label>
      <label className="block text-sm">
        <span className="text-slate-700">Response to the candidate</span>
        <textarea
          value={candidateResponse}
          onChange={(e) => setCandidateResponse(e.target.value)}
          rows={3}
          className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
          placeholder="Shown to the candidate on their interview page"
        />
      </label>
      {outcome === 'revised' && (
        <p className="text-xs text-slate-500">
          Recording &ldquo;revised&rdquo; does not change the stored AI evaluation. Note the revised assessment in
          your internal notes and follow your normal hiring process.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-slate-800"
      >
        {submitting ? 'Saving…' : 'Record outcome'}
      </button>
    </form>
  );
}

export default function ReviewRequestsPanel({ sessionId, requests, onChange }) {
  if (!requests || requests.length === 0) {
    return <p className="text-slate-500 text-sm">The candidate hasn&apos;t requested a human review.</p>;
  }

  return (
    <div className="space-y-4">
      {requests.map((r) => (
        <div
          key={r.id}
          className={`border rounded-md p-4 ${r.status === 'OPEN' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-slate-800">
              {r.status === 'OPEN' ? 'Open request' : CLOSED_LABELS[r.outcome] || 'Resolved'}
            </span>
            <span className="text-slate-500">Requested {new Date(r.requestedAt).toLocaleString()}</span>
          </div>
          <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{r.reason}</p>
          {r.status === 'OPEN' ? (
            <ResolveForm sessionId={sessionId} request={r} onResolved={onChange} />
          ) : (
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">Internal notes</dt>
                <dd className="text-slate-700 whitespace-pre-wrap">{r.resolutionNotes}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sent to candidate</dt>
                <dd className="text-slate-700 whitespace-pre-wrap">{r.candidateResponse}</dd>
              </div>
              <div className="text-xs text-slate-400">
                Resolved by {r.resolvedBy || 'unknown'}
                {r.resolvedAt && ` on ${new Date(r.resolvedAt).toLocaleString()}`}
              </div>
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
