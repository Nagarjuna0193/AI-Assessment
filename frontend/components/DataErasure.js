import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Button, FormError } from './ui';

// Phase 7 / DPDP: candidate withdraws consent and asks for their data to be
// erased. Shown on every step after consent. Two-step confirm because it
// can't be undone.
export default function DataErasure({ token, inProgress, onErased }) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const headingRef = useRef(null);
  const triggerRef = useRef(null);
  const wasConfirming = useRef(false);

  // Focus follows the panel: into it on open, back to the link on cancel.
  useEffect(() => {
    if (confirming && headingRef.current) headingRef.current.focus();
    if (!confirming && wasConfirming.current && triggerRef.current) triggerRef.current.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

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
    <aside aria-label="Your data" className="mt-10 border-t border-slate-200 pt-5 text-sm">
      {!confirming ? (
        <p className="text-slate-600">
          Changed your mind?{' '}
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setConfirming(true)}
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Withdraw consent and delete my data
          </button>
        </p>
      ) : (
        <div className="space-y-3 rounded-lg border border-rose-200 bg-white p-5">
          <h2 ref={headingRef} tabIndex={-1} className="font-semibold text-slate-900 focus:outline-none">
            Delete your data?
          </h2>
          <p className="text-slate-700">
            This withdraws your consent and permanently removes your name, contact details, resume, and interview
            answers from this application.
            {inProgress && <strong className="font-medium"> Your interview will be cancelled and cannot be resumed.</strong>}{' '}
            The hiring team will no longer be able to review your interview. We keep a record that you consented and
            later withdrew, without your personal details, so we can show your request was handled.
          </p>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={handleErase} loading={submitting} loadingText="Deleting…">
              Yes, delete my data
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
