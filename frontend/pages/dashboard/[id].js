import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import RequireAuth from '../../components/RequireAuth';
import { api, ApiError } from '../../lib/api';

export default function InterviewDetailPage() {
  return <RequireAuth>{() => <InterviewDetailContent />}</RequireAuth>;
}

function InterviewDetailContent() {
  const router = useRouter();
  const { id } = router.query;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [evaluating, setEvaluating] = useState(false);

  const load = useCallback(async (interviewId) => {
    try {
      const result = await api.getInterview(interviewId);
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
      await api.evaluateInterview(id);
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

  const { interview, transcript, evaluation } = data;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{interview.candidate.fullName}</h1>
        <p className="text-slate-500">
          {interview.candidate.email}
          {interview.jobTitle ? ` · ${interview.jobTitle}` : ''} · {interview.status}
        </p>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="font-medium text-slate-800 mb-3">Evaluation</h2>
        {evaluation ? (
          <div className="space-y-3">
            <p className="text-3xl font-semibold text-slate-900">
              {evaluation.overallScore}
              <span className="text-base font-normal text-slate-400">/100</span>
            </p>
            {evaluation.summaryText && <p className="text-slate-600 text-sm">{evaluation.summaryText}</p>}
            {Array.isArray(evaluation.scorecard) && evaluation.scorecard.length > 0 && (
              <div className="divide-y divide-slate-100 border border-slate-100 rounded-md mt-3">
                {evaluation.scorecard.map((row, i) => (
                  <div key={i} className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-slate-700">{row.criterion}</span>
                    <span className="text-slate-500">
                      {row.score}
                      {row.notes ? ` — ${row.notes}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : interview.status === 'COMPLETED' ? (
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

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="font-medium text-slate-800 mb-3">Transcript</h2>
        <div className="space-y-4">
          {transcript.map((t) => (
            <div key={t.questionId} className="border-b border-slate-100 last:border-0 pb-4 last:pb-0">
              <p className="text-sm font-medium text-slate-700">{t.questionText}</p>
              <p className="text-sm text-slate-500 mt-1">
                {t.responseText || <span className="italic text-slate-400">No response yet</span>}
              </p>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
