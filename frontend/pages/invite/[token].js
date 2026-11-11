import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import VoiceControls from '../../components/VoiceControls';
import { api, ApiError } from '../../lib/api';

const CONSENT_TEXT_VERSION = 'v1';

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

  const load = useCallback(async (t) => {
    setLoading(true);
    try {
      const data = await api.getSession(t);
      setSession(data);
      setNotFound(false);
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

  if (loading) {
    return (
      <Layout>
        <p className="text-slate-500">Loading…</p>
      </Layout>
    );
  }

  if (notFound) {
    return (
      <Layout>
        <p className="text-red-600">This invite link is invalid or has expired.</p>
      </Layout>
    );
  }

  if (error && !session) {
    return (
      <Layout>
        <p className="text-red-600">{error}</p>
      </Layout>
    );
  }

  if (session.status === 'INVITED') {
    return <ConsentStep token={token} session={session} onStarted={() => load(token)} />;
  }
  if (session.status === 'IN_PROGRESS' && !session.resumeUploaded) {
    return <ResumeUploadStep token={token} onUploaded={() => load(token)} />;
  }
  if (session.status === 'IN_PROGRESS') {
    return <InterviewStep token={token} session={session} onComplete={() => load(token)} />;
  }
  return <CompleteStep token={token} session={session} onChange={() => load(token)} />;
}

const MAX_REVIEW_REASON_LENGTH = 2000;

// Phase 6 / DPDP human-review path, candidate side. The candidate sees only
// their own request, its status, and the reviewer's reply — never scores,
// the AI recommendation, or internal reviewer notes.
function CompleteStep({ token, session, onChange }) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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
    <Layout>
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Interview complete</h1>
        <p className="text-slate-500">
          Thank you for completing your interview, {session.candidateName}. Your responses have
          been recorded and will be reviewed by the hiring team.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 mt-6">
        <h2 className="font-medium text-slate-800 mb-2">Request a human review</h2>
        <p className="text-sm text-slate-500">
          Your interview is assessed with the help of AI, and a person on the hiring team makes the
          final decision. If you think something was missed or misunderstood, you can ask a person to
          review the assessment. Their reply will appear on this page.
        </p>

        {reviewRequests.length > 0 && (
          <ul className="mt-4 space-y-3">
            {reviewRequests.map((r) => (
              <li key={r.id} className="border border-slate-200 rounded-md p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {r.status === 'OPEN' ? 'In review' : 'Reviewed'}
                  </span>
                  <span className="text-slate-500">
                    Requested {new Date(r.requestedAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-slate-600 mt-2 whitespace-pre-wrap">{r.reason}</p>
                {r.candidateResponse && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="text-slate-500 text-xs mb-1">Response from the hiring team</p>
                    <p className="text-slate-800 whitespace-pre-wrap">{r.candidateResponse}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canRequest && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 border border-slate-300 rounded-md px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            {reviewRequests.length > 0 ? 'Request another review' : 'Request a human review'}
          </button>
        )}

        {canRequest && showForm && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="text-slate-700">What would you like the reviewer to look at?</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={MAX_REVIEW_REASON_LENGTH}
                className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!reason.trim() || submitting}
                className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-slate-800"
              >
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-sm text-slate-500 hover:text-slate-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}

function ConsentStep({ token, session, onStarted }) {
  const [mode, setMode] = useState('TEXT');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [voiceConsentAccepted, setVoiceConsentAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = consentAccepted && (mode !== 'VOICE' || voiceConsentAccepted) && !submitting;

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
      onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <h1 className="text-2xl font-semibold mb-1">
        Hi {session.candidateName}, let&apos;s get started
      </h1>
      <p className="text-slate-500 mb-6">
        You&apos;re interviewing for: <span className="font-medium">{session.roleName}</span>
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="font-medium text-slate-800 mb-2">How would you like to interview?</h2>
          <div className="flex gap-3">
            <ModeOption
              label="Text"
              description="Type your answers"
              selected={mode === 'TEXT'}
              onClick={() => setMode('TEXT')}
            />
            <ModeOption
              label="Voice"
              description="Speak your answers, questions read aloud"
              selected={mode === 'VOICE'}
              onClick={() => setMode('VOICE')}
            />
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="font-medium text-slate-800 mb-2">Consent to data processing</h2>
          <div className="text-sm text-slate-600 space-y-2 max-h-40 overflow-y-auto border border-slate-100 rounded p-3 bg-slate-50">
            <p>
              Under India&apos;s Digital Personal Data Protection Act, 2023, we need your explicit
              consent before processing your personal data (name, contact details, resume, and
              interview responses) for this AI-driven interview and evaluation.
            </p>
            <p>
              Your resume will be sent to our AI provider along with the job description to
              generate interview questions and a resume-fit score. Your answers will be recorded
              and sent to our AI provider to produce a structured evaluation for the hiring team.
              This data is used only for this recruitment process and is retained per our data
              retention policy.
            </p>
            <p>
              You may withdraw consent at any time by contacting us, which will stop any further
              processing of your data for this interview. You may also request human review of an
              AI-generated evaluation.
            </p>
          </div>
          <label className="flex items-start gap-2 mt-3 text-sm">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(e) => setConsentAccepted(e.target.checked)}
              className="mt-1"
            />
            <span>
              I have read and understood the above, and I consent to my personal data being
              processed as described (consent version {CONSENT_TEXT_VERSION}).
            </span>
          </label>
        </section>

        {mode === 'VOICE' && (
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="font-medium text-slate-800 mb-2">Consent to voice recording</h2>
            <div className="text-sm text-slate-600 space-y-2 max-h-40 overflow-y-auto border border-slate-100 rounded p-3 bg-slate-50">
              <p>
                Voice interviews additionally require your consent to your spoken answers being
                recorded and sent to our speech-to-text provider to convert them into a written
                transcript, and to interview questions being sent to a text-to-speech provider so
                they can be read aloud to you. The audio itself is not stored — only the resulting
                text transcript is kept, for the same evaluation purpose described above.
              </p>
            </div>
            <label className="flex items-start gap-2 mt-3 text-sm">
              <input
                type="checkbox"
                checked={voiceConsentAccepted}
                onChange={(e) => setVoiceConsentAccepted(e.target.checked)}
                className="mt-1"
              />
              <span>
                I consent to my spoken answers being processed by a voice AI provider as described
                (consent version {CONSENT_TEXT_VERSION}).
              </span>
            </label>
          </section>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-slate-900 text-white rounded-md py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
        >
          {submitting ? 'Starting…' : 'Accept & continue'}
        </button>
      </form>
    </Layout>
  );
}

function ResumeUploadStep({ token, onUploaded }) {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.uploadResume(token, file);
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not process your resume.');
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <h1 className="text-2xl font-semibold mb-1">Upload your resume</h1>
      <p className="text-slate-500 mb-6">
        We use your resume, together with the job description, to generate your interview
        questions and a resume-fit assessment. PDF or DOCX only.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="file"
          accept=".pdf,.docx"
          required
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="block w-full text-sm border border-slate-300 rounded-md p-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!file || submitting}
          className="w-full bg-slate-900 text-white rounded-md py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
        >
          {submitting ? 'Preparing your interview…' : 'Upload & continue'}
        </button>
      </form>
    </Layout>
  );
}

function InterviewStep({ token, session, onComplete }) {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const transcript = session.transcript || [];
  const unanswered = transcript.find((t) => !t.responseText);
  const answeredCount = transcript.filter((t) => t.responseText).length;
  const totalQuestions = transcript.length;

  if (!unanswered) {
    return (
      <Layout>
        <p className="text-slate-500">No question available for this interview.</p>
      </Layout>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!answer.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitSessionAnswer(token, {
        questionId: unanswered.questionId,
        responseText: answer.trim(),
      });
      setAnswer('');
      if (result.done) {
        onComplete();
        return;
      }
      onComplete();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your answer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <span>{session.roleName}</span>
        <span>
          Question {answeredCount + 1} of {totalQuestions}
        </span>
      </div>

      <div className="w-full bg-slate-200 rounded-full h-1.5 mb-6">
        <div
          className="bg-slate-900 h-1.5 rounded-full transition-all"
          style={{ width: totalQuestions ? `${(answeredCount / totalQuestions) * 100}%` : '0%' }}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h1 className="text-lg font-medium text-slate-800 mb-4">{unanswered.questionText}</h1>
        {session.mode === 'VOICE' && (
          <VoiceControls
            token={token}
            questionId={unanswered.questionId}
            onTranscribed={(text) => setAnswer(text)}
            disabled={submitting}
          />
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            rows={8}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer here…"
            className="w-full border border-slate-300 rounded-md p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={!answer.trim() || submitting}
            className="bg-slate-900 text-white rounded-md px-5 py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
          >
            {submitting ? 'Submitting…' : 'Submit answer'}
          </button>
        </form>
      </div>
    </Layout>
  );
}

function ModeOption({ label, description, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-left border rounded-md p-3 transition-colors ${
        selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <p className="text-sm font-medium text-slate-800">{label}</p>
      <p className="text-xs text-slate-500 mt-0.5">{description}</p>
    </button>
  );
}
