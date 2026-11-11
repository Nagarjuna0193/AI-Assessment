import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import RequireAuth from '../../components/RequireAuth';
import FeedbackReport from '../../components/FeedbackReport';
import ReviewRequestsPanel from '../../components/ReviewRequestsPanel';
import { api, ApiError } from '../../lib/api';

export default function SessionDetailPage() {
  return <RequireAuth>{() => <SessionDetailContent />}</RequireAuth>;
}

function SessionDetailContent() {
  const router = useRouter();
  const { id } = router.query;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [evaluating, setEvaluating] = useState(false);

  const load = useCallback(async (sessionId) => {
    try {
      const result = await api.getSessionDetail(sessionId);
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this interview.');
    }
  }, []);

  useEffect(() => {
    if (id) load(id);
  }, [id, load]);

  const handleEvaluate = async () => {
    setEvaluating(true);
    setError(null);
    try {
      await api.evaluateSession(id);
      await load(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not run evaluation.');
    } finally {
      setEvaluating(false);
    }
  };

  if (error && !data) {
    return (
      <Layout>
        <p className="text-red-600">{error}</p>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout>
        <p className="text-slate-500">Loading…</p>
      </Layout>
    );
  }

  const { template, session, transcript, evaluation, proctoring } = data;
  const reviewRequests = data.reviewRequests || [];
  const openReviews = reviewRequests.filter((r) => r.status === 'OPEN').length;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{session.candidateName}</h1>
        <p className="text-slate-500">
          {session.email} · {template.roleName}
          {template.jobId ? ` (${template.jobId})` : ''} · {session.status}
        </p>
        {!session.anonymizedAt && session.dataRetentionUntil && (
          <p className="text-xs text-slate-400 mt-1">
            Personal data kept until {new Date(session.dataRetentionUntil).toLocaleDateString()}
          </p>
        )}
      </div>

      {session.anonymizedAt && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 mb-6 text-sm text-slate-700">
          Personal data for this candidate was anonymized on{' '}
          {new Date(session.anonymizedAt).toLocaleDateString()} (retention period ended or the candidate
          withdrew consent). Scores are kept for reporting; the resume, answers and evidence are gone.
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="font-medium text-slate-800 mb-3">Resume fit</h2>
        {session.resumeJdScore != null ? (
          <div className="space-y-2">
            <p className="text-3xl font-semibold text-slate-900">
              {session.resumeJdScore}
              <span className="text-base font-normal text-slate-400">/100</span>
            </p>
            {session.resumeJdRationale && (
              <p className="text-slate-600 text-sm">{session.resumeJdRationale}</p>
            )}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">Not yet available — the candidate hasn&apos;t uploaded a resume.</p>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="font-medium text-slate-800 mb-3">Feedback report</h2>
        {evaluation ? (
          <FeedbackReport evaluation={evaluation} />
        ) : session.anonymizedAt ? (
          <p className="text-slate-500 text-sm">Not evaluated before the data was anonymized.</p>
        ) : session.status === 'COMPLETED' ? (
          <div>
            <p className="text-slate-500 text-sm mb-3">Not yet evaluated.</p>
            <button
              onClick={handleEvaluate}
              disabled={evaluating}
              className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-slate-800"
            >
              {evaluating ? 'Evaluating…' : 'Run evaluation'}
            </button>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">
            Evaluation available once the candidate completes the interview.
          </p>
        )}
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </section>

      <section
        className={`bg-white border rounded-lg p-5 mb-6 ${openReviews ? 'border-amber-300' : 'border-slate-200'}`}
      >
        <h2 className="font-medium text-slate-800 mb-3">
          Human review requests
          {openReviews > 0 && <span className="ml-2 text-sm font-normal text-amber-700">({openReviews} open)</span>}
        </h2>
        <ReviewRequestsPanel sessionId={id} requests={reviewRequests} onChange={() => load(id)} />
      </section>

      {proctoring && (
        <section className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
          <h2 className="font-medium text-slate-800 mb-1">Interview conduct</h2>
          <p className="text-xs text-slate-500 mb-3">
            Context only — not used by the AI evaluation. A switch can have innocent causes (a
            notification, a dropped connection, a screen reader).
          </p>
          <div className="flex gap-8 text-sm">
            <div>
              <p className="text-2xl font-semibold text-slate-900">{proctoring.tabHiddenCount}</p>
              <p className="text-slate-500">Left the tab</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-slate-900">{proctoring.fullscreenExitCount}</p>
              <p className="text-slate-500">Exited fullscreen</p>
            </div>
          </div>
          {proctoring.events.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-slate-600">Show times</summary>
              <ul className="mt-2 space-y-1 text-slate-500">
                {proctoring.events.map((e, i) => (
                  <li key={i}>
                    {new Date(e.occurredAt).toLocaleTimeString()} —{' '}
                    {e.eventType === 'tab_hidden' ? 'left the tab' : 'exited fullscreen'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="font-medium text-slate-800 mb-3">Transcript</h2>
        {transcript.length === 0 ? (
          <p className="text-slate-500 text-sm">No questions generated yet.</p>
        ) : (
          <div className="space-y-4">
            {transcript.map((t, i) => (
              <div key={t.questionId} className="border-b border-slate-100 last:border-0 pb-4 last:pb-0">
                <p className="text-sm font-medium text-slate-700">
                  <span className="text-slate-400 mr-1">Q{i + 1}.</span>
                  {t.questionText}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  {t.responseText || <span className="italic text-slate-400">No response yet</span>}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
