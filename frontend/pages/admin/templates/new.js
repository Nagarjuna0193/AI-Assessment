import { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout';
import RequireAuth from '../../../components/RequireAuth';
import { api, ApiError } from '../../../lib/api';

export default function CreateTemplatePage() {
  return <RequireAuth>{(auth) => <CreateTemplateContent auth={auth} />}</RequireAuth>;
}

function CreateTemplateContent({ auth }) {
  const router = useRouter();

  const [roleName, setRoleName] = useState('');
  const [jobId, setJobId] = useState('');
  const [jdMode, setJdMode] = useState('text'); // 'text' | 'file'
  const [jobDescriptionText, setJobDescriptionText] = useState('');
  const [jdFile, setJdFile] = useState(null);
  const [questionMode, setQuestionMode] = useState('AI');
  const [manualQuestions, setManualQuestions] = useState(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const updateManualQuestion = (index, value) => {
    setManualQuestions((qs) => qs.map((q, i) => (i === index ? value : q)));
  };
  const addManualQuestion = () => setManualQuestions((qs) => [...qs, '']);
  const removeManualQuestion = (index) =>
    setManualQuestions((qs) => qs.filter((_, i) => i !== index));

  const canSubmit =
    roleName.trim() &&
    (jdMode === 'text' ? jobDescriptionText.trim() : jdFile) &&
    (questionMode === 'AI' || manualQuestions.some((q) => q.trim())) &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('roleName', roleName.trim());
      if (jobId.trim()) formData.append('jobId', jobId.trim());
      if (jdMode === 'text') {
        formData.append('jobDescriptionText', jobDescriptionText.trim());
      } else {
        formData.append('jobDescriptionFile', jdFile);
      }
      formData.append('questionMode', questionMode);
      if (questionMode === 'MANUAL') {
        formData.append(
          'manualQuestions',
          JSON.stringify(manualQuestions.map((q) => q.trim()).filter(Boolean))
        );
      }

      await api.createTemplate(formData);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the interview template.');
      setSubmitting(false);
    }
  };

  if (auth.orgUser.role !== 'ADMIN') {
    return (
      <Layout>
        <p className="text-red-600">Only org admins can create interview templates.</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1 className="text-2xl font-semibold mb-1">Create interview</h1>
      <p className="text-slate-500 mb-6">
        Define the role and job description once, then invite candidates to it individually.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="font-medium text-slate-800">Role</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role name" required>
              <input
                type="text"
                required
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Job ID (optional)">
              <input type="text" value={jobId} onChange={(e) => setJobId(e.target.value)} className="input" />
            </Field>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h2 className="font-medium text-slate-800">Job description</h2>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={jdMode === 'text'} onChange={() => setJdMode('text')} />
              Paste text
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={jdMode === 'file'} onChange={() => setJdMode('file')} />
              Upload file (PDF/DOCX)
            </label>
          </div>
          {jdMode === 'text' ? (
            <textarea
              rows={6}
              value={jobDescriptionText}
              onChange={(e) => setJobDescriptionText(e.target.value)}
              className="input"
              placeholder="Paste the job description"
            />
          ) : (
            <input
              type="file"
              accept=".pdf,.docx"
              onChange={(e) => setJdFile(e.target.files[0] || null)}
              className="block w-full text-sm border border-slate-300 rounded-md p-2"
            />
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h2 className="font-medium text-slate-800">Questions</h2>
          <div className="flex gap-3">
            <ModeOption
              label="AI-generated"
              description="Personalized per candidate from JD + their resume"
              selected={questionMode === 'AI'}
              onClick={() => setQuestionMode('AI')}
            />
            <ModeOption
              label="Manual"
              description="Same fixed questions for every candidate"
              selected={questionMode === 'MANUAL'}
              onClick={() => setQuestionMode('MANUAL')}
            />
          </div>

          {questionMode === 'MANUAL' && (
            <div className="space-y-2 pt-2">
              {manualQuestions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => updateManualQuestion(i, e.target.value)}
                    className="input"
                    placeholder={`Question ${i + 1}`}
                  />
                  {manualQuestions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeManualQuestion(i)}
                      className="text-sm text-slate-400 hover:text-red-600 px-2"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addManualQuestion}
                className="text-sm text-slate-600 hover:text-slate-900 underline"
              >
                + Add question
              </button>
            </div>
          )}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-slate-900 text-white rounded-md py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
        >
          {submitting ? 'Creating…' : 'Create interview'}
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
