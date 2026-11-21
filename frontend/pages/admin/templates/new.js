import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout';
import RequireAuth from '../../../components/RequireAuth';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ChoiceCards,
  Field,
  FormError,
  Icon,
  PageHeader,
  SegmentedControl,
} from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import { formatFileSize } from '../../../lib/format';
import { validateDocumentFile } from '../../../lib/files';

const BACK = { href: '/dashboard', label: 'All interviews' };

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
  const [jdFileError, setJdFileError] = useState(null);
  const [questionMode, setQuestionMode] = useState('AI');
  const [manualQuestions, setManualQuestions] = useState(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const lastQuestionRef = useRef(null);
  const focusNewQuestion = useRef(false);

  // After "Add question", put the cursor in the new field.
  useEffect(() => {
    if (focusNewQuestion.current && lastQuestionRef.current) {
      lastQuestionRef.current.focus();
      focusNewQuestion.current = false;
    }
  }, [manualQuestions.length]);

  const updateManualQuestion = (index, value) => {
    setManualQuestions((qs) => qs.map((q, i) => (i === index ? value : q)));
  };
  const addManualQuestion = () => {
    focusNewQuestion.current = true;
    setManualQuestions((qs) => [...qs, '']);
  };
  const removeManualQuestion = (index) => setManualQuestions((qs) => qs.filter((_, i) => i !== index));

  const handleJdFile = (e) => {
    const chosen = e.target.files[0] || null;
    const problem = validateDocumentFile(chosen);
    setJdFileError(problem);
    setJdFile(problem ? null : chosen);
  };

  const filledQuestions = manualQuestions.filter((q) => q.trim()).length;
  const missing = [];
  if (!roleName.trim()) missing.push('a role name');
  if (jdMode === 'text' ? !jobDescriptionText.trim() : !jdFile) missing.push('a job description');
  if (questionMode === 'MANUAL' && filledQuestions === 0) missing.push('at least one question');
  const canSubmit = missing.length === 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;

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
        formData.append('manualQuestions', JSON.stringify(manualQuestions.map((q) => q.trim()).filter(Boolean)));
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
      <Layout variant="reviewer" auth={auth} title="Create interview">
        <PageHeader title="Create interview" back={BACK} />
        <Alert tone="warning" title="Admins only">
          Only organisation admins can create interviews. Ask an admin in your organisation to set one up.
        </Alert>
      </Layout>
    );
  }

  return (
    <Layout variant="reviewer" auth={auth} title="Create interview">
      <PageHeader
        back={BACK}
        title="Create interview"
        description="Define the role and job description once, then invite candidates to it. Creating an interview doesn't use credits; each invite does."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="Role">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role name" required>
              <input
                type="text"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="e.g. Backend Engineer"
                className="input"
              />
            </Field>
            <Field label="Job ID" hint="Optional. Your internal reference.">
              <input type="text" value={jobId} onChange={(e) => setJobId(e.target.value)} className="input" />
            </Field>
          </div>
        </Card>

        <Card
          title="Job description"
          description="Used to generate questions and to evaluate answers."
          actions={
            <SegmentedControl
              legend="Job description source"
              name="jd-mode"
              value={jdMode}
              onChange={setJdMode}
              options={[
                { value: 'text', label: 'Paste text' },
                { value: 'file', label: 'Upload file' },
              ]}
            />
          }
        >
          {jdMode === 'text' ? (
            <Field label="Job description text" hideLabel required>
              <textarea
                rows={10}
                value={jobDescriptionText}
                onChange={(e) => setJobDescriptionText(e.target.value)}
                className="input leading-relaxed"
                placeholder="Paste the job description"
              />
            </Field>
          ) : (
            <div className="space-y-2">
              <Field label="Job description file" hint="PDF or DOCX, up to 15 MB." error={jdFileError} required>
                <input type="file" accept=".pdf,.docx" onChange={handleJdFile} className="file-input" />
              </Field>
              {jdFile && (
                <p className="flex items-center gap-2 text-sm text-slate-700">
                  <Icon name="file" className="h-4 w-4 text-slate-500" />
                  <span className="truncate">{jdFile.name}</span>
                  <span className="text-slate-500">({formatFileSize(jdFile.size)})</span>
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="Questions">
          <ChoiceCards
            legend="Question mode"
            hideLegend
            name="question-mode"
            value={questionMode}
            onChange={setQuestionMode}
            options={[
              {
                value: 'AI',
                label: 'AI-generated',
                description: 'Personalised per candidate from the job description and their resume.',
              },
              { value: 'MANUAL', label: 'Manual', description: 'The same fixed questions for every candidate.' },
            ]}
          />

          {questionMode === 'MANUAL' && (
            <fieldset className="mt-5 space-y-3">
              <legend className="label mb-2">Questions, in the order candidates will see them</legend>
              <ol className="space-y-2">
                {manualQuestions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-2 w-6 shrink-0 text-right text-sm text-slate-500" aria-hidden="true">
                      {i + 1}.
                    </span>
                    <Field label={`Question ${i + 1}`} hideLabel className="flex-1">
                      <input
                        ref={i === manualQuestions.length - 1 ? lastQuestionRef : undefined}
                        type="text"
                        value={q}
                        onChange={(e) => updateManualQuestion(i, e.target.value)}
                        className="input"
                      />
                    </Field>
                    {manualQuestions.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeManualQuestion(i)}
                        aria-label={`Remove question ${i + 1}`}
                        className="mt-0.5 text-slate-500 hover:text-rose-700"
                      >
                        <Icon name="x" />
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
              <Button variant="secondary" size="sm" onClick={addManualQuestion}>
                <Icon name="plus" />
                Add question
              </Button>
            </fieldset>
          )}
        </Card>

        <FormError>{error}</FormError>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {!canSubmit && <p className="hint sm:mr-auto">Still needed: {missing.join(', ')}.</p>}
          <ButtonLink href="/dashboard" variant="ghost">
            Cancel
          </ButtonLink>
          <Button type="submit" loading={submitting} loadingText="Creating…" disabled={!canSubmit}>
            Create interview
          </Button>
        </div>
      </form>
    </Layout>
  );
}
