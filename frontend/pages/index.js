import { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../components/Layout';
import { api, ApiError } from '../lib/api';

const CONSENT_TEXT_VERSION = 'v1';

const initialForm = {
  fullName: '',
  email: '',
  phone: '',
  jobTitle: '',
  jobDescriptionText: '',
  resumeText: '',
};

export default function ConsentAndStartPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const canSubmit =
    consentAccepted &&
    form.fullName.trim() &&
    form.email.trim() &&
    form.jobDescriptionText.trim() &&
    form.resumeText.trim() &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!consentAccepted) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.recordConsent({
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || undefined,
        consentType: 'data_processing',
        consentTextVersion: CONSENT_TEXT_VERSION,
      });

      const { interviewId } = await api.createInterview({
        candidateEmail: form.email.trim(),
        jobTitle: form.jobTitle.trim() || undefined,
        jobDescriptionText: form.jobDescriptionText.trim(),
        resumeText: form.resumeText.trim(),
        mode: 'TEXT',
      });

      router.push(`/interview/${interviewId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <h1 className="text-2xl font-semibold mb-1">Start your interview</h1>
      <p className="text-slate-500 mb-6">
        We use this information to generate interview questions and evaluate your responses.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="font-medium text-slate-800">Your details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={update('fullName')}
                className="input"
              />
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                required
                value={form.email}
                onChange={update('email')}
                className="input"
              />
            </Field>
            <Field label="Phone (optional)">
              <input type="tel" value={form.phone} onChange={update('phone')} className="input" />
            </Field>
            <Field label="Job title (optional)">
              <input
                type="text"
                value={form.jobTitle}
                onChange={update('jobTitle')}
                className="input"
              />
            </Field>
          </div>
          <Field label="Job description" required>
            <textarea
              required
              rows={4}
              value={form.jobDescriptionText}
              onChange={update('jobDescriptionText')}
              className="input"
              placeholder="Paste the job description you're interviewing for"
            />
          </Field>
          <Field label="Your resume (text)" required>
            <textarea
              required
              rows={4}
              value={form.resumeText}
              onChange={update('resumeText')}
              className="input"
              placeholder="Paste your resume text"
            />
          </Field>
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
              Your job description and resume text will be sent to our AI provider to generate
              interview questions. Your answers will be recorded and sent to our AI provider to
              produce a structured evaluation for the hiring team. This data is used only for
              this recruitment process and is retained per our data retention policy.
            </p>
            <p>
              You may withdraw consent at any time by contacting us, which will stop any further
              processing of your data for this interview. You may also request human review of
              an AI-generated evaluation.
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-slate-900 text-white rounded-md py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
        >
          {submitting ? 'Starting interview…' : 'Accept & start interview'}
        </button>
      </form>

      <style jsx global>{`
        .input {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: 2px solid #0f172a;
          outline-offset: 1px;
        }
      `}</style>
    </Layout>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700 font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
