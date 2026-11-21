import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import VoiceControls from '../../components/VoiceControls';
import DataErasure from '../../components/DataErasure';
import {
  Alert,
  Badge,
  Button,
  Card,
  CharacterCount,
  ChoiceCards,
  Field,
  FormError,
  Icon,
  LoadingState,
} from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatFileSize } from '../../lib/format';
import { validateDocumentFile } from '../../lib/files';
import useProctoring from '../../lib/useProctoring';

// v2 (Phase 7): adds tab/fullscreen monitoring, the retention period, and
// in-page withdrawal/erasure. v3 (Phase 7.6): answers are also sent to the AI
// during the interview to choose follow-up questions.
const CONSENT_TEXT_VERSION = 'v3';
// The server sends its configured value (DATA_RETENTION_DAYS); this is only
// a fallback.
const DEFAULT_RETENTION_DAYS = 180;
const MAX_REVIEW_REASON_LENGTH = 2000;

const STEPS = ['Consent', 'Resume', 'Interview', 'Done'];

// The entire candidate flow (consent -> mandatory resume upload -> AI/manual
// interview -> completion) lives on this one token-addressed page — the
// candidate never sees or needs the internal session id. See docs/DECISIONS.md.
export default function InvitePage() {
  const router = useRouter();
  const { token } = router.query;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  // Only the first load shows the full-page spinner. Later refreshes (after
  // each answer, consent, upload) swap data in place so focus, the draft
  // area and the proctoring listeners aren't torn down between questions.
  const load = useCallback(async (t) => {
    try {
      const data = await api.getSession(t);
      setSession(data);
      setNotFound(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load your invite.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  const refresh = useCallback(() => load(token), [load, token]);

  if (loading) {
    return (
      <Layout title="Your interview">
        <LoadingState label="Loading your interview…" />
      </Layout>
    );
  }

  if (notFound) {
    return (
      <Notice title="This link isn't valid" pageTitle="Invalid link">
        This invite link is invalid or has expired. Check that you used the full link from your email, or
        contact the hiring team for a new one.
      </Notice>
    );
  }

  if (error && !session) {
    return (
      <Layout title="Your interview">
        <Alert tone="error" title="We couldn't load your interview">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={refresh}>
            Try again
          </Button>
        </Alert>
      </Layout>
    );
  }

  if (session.anonymized) {
    return (
      <Notice title="Your data has been deleted" pageTitle="Data deleted">
        The personal data from your application for {session.roleName} has been removed, either at your
        request or because our retention period ended. There is nothing further to do.
      </Notice>
    );
  }
  if (session.status === 'CANCELLED') {
    return (
      <Notice title="Interview cancelled" pageTitle="Interview cancelled">
        This interview has been cancelled. If you think this is a mistake, contact the hiring team.
      </Notice>
    );
  }
  if (session.status === 'INVITED') {
    return <ConsentStep token={token} session={session} onStarted={refresh} />;
  }
  if (session.status === 'IN_PROGRESS' && !session.resumeUploaded) {
    return <ResumeUploadStep token={token} session={session} onUploaded={refresh} />;
  }
  if (session.status === 'IN_PROGRESS') {
    return <InterviewStep token={token} session={session} onChange={refresh} />;
  }
  return <CompleteStep token={token} session={session} onChange={refresh} />;
}

function Notice({ title, pageTitle, children }) {
  return (
    <Layout title={pageTitle}>
      <div className="card px-6 py-10 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mx-auto mt-2 max-w-prose text-slate-600">{children}</p>
      </div>
    </Layout>
  );
}

function StepIndicator({ current }) {
  return (
    <nav aria-label="Interview progress" className="mb-8">
      <ol className="flex items-center gap-2 text-xs sm:text-sm">
        {STEPS.map((label, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li key={label} className="flex flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  state === 'done'
                    ? 'bg-brand-600 text-white'
                    : state === 'current'
                      ? 'border-2 border-brand-600 bg-white text-brand-700'
                      : 'border border-slate-300 bg-white text-slate-500'
                }`}
              >
                {state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={state === 'todo' ? 'text-slate-500' : 'font-medium text-slate-900'}>
                {label}
                {state === 'done' && <span className="sr-only"> (completed)</span>}
              </span>
              {i < STEPS.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-slate-200 sm:block" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ----------------------------------------------------------- 1. consent ---
function ConsentStep({ token, session, onStarted }) {
  const [mode, setMode] = useState('TEXT');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [voiceConsentAccepted, setVoiceConsentAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const needsVoiceConsent = mode === 'VOICE';
  const canSubmit = consentAccepted && (!needsVoiceConsent || voiceConsentAccepted) && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const { consentRecord } = await api.recordConsent({
        email: session.email,
        fullName: session.candidateName,
        consentType: 'data_processing',
        consentTextVersion: CONSENT_TEXT_VERSION,
      });

      if (mode === 'VOICE') {
        await api.recordConsent({
          email: session.email,
          fullName: session.candidateName,
          consentType: 'voice_recording',
          consentTextVersion: CONSENT_TEXT_VERSION,
        });
      }

      await api.startSession(token, { consentRecordId: consentRecord.id, mode });
      await onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <Layout title="Before you start">
      <StepIndicator current={0} />
      <h1 className="text-2xl font-semibold tracking-tight">Hi {session.candidateName}, let&apos;s get started</h1>
      <p className="mt-1 mb-6 text-slate-600">
        You&apos;re interviewing for <span className="font-medium text-slate-900">{session.roleName}</span>. It
        takes a few minutes to set up.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="How would you like to interview?">
          <ChoiceCards
            legend="Interview mode"
            hideLegend
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'TEXT', label: 'Text', description: 'Read each question and type your answer.' },
              {
                value: 'VOICE',
                label: 'Voice',
                description: 'Questions can be read aloud; speak your answer and check the transcript before sending.',
              },
            ]}
          />
        </Card>

        <Card title="Consent to data processing" description="Please read this before continuing.">
          <ConsentText label="Data processing consent text">
            <p>
              Under India&apos;s Digital Personal Data Protection Act, 2023, we need your explicit consent before
              processing your personal data (name, contact details, resume, and interview responses) for this
              AI-driven interview and evaluation.
            </p>
            <p>
              Your resume will be sent to our AI provider along with the job description to generate interview
              questions and a resume-fit score. The interview is a conversation: during it, each answer you give is
              sent to our AI provider so it can choose the next question or a follow-up. Your answers will be recorded
              and sent to our AI provider to produce a structured evaluation for the hiring team. This data is used only for this recruitment process. It
              is kept for {session.retentionDays || DEFAULT_RETENTION_DAYS} days after your interview is completed
              and then anonymized.
            </p>
            <p>
              During the interview we note when you switch away from the interview tab or leave fullscreen (only
              that it happened and when, nothing on your screen). The hiring team sees this as context; it is not
              used by the AI evaluation.
            </p>
            <p>
              You may withdraw consent and have your data deleted at any time using the link at the bottom of each
              page after this one. You may also request human review of an AI-generated evaluation.
            </p>
          </ConsentText>
          <ConsentCheckbox checked={consentAccepted} onChange={setConsentAccepted}>
            I have read and understood the above, and I consent to my personal data being processed as described
            (consent version {CONSENT_TEXT_VERSION}).
          </ConsentCheckbox>
        </Card>

        {needsVoiceConsent && (
          <Card title="Consent to voice recording" description="Needed only because you chose a voice interview.">
            <ConsentText label="Voice recording consent text">
              <p>
                Voice interviews additionally require your consent to your spoken answers being recorded and sent to
                our speech-to-text provider to convert them into a written transcript, and to interview questions
                being sent to a text-to-speech provider so they can be read aloud to you. The audio itself is not
                stored — only the resulting text transcript is kept, for the same evaluation purpose described
                above.
              </p>
            </ConsentText>
            <ConsentCheckbox checked={voiceConsentAccepted} onChange={setVoiceConsentAccepted}>
              I consent to my spoken answers being processed by a voice AI provider as described (consent version{' '}
              {CONSENT_TEXT_VERSION}).
            </ConsentCheckbox>
          </Card>
        )}

        <FormError>{error}</FormError>

        <div>
          <Button type="submit" block loading={submitting} loadingText="Starting…" disabled={!canSubmit}>
            Accept &amp; continue
          </Button>
          {!canSubmit && !submitting && (
            <p className="hint mt-2 text-center">
              {needsVoiceConsent ? 'Tick both consent boxes to continue.' : 'Tick the consent box to continue.'}
            </p>
          )}
        </div>
      </form>
    </Layout>
  );
}

// Scrollable legal text. Focusable + labelled so keyboard users can scroll
// it (axe: scrollable-region-focusable).
function ConsentText({ label, children }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-56 space-y-3 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700"
    >
      {children}
    </div>
  );
}

function ConsentCheckbox({ checked, onChange, children }) {
  return (
    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md p-1 text-sm text-slate-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <span>{children}</span>
    </label>
  );
}

// ------------------------------------------------------------ 2. resume ---
function ResumeUploadStep({ token, session, onUploaded }) {
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = (e) => {
    const chosen = e.target.files[0] || null;
    const problem = validateDocumentFile(chosen);
    setFileError(problem);
    setFile(problem ? null : chosen);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.uploadResume(token, file);
      await onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not process your resume.');
      setSubmitting(false);
    }
  };

  return (
    <Layout title="Upload your resume">
      <StepIndicator current={1} />
      <h1 className="text-2xl font-semibold tracking-tight">Upload your resume</h1>
      <p className="mt-1 mb-6 text-slate-600">
        We use your resume, together with the job description for{' '}
        <span className="font-medium text-slate-900">{session.roleName}</span>, to prepare your interview
        and a resume-fit assessment.
      </p>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Resume" hint="PDF or DOCX, up to 15 MB." error={fileError} required>
            <input type="file" accept=".pdf,.docx" onChange={handleFile} className="file-input" disabled={submitting} />
          </Field>
          {file && (
            <p className="flex items-center gap-2 text-sm text-slate-700">
              <Icon name="file" className="h-4 w-4 text-slate-500" />
              <span className="truncate">{file.name}</span>
              <span className="text-slate-500">({formatFileSize(file.size)})</span>
            </p>
          )}
          <FormError>{error}</FormError>
          <Button type="submit" block loading={submitting} loadingText="Preparing your interview…" disabled={!file}>
            Upload &amp; continue
          </Button>
          {submitting && (
            <p className="hint text-center" role="status">
              This can take up to a minute while your interview is prepared. Please keep this page open.
            </p>
          )}
        </form>
      </Card>
      <DataErasure token={token} inProgress onErased={onUploaded} />
    </Layout>
  );
}

// --------------------------------------------------------- 3. interview ---
// Phase 7.6: the interview is shown as a conversation. In AI-mode sessions
// (session.conversational) each next question is written by the AI from the
// candidate's answers, so there is no fixed total — the candidate sees the
// expected range instead. MANUAL sessions use the same layout with a fixed
// count.
function InterviewStep({ token, session, onChange }) {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // The answer being sent, shown in the conversation straight away.
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [resuming, setResuming] = useState(false);
  const proctoring = useProctoring(token);
  const questionRef = useRef(null);
  const endRef = useRef(null);
  const triedResume = useRef(false);

  const transcript = session.transcript || [];
  const conversational = !!session.conversational;
  const limits = session.questionLimits;
  const unanswered = transcript.find((t) => !t.responseText);
  const answeredCount = transcript.filter((t) => t.responseText).length;
  const questionNumber = answeredCount + 1;
  const questionId = unanswered && unanswered.questionId;
  const isFinalFixedQuestion = !conversational && questionNumber === transcript.length;

  // New question: clear the sent answer, move focus to the question so it's
  // read out, and keep the latest exchange in view.
  useEffect(() => {
    setPendingAnswer(null);
    setError(null);
    if (questionId && questionRef.current) questionRef.current.focus({ preventScroll: true });
    if (endRef.current) endRef.current.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [questionId]);

  // Don't silently lose a typed answer on refresh/close.
  useEffect(() => {
    if (!answer.trim()) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [answer]);

  // Every question answered but the interview isn't over: the next question
  // wasn't written (e.g. the server restarted mid-turn). Continue once
  // automatically; the button below covers a second failure.
  const resume = useCallback(async () => {
    setResuming(true);
    setError(null);
    try {
      await api.continueSession(token);
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not continue the interview.');
    } finally {
      setResuming(false);
    }
  }, [token, onChange]);

  const stalled = !unanswered && conversational;
  useEffect(() => {
    if (stalled && !triedResume.current) {
      triedResume.current = true;
      resume();
    }
  }, [stalled, resume]);

  if (!unanswered && !conversational) {
    return (
      <Notice title="No question available" pageTitle="Interview">
        There is no question available for this interview right now. Please refresh the page, or contact the
        hiring team if this keeps happening.
      </Notice>
    );
  }

  const submit = async () => {
    if (!unanswered || !answer.trim() || submitting) return;
    const text = answer.trim();
    setSubmitting(true);
    setPendingAnswer(text);
    setError(null);
    try {
      await api.submitSessionAnswer(token, { questionId: unanswered.questionId, responseText: text });
      setAnswer('');
      await onChange();
    } catch (err) {
      setPendingAnswer(null);
      setError(err instanceof ApiError ? err.message : 'Could not send your answer. Your text is still here.');
      // The answer may have been saved even though the next step failed.
      onChange();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submit();
  };

  // Ctrl/Cmd+Enter sends from the textarea.
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  const progressLabel = conversational
    ? `Question ${questionNumber}`
    : `Question ${questionNumber} of ${transcript.length}`;

  return (
    <Layout title={progressLabel}>
      <StepIndicator current={2} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span className="font-medium text-slate-800">{session.roleName}</span>
        <span className="flex items-center gap-2">
          {session.mode === 'VOICE' && <Badge tone="brand">Voice</Badge>}
          {unanswered ? progressLabel : 'Interview'}
          {conversational && limits && (
            <span className="text-slate-500">
              · usually {limits.min}–{limits.max} questions
            </span>
          )}
        </span>
      </div>

      {conversational && answeredCount === 0 && (
        <p className="mb-4 rounded-md border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          This is a conversation. The interviewer reads each answer and may ask a follow-up about it, so answer in
          your own words with specific examples where you can.
        </p>
      )}

      {proctoring.lastWarning && (
        <Alert tone="warning" onDismiss={proctoring.dismissWarning} className="mb-4">
          {proctoring.lastWarning}
        </Alert>
      )}
      {proctoring.fullscreenSupported && !proctoring.isFullscreen && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span>Please stay on this tab while you answer. Fullscreen is recommended but optional.</span>
          <Button variant="secondary" size="sm" onClick={proctoring.enterFullscreen}>
            Enter fullscreen
          </Button>
        </div>
      )}

      <div className="card p-4 sm:p-6">
        <ol aria-label="Interview conversation" className="space-y-5">
          {transcript.map((t, i) => {
            const isCurrent = t.questionId === questionId;
            return (
              <li key={t.questionId} className="space-y-3">
                <InterviewerMessage
                  leadIn={t.leadIn}
                  label={`Question ${i + 1}${t.kind === 'follow_up' ? ' · follow-up' : ''}`}
                >
                  {isCurrent ? (
                    <h1 ref={questionRef} tabIndex={-1} className="font-medium text-slate-900 focus:outline-none">
                      {t.questionText}
                    </h1>
                  ) : (
                    <p className="text-slate-800">{t.questionText}</p>
                  )}
                </InterviewerMessage>
                {t.responseText && <CandidateMessage>{t.responseText}</CandidateMessage>}
                {isCurrent && pendingAnswer && <CandidateMessage>{pendingAnswer}</CandidateMessage>}
              </li>
            );
          })}
          {(submitting || resuming) && (
            <li>
              <ThinkingMessage
                label={
                  conversational
                    ? 'The interviewer is reading your answer…'
                    : isFinalFixedQuestion
                      ? 'Finishing your interview…'
                      : 'Loading the next question…'
                }
              />
            </li>
          )}
        </ol>
        <div ref={endRef} />

        {stalled && !resuming && (
          <div className="mt-5 space-y-3">
            <FormError>{error}</FormError>
            <Button onClick={resume}>Continue interview</Button>
          </div>
        )}

        {unanswered && (
          <div className="mt-6 border-t border-slate-100 pt-5">
            {session.mode === 'VOICE' && (
              <VoiceControls
                token={token}
                questionId={unanswered.questionId}
                onTranscribed={(text) => setAnswer(text)}
                disabled={submitting}
              />
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field
                label="Your answer"
                hint={
                  session.mode === 'VOICE'
                    ? 'Your recording is transcribed here. Check and edit it before sending.'
                    : 'Press Ctrl + Enter to send. You can’t change an answer after sending.'
                }
              >
                <textarea
                  rows={6}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your answer here…"
                  disabled={submitting}
                  className="input leading-relaxed"
                />
              </Field>
              <FormError>{error}</FormError>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button type="submit" loading={submitting} loadingText="Sending…" disabled={!answer.trim()}>
                  {isFinalFixedQuestion ? 'Send final answer' : 'Send answer'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
      <DataErasure token={token} inProgress onErased={onChange} />
    </Layout>
  );
}

function InterviewerMessage({ label, leadIn, children }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white"
      >
        AI
      </span>
      <div className="min-w-0 max-w-prose rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 leading-relaxed">
        <p className="mb-1 text-xs font-medium text-brand-700">
          <span className="sr-only">Interviewer, </span>
          {label}
        </p>
        {leadIn && <p className="mb-1.5 text-sm text-slate-600">{leadIn}</p>}
        {children}
      </div>
    </div>
  );
}

function CandidateMessage({ children }) {
  return (
    <div className="flex justify-end">
      <div className="min-w-0 max-w-prose rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-3 text-sm leading-relaxed text-white">
        <p className="sr-only">Your answer:</p>
        <p className="whitespace-pre-wrap break-words">{children}</p>
      </div>
    </div>
  );
}

function ThinkingMessage({ label }) {
  return (
    <div className="flex items-start gap-3" role="status">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white"
      >
        AI
      </span>
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 text-sm text-slate-600">
        <span aria-hidden="true" className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
        </span>
        {label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- 4. complete ---
// Phase 6 / DPDP human-review path, candidate side. The candidate sees only
// their own request, its status, and the reviewer's reply — never scores,
// the AI recommendation, or internal reviewer notes.
function CompleteStep({ token, session, onChange }) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const reasonRef = useRef(null);

  // Opening the form is a deliberate click, so move focus into it.
  useEffect(() => {
    if (showForm && reasonRef.current) reasonRef.current.focus();
  }, [showForm]);

  const reviewRequests = session.reviewRequests || [];
  const hasOpen = reviewRequests.some((r) => r.status === 'OPEN');
  const canRequest = session.status === 'COMPLETED' && !hasOpen;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.requestHumanReview(token, reason);
      setShowForm(false);
      setReason('');
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout title="Interview complete">
      <StepIndicator current={3} />
      <div className="card px-6 py-10 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Icon name="check" className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-semibold text-slate-900">Interview complete</h1>
        <p className="mx-auto mt-2 max-w-prose text-slate-600">
          Thank you, {session.candidateName}. Your responses have been recorded and will be reviewed by the hiring
          team. You can close this page; the hiring team will contact you about next steps.
        </p>
      </div>

      <Card
        className="mt-6"
        title="Request a human review"
        description="Your interview is assessed with the help of AI, and a person on the hiring team makes the final decision. If you think something was missed or misunderstood, you can ask a person to review the assessment. Their reply will appear on this page — keep your invite link to check back."
      >
        {reviewRequests.length > 0 && (
          <ul className="mb-4 space-y-3">
            {reviewRequests.map((r) => (
              <li key={r.id} className="rounded-md border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={r.status === 'OPEN' ? 'warning' : 'success'}>
                    {r.status === 'OPEN' ? 'In review' : 'Reviewed'}
                  </Badge>
                  <span className="text-slate-600">Requested {formatDate(r.requestedAt)}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-slate-700">{r.reason}</p>
                {r.candidateResponse && (
                  <div className="mt-3 rounded-md bg-slate-50 p-3">
                    <p className="mb-1 text-xs font-medium text-slate-600">Response from the hiring team</p>
                    <p className="whitespace-pre-wrap text-slate-900">{r.candidateResponse}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canRequest && !showForm && (
          <Button variant="secondary" onClick={() => setShowForm(true)}>
            {reviewRequests.length > 0 ? 'Request another review' : 'Request a human review'}
          </Button>
        )}

        {canRequest && showForm && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="What would you like the reviewer to look at?" required>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={5}
                maxLength={MAX_REVIEW_REASON_LENGTH}
                ref={reasonRef}
                className="input"
              />
            </Field>
            <CharacterCount value={reason} max={MAX_REVIEW_REASON_LENGTH} />
            <FormError>{error}</FormError>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={submitting} loadingText="Submitting…" disabled={!reason.trim()}>
                Submit request
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>
      <DataErasure token={token} inProgress={false} onErased={onChange} />
    </Layout>
  );
}
