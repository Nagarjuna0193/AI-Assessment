import { useState } from 'react';
import { api, ApiError } from '../lib/api';

// Phase 7 / DPDP: candidate withdraws consent and asks for their data to be
// erased. Shown on every step after consent. Two-step confirm because it
// can't be undone.
export default function DataErasure({ token, inProgress, onErased }) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleErase = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.requestErasure(token);
      await onErased();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not process your request. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-8 border-t border-slate-200 pt-4 text-sm">
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="text-slate-500 underline hover:text-slate-800">
          Withdraw consent and delete my data
        </button>
      ) : (
        <div className="bg-white border border-rose-200 rounded-lg p-4 space-y-3">
          <p className="text-slate-700">
            This withdraws your consent and permanently removes your name, contact details, resume,
            and interview answers from this application.
            {inProgress && ' Your interview will be cancelled and cannot be resumed.'} The hiring team
            will no longer be able to review your interview. We keep a record that you consented and
            later withdrew, without your personal details, so we can show your request was handled.
          </p>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={handleErase}
              disabled={submitting}
              className="bg-rose-700 text-white rounded-md px-4 py-2 font-medium disabled:opacity-40 hover:bg-rose-800"
            >
              {submitting ? 'Deleting…' : 'Yes, delete my data'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={submitting} className="text-slate-500 hover:text-slate-800">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
