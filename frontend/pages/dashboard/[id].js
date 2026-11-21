import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import RequireAuth from '../../components/RequireAuth';
import FeedbackReport from '../../components/FeedbackReport';
import ReviewRequestsPanel from '../../components/ReviewRequestsPanel';
import { Alert, Badge, Button, Card, FormError, LoadingState, PageHeader, StatusBadge } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatTime, plural } from '../../lib/format';

const BACK = { href: '/dashboard', label: 'All interviews' };

// Phase 7.6 conversational interviews: how each question came about.
const QUESTION_KIND_LABELS = {
  opening: 'Opening',
  follow_up: 'Follow-up',
  new_topic: 'New topic',
  plan_fallback: 'From plan (fallback)',
};
const QUESTION_KIND_TONES = { follow_up: 'brand', plan_fallback: 'warning' };

export default function SessionDetailPage() {
  return <RequireAuth>{(auth) => <SessionDetailContent auth={auth} />}</RequireAuth>;
}

function SessionDetailContent({ auth }) {
  const router = useRouter();
  const { id } = router.query;

  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [evalError, setEvalError] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const scrolledToHash = useRef(false);

  const load = useCallback(async (sessionId) => {
    try {
      const result = await api.getSessionDetail(sessionId);
      setData(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load this interview.');
    }
  }, []);

  useEffect(() => {
    if (id) load(id);
  }, [id, load]);

  // Content loads after navigation, so the browser can't jump to a #hash
  // (e.g. #human-review from the dashboard alert) on its own.
  useEffect(() => {
    if (!data || scrolledToHash.current || typeof window === 'undefined' || !window.location.hash) return;
    scrolledToHash.current = true;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) el.scrollIntoView({ block: 'start' });
  }, [data]);

  const handleEvaluate = async () => {
    setEvaluating(true);
    setEvalError(null);
    try {
      await api.evaluateSession(id);
      await load(id);
    } catch (err) {
      setEvalError(err instanceof ApiError ? err.message : 'Could not run evaluation.');
    } finally {
      setEvaluating(false);
    }
  };

  if (loadError && !data) {
    return (
      <Layout variant="reviewer" auth={auth} title="Interview" width="wide">
        <PageHeader title="Interview" back={BACK} />
        <Alert tone="error" title="Couldn't load this interview">
          <p>{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => load(id)}>
            Try again
          </Button>
        </Alert>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout variant="reviewer" auth={auth} title="Interview" width="wide">
        <LoadingState label="Loading interview…" />
      </Layout>
    );
  }

  const { template, session, transcript, evaluation, proctoring } = data;
  const reviewRequests = data.reviewRequests || [];
  const openReviews = reviewRequests.filter((r) => r.status === 'OPEN').length;

  return (
    <Layout variant="reviewer" auth={auth} title={session.candidateName} width="wide">
      <PageHeader
        back={BACK}
        title={session.candidateName}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{session.email}</span>
            <span aria-hidden="true">·</span>
            <span>
              {template.roleName}
              {template.jobId ? ` (${template.jobId})` : ''}
            </span>
            {session.mode && (
              <>
                <span aria-hidden="true">·</span>
                <span>{session.mode === 'VOICE' ? 'Voice interview' : 'Text interview'}</span>
              </>
            )}
          </span>
        }
        actions={<StatusBadge status={session.status} />}
      />

      <div className="space-y-4">
        {session.anonymizedAt && (
          <Alert tone="info" title={`Personal data anonymized on ${formatDate(session.anonymizedAt)}`}>
            The retention period ended or the candidate withdrew consent. Scores are kept for reporting; the resume,
            answers and evidence are gone.
          </Alert>
        )}
        {openReviews > 0 && (
          <Alert tone="warning" title="The candidate has asked for a human review">
            <a href="#human-review" className="font-medium underline underline-offset-2">
              Go to the review request
            </a>{' '}
            and record an outcome. Their personal data is held from automatic deletion until it&apos;s resolved.
          </Alert>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Feedback report" description="AI-assisted and advisory only. The hiring decision is made by a person.">
            {evaluation ? (
              <FeedbackReport evaluation={evaluation} />
            ) : session.anonymizedAt ? (
              <p className="text-sm text-slate-600">Not evaluated before the data was anonymized.</p>
            ) : session.status === 'COMPLETED' ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Not evaluated yet. Running the evaluation sends the job description and transcript to the AI
                  model, and the run is logged against your account.
                </p>
                <Button onClick={handleEvaluate} loading={evaluating} loadingText="Evaluating… this can take a minute">
                  Run evaluation
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Available once the candidate completes the interview.</p>
            )}
            {evalError && (
              <div className="mt-3">
                <FormError>{evalError}</FormError>
              </div>
            )}
          </Card>

          <Card
            id="human-review"
            tone={openReviews ? 'warning' : 'default'}
            title="Human review requests"
            actions={openReviews > 0 && <Badge tone="warning">{openReviews} open</Badge>}
            className="scroll-mt-6"
          >
            <ReviewRequestsPanel sessionId={id} requests={reviewRequests} onChange={() => load(id)} />
          </Card>

          <Card
            title="Transcript"
            description={
              session.interviewPlan
                ? 'Conversational interview: the AI chose each question from the answers so far. "Why asked" is the AI’s stated reason and is not shown to the candidate.'
                : undefined
            }
          >
            {transcript.length === 0 ? (
              <p className="text-sm text-slate-600">No questions generated yet.</p>
            ) : (
              <ol className="space-y-5">
                {transcript.map((t, i) => (
                  <li key={t.questionId} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
                    {(t.kind || t.topic) && (
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 pl-8 text-xs">
                        {t.kind && <Badge tone={QUESTION_KIND_TONES[t.kind] || 'neutral'}>{QUESTION_KIND_LABELS[t.kind] || t.kind}</Badge>}
                        {t.topic && <span className="text-slate-500">Topic: {t.topic}</span>}
                      </div>
                    )}
                    {t.leadIn && <p className="mb-1 pl-8 text-sm text-slate-500">{t.leadIn}</p>}
                    <p className="flex gap-2 text-sm font-medium text-slate-900">
                      <span className="shrink-0 text-brand-700">Q{i + 1}</span>
                      <span>{t.questionText}</span>
                    </p>
                    {t.rationale && (
                      <p className="mt-1.5 pl-8 text-xs text-slate-500">
                        <span className="font-medium text-slate-600">Why asked: </span>
                        {t.rationale}
                      </p>
                    )}
                    <div className="mt-2 pl-8 text-sm leading-relaxed text-slate-700">
                      {t.responseText ? (
                        <p className="whitespace-pre-wrap">{t.responseText}</p>
                      ) : (
                        <p className="italic text-slate-500">No response yet</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {session.interviewPlan && session.interviewPlan.topics && (
            <Card
              title="Interview plan"
              description="Topics the AI planned to cover, from the job description and resume."
            >
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {session.interviewPlan.topics.map((t) => (
                  <li key={t.topic}>
                    <span className="font-medium text-slate-900">{t.topic}</span>
                    {t.why && <span className="block text-slate-600">{t.why}</span>}
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <Card title="Resume fit" description="AI-assessed match between the resume and the job description.">
            {session.resumeJdScore != null ? (
              <div className="space-y-2">
                <p className="text-3xl font-semibold text-slate-900">
                  {session.resumeJdScore}
                  <span className="text-base font-normal text-slate-500">/100</span>
                </p>
                {session.resumeJdRationale && (
                  <p className="text-sm leading-relaxed text-slate-700">{session.resumeJdRationale}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-600">Not available yet — the candidate hasn&apos;t uploaded a resume.</p>
            )}
          </Card>

          {proctoring && (
            <Card
              title="Interview conduct"
              description="Context only — not used by the AI evaluation. A switch can have innocent causes (a notification, a dropped connection, a screen reader)."
            >
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-slate-600">Left the tab</dt>
                  <dd className="text-2xl font-semibold text-slate-900">{proctoring.tabHiddenCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">Exited fullscreen</dt>
                  <dd className="text-2xl font-semibold text-slate-900">{proctoring.fullscreenExitCount}</dd>
                </div>
              </dl>
              {proctoring.events.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-medium text-slate-700">
                    Show times ({plural(proctoring.events.length, 'event')})
                  </summary>
                  <ul className="mt-2 space-y-1 text-slate-600">
                    {proctoring.events.map((e, i) => (
                      <li key={i}>
                        <span className="font-mono tabular-nums">{formatTime(e.occurredAt)}</span> —{' '}
                        {e.eventType === 'tab_hidden' ? 'left the tab' : 'exited fullscreen'}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          )}

          {!session.anonymizedAt && session.dataRetentionUntil && (
            <Card title="Data retention">
              <p className="text-sm text-slate-700">
                Personal data is kept until <span className="font-medium">{formatDate(session.dataRetentionUntil)}</span>,
                then anonymized automatically.
              </p>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}
