import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import VoiceControls from '../../components/VoiceControls';
import { api, ApiError } from '../../lib/api';

export default function InterviewPage() {
  const router = useRouter();
  const { id } = router.query;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [interview, setInterview] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  const load = useCallback(async (interviewId) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getInterviewProgress(interviewId);

      if (data.interview.status === 'COMPLETED') {
        router.replace(`/interview/${interviewId}/complete`);
        return;
      }

      const unanswered = data.transcript.find((t) => !t.responseText);
      setInterview(data.interview);
      setTotalQuestions(data.transcript.length);
      setAnsweredCount(data.transcript.filter((t) => t.responseText).length);
      setCurrentQuestion(
        unanswered
          ? { id: unanswered.questionId, orderIndex: unanswered.orderIndex, questionText: unanswered.questionText }
          : null
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your interview.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (id) load(id);
  }, [id, load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!answer.trim() || !currentQuestion) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitAnswer(id, {
        questionId: currentQuestion.id,
        responseText: answer.trim(),
      });

      setAnswer('');
      if (result.done) {
        router.replace(`/interview/${id}/complete`);
        return;
      }
      setAnsweredCount((c) => c + 1);
      setCurrentQuestion(result.nextQuestion);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your answer.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <p className="text-slate-500">Loading your interview…</p>
      </Layout>
    );
  }

  if (error && !currentQuestion) {
    return (
      <Layout>
        <p className="text-red-600">{error}</p>
      </Layout>
    );
  }

  if (!currentQuestion) {
    return (
      <Layout>
        <p className="text-slate-500">No question available for this interview.</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <span>{interview && interview.jobTitle ? interview.jobTitle : 'Interview'}</span>
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
        <h1 className="text-lg font-medium text-slate-800 mb-4">{currentQuestion.questionText}</h1>
        {interview && interview.mode === 'VOICE' && (
          <VoiceControls
            interviewId={id}
            questionId={currentQuestion.id}
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
