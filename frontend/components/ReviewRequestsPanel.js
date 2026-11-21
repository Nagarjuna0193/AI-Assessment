import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Alert, Badge, Button, ChoiceCards, Field, FormError } from './ui';

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

  const canSubmit = resolutionNotes.trim() && candidateResponse.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
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
    <form onSubmit={handleSubmit} className="mt-4 space-y-4 border-t border-amber-200 pt-4">
      <ChoiceCards
        legend="Outcome"
        name={`outcome-${request.id}`}
        value={outcome}
        onChange={setOutcome}
        options={[
          { value: 'upheld', label: OUTCOME_LABELS.upheld, description: 'The AI-assisted assessment stands.' },
          { value: 'revised', label: OUTCOME_LABELS.revised, description: 'You reached a different assessment.' },
        ]}
      />
      {outcome === 'revised' && (
        <Alert tone="info">
          Recording &ldquo;revised&rdquo; does not change the stored AI evaluation. Note the revised assessment in your
          internal notes and follow your normal hiring process.
        </Alert>
      )}
      <Field label="Internal notes" hint="Not shown to the candidate. What you checked and why you reached this outcome." required>
        <textarea
          value={resolutionNotes}
          onChange={(e) => setResolutionNotes(e.target.value)}
          rows={3}
          className="input"
        />
      </Field>
      <Field label="Response to the candidate" hint="Shown to the candidate on their interview page." required>
        <textarea
          value={candidateResponse}
          onChange={(e) => setCandidateResponse(e.target.value)}
          rows={3}
          className="input"
        />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" loading={submitting} loadingText="Saving…" disabled={!canSubmit}>
        Record outcome
      </Button>
    </form>
  );
}

export default function ReviewRequestsPanel({ sessionId, requests, onChange }) {
  if (!requests || requests.length === 0) {
    return <p className="text-sm text-slate-600">The candidate hasn&apos;t requested a human review.</p>;
  }

  return (
    <ul className="space-y-4">
      {requests.map((r) => (
        <li
          key={r.id}
          className={`rounded-md border p-4 ${r.status === 'OPEN' ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200'}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Badge tone={r.status === 'OPEN' ? 'warning' : 'neutral'}>
              {r.status === 'OPEN' ? 'Open request' : CLOSED_LABELS[r.outcome] || 'Resolved'}
            </Badge>
            <span className="text-slate-600">Requested {formatDateTime(r.requestedAt)}</span>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-600">Candidate&apos;s reason</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{r.reason}</p>
          {r.status === 'OPEN' ? (
            <ResolveForm sessionId={sessionId} request={r} onResolved={onChange} />
          ) : (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-sm">
              <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-slate-600">Internal notes</dt>
                <dd className="whitespace-pre-wrap text-slate-800">{r.resolutionNotes}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-600">Sent to candidate</dt>
                <dd className="whitespace-pre-wrap text-slate-800">{r.candidateResponse}</dd>
              </div>
              </dl>
              <p className="text-xs text-slate-500">
                Resolved by {r.resolvedBy || 'unknown'}
                {r.resolvedAt && ` on ${formatDateTime(r.resolvedAt)}`}
              </p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
