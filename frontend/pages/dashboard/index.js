import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import Layout from '../../components/Layout';
import RequireAuth from '../../components/RequireAuth';
import { RecommendationBadge } from '../../components/FeedbackReport';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  CopyButton,
  CopyableLink,
  EmptyState,
  Field,
  FormError,
  Icon,
  LoadingState,
  PageHeader,
  SegmentedControl,
  StatusBadge,
} from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { plural } from '../../lib/format';

const MAX_BULK_INVITES = 100;

export default function DashboardPage() {
  return <RequireAuth>{(auth, refreshAuth) => <DashboardContent auth={auth} refreshAuth={refreshAuth} />}</RequireAuth>;
}

function DashboardContent({ auth, refreshAuth }) {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const isAdmin = auth.orgUser.role === 'ADMIN';

  const load = useCallback(
    () =>
      api
        .listTemplates()
        .then((data) => {
          setTemplates(data.templates);
          setError(null);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load interviews.')),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  // After an invite: refresh the list and the header's credit balance.
  const handleInvited = useCallback(() => Promise.all([load(), refreshAuth()]), [load, refreshAuth]);

  const openReviewSessions = (templates || []).flatMap((t) =>
    t.sessions.filter((s) => s.openReviewRequests > 0).map((s) => ({ ...s, roleName: t.roleName }))
  );

  return (
    <Layout variant="reviewer" auth={auth} title="Interviews" width="wide">
      <PageHeader
        title="Interviews"
        description="Each interview is a role and job description. Invite candidates to it, then review their reports."
        actions={
          isAdmin && (
            <ButtonLink href="/admin/templates/new">
              <Icon name="plus" />
              Create interview
            </ButtonLink>
          )
        }
      />

      {openReviewSessions.length > 0 && (
        <Alert tone="warning" title={`${plural(openReviewSessions.length, 'candidate')} asked for a human review`} className="mb-6">
          <ul className="mt-1 space-y-1">
            {openReviewSessions.map((s) => (
              <li key={s.id}>
                <Link href={`/dashboard/${s.id}#human-review`} className="font-medium underline underline-offset-2">
                  {s.candidateName}
                </Link>{' '}
                — {s.roleName}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {error && (
        <Alert tone="error" title="Couldn't load interviews" className="mb-6">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
            Try again
          </Button>
        </Alert>
      )}
      {!templates && !error && <LoadingState label="Loading interviews…" />}
      {templates && templates.length === 0 && (
        <EmptyState
          title="No interviews yet"
          action={
            isAdmin ? (
              <ButtonLink href="/admin/templates/new">Create your first interview</ButtonLink>
            ) : null
          }
        >
          {isAdmin
            ? 'Create an interview for a role, then invite candidates to it.'
            : 'An admin in your organisation needs to create an interview first.'}
        </EmptyState>
      )}

      {templates && templates.length > 0 && (
        <ul className="space-y-3">
          {templates.map((template) => (
            <li key={template.id}>
              <TemplateCard
                template={template}
                expanded={expanded === template.id}
                onToggle={() => setExpanded(expanded === template.id ? null : template.id)}
                canInvite={isAdmin}
                credits={auth.organization.creditBalance}
                onInvited={handleInvited}
              />
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}

function TemplateCard({ template, expanded, onToggle, canInvite, credits, onInvited }) {
  const panelId = useId();
  const completed = template.sessions.filter((s) => s.status === 'COMPLETED').length;
  const openReviews = template.sessions.filter((s) => s.openReviewRequests > 0).length;

  return (
    <div className="card overflow-hidden">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
        >
          <span className="min-w-0">
            <span className="block font-medium text-slate-900">{template.roleName}</span>
            <span className="mt-0.5 block text-sm text-slate-600">
              {template.jobId ? `${template.jobId} · ` : ''}
              {template.questionMode === 'AI' ? 'AI-generated questions' : 'Manual questions'} ·{' '}
              {plural(template.sessionCount, 'candidate')}
              {template.sessionCount > 0 && ` · ${completed} completed`}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {openReviews > 0 && <Badge tone="warning">{plural(openReviews, 'review request')}</Badge>}
            <Icon
              name="chevronDown"
              className={`h-5 w-5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </span>
        </button>
      </h2>

      {expanded && (
        <div id={panelId} className="space-y-4 border-t border-slate-100 px-5 py-4">
          {canInvite && <InvitePanel templateId={template.id} credits={credits} onInvited={onInvited} />}

          {template.sessions.length === 0 ? (
            <p className="text-sm text-slate-600">No candidates invited yet.</p>
          ) : (
            <ul aria-label={`Candidates for ${template.roleName}`} className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {template.sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/dashboard/${session.id}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{session.candidateName}</span>
                      <span className="block truncate text-xs text-slate-600">{session.email}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {session.openReviewRequests > 0 && <Badge tone="warning">Review requested</Badge>}
                      {session.resumeJdScore != null && (
                        <span className="text-xs text-slate-600">
                          Resume fit <span className="font-medium text-slate-900">{session.resumeJdScore}</span>
                        </span>
                      )}
                      {session.evaluationScore != null && (
                        <span className="text-xs text-slate-600">
                          Interview <span className="font-medium text-slate-900">{session.evaluationScore}/100</span>
                        </span>
                      )}
                      <RecommendationBadge recommendation={session.recommendation} />
                      <StatusBadge status={session.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function InvitePanel({ templateId, credits, onInvited }) {
  const [mode, setMode] = useState('single');
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-800">
          Invite {mode === 'bulk' ? 'candidates in bulk' : 'a candidate'}
        </h3>
        <SegmentedControl
          legend="Invite mode"
          name={`invite-mode-${templateId}`}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'single', label: 'Single' },
            { value: 'bulk', label: 'Bulk' },
          ]}
        />
      </div>
      {credits <= 0 && (
        <Alert tone="warning">
          Your organisation has no credits left, so invites will fail. Contact your account manager to add credits.
        </Alert>
      )}
      {mode === 'bulk' ? (
        <BulkInviteForm templateId={templateId} credits={credits} onInvited={onInvited} />
      ) : (
        <InviteForm templateId={templateId} onInvited={onInvited} />
      )}
    </div>
  );
}

// Parses "name, email" lines (pasted or from a .csv file). A first line with
// no "@" in it is treated as a header row and skipped.
function parseCandidateRows(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 0 && !lines[0].includes('@')) lines.shift();
  return lines.map((line) => {
    const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
    const emailIndex = parts.findIndex((p) => p.includes('@'));
    const email = emailIndex >= 0 ? parts[emailIndex] : '';
    const candidateName = parts.filter((_, i) => i !== emailIndex).join(' ').trim();
    return { candidateName, email };
  });
}

function BulkInviteForm({ templateId, credits, onInvited }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);
  const [invites, setInvites] = useState(null);

  const rows = parseCandidateRows(text);
  const tooMany = rows.length > MAX_BULK_INVITES;
  const notEnoughCredits = rows.length > credits;

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setRowErrors([]);
    setInvites(null);
    try {
      const result = await api.bulkInviteCandidates(templateId, rows);
      setInvites(result.invites);
      setText('');
      await onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not invite these candidates.');
      if (err instanceof ApiError && err.body && Array.isArray(err.body.rowErrors)) {
        setRowErrors(err.body.rowErrors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copyAllText = invites ? invites.map((inv) => `${inv.session.candidateName}, ${inv.session.email}, ${inv.inviteLink}`).join('\n') : '';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field
        label="Candidates"
        hint={`One per line as "name, email" (a header row is skipped). Up to ${MAX_BULK_INVITES} per batch, 1 credit each. If any row is invalid, nobody is invited.`}
      >
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Jane Doe, jane@example.com\nRavi Kumar, ravi@example.com'}
          className="input font-mono"
        />
      </Field>
      <Field label="Or upload a CSV file">
        <input type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} className="file-input" />
      </Field>

      {tooMany && <Alert tone="warning">That&apos;s {rows.length} rows; the limit is {MAX_BULK_INVITES} per batch.</Alert>}
      {!tooMany && notEnoughCredits && rows.length > 0 && (
        <Alert tone="warning">
          This batch needs {plural(rows.length, 'credit')}, but your organisation has {credits}.
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={submitting} loadingText="Inviting…" disabled={rows.length === 0 || tooMany}>
          Invite {plural(rows.length, 'candidate')}
        </Button>
      </div>

      <FormError>
        {error && (
          <>
            <p>{error}</p>
            {rowErrors.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {rowErrors.map((r, i) => (
                  <li key={i}>
                    Row {r.row}: {r.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </FormError>

      {invites && (
        <Alert tone="success" title={`${plural(invites.length, 'candidate')} invited`}>
          <p className="mb-3">Send each candidate their own link. Each link is personal: don&apos;t share it between people.</p>
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li key={inv.session.id}>
                <CopyableLink label={`${inv.session.candidateName} (${inv.session.email})`} url={inv.inviteLink} />
              </li>
            ))}
          </ul>
          {invites.length > 1 && (
            <div className="mt-3">
              <CopyButton text={copyAllText} label="Copy all as CSV" />
            </div>
          )}
        </Alert>
      )}
    </form>
  );
}

function InviteForm({ templateId, onInvited }) {
  const [candidateName, setCandidateName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [invite, setInvite] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInvite(null);
    try {
      const { inviteLink } = await api.inviteCandidate(templateId, {
        candidateName: candidateName.trim(),
        email: email.trim(),
      });
      setInvite({ name: candidateName.trim(), link: inviteLink });
      setCandidateName('');
      setEmail('');
      await onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not invite this candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Candidate name" required>
          <input
            type="text"
            autoComplete="off"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </Field>
        <Button
          type="submit"
          loading={submitting}
          loadingText="Inviting…"
          disabled={!candidateName.trim() || !email.trim()}
        >
          Invite
        </Button>
      </div>
      <p className="hint">Uses 1 credit. You&apos;ll get a personal link to send to the candidate.</p>
      <FormError>{error}</FormError>
      {invite && (
        <Alert tone="success" title={`${invite.name} invited`}>
          <p className="mb-2">Send this link to the candidate:</p>
          <CopyableLink url={invite.link} />
        </Alert>
      )}
    </form>
  );
}
