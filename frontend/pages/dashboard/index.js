import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../../components/Layout';
import RequireAuth from '../../components/RequireAuth';
import { api, ApiError } from '../../lib/api';

const STATUS_STYLES = {
  INVITED: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

export default function DashboardPage() {
  return <RequireAuth>{(auth) => <DashboardContent auth={auth} />}</RequireAuth>;
}

function DashboardContent({ auth }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = () =>
    api
      .listTemplates()
      .then((data) => setTemplates(data.templates))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load interviews.'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    await api.logout();
    router.push('/login');
  };

  return (
    <Layout
      accountInfo={
        <span className="text-sm text-slate-500 flex items-center gap-3">
          {auth.organization.name} · {auth.organization.creditBalance} credits
          <button onClick={handleLogout} className="text-slate-500 hover:text-slate-800 underline">
            Log out
          </button>
        </span>
      }
    >
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Interviews</h1>
        {auth.orgUser.role === 'ADMIN' && (
          <Link
            href="/admin/templates/new"
            className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-slate-800"
          >
            + Create interview
          </Link>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {!templates && !error && <p className="text-slate-500">Loading…</p>}
      {templates && templates.length === 0 && (
        <p className="text-slate-500">
          No interview templates yet.{' '}
          {auth.orgUser.role === 'ADMIN' && (
            <Link href="/admin/templates/new" className="underline">
              Create one
            </Link>
          )}
        </p>
      )}

      {templates && templates.length > 0 && (
        <div className="space-y-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              expanded={expanded === template.id}
              onToggle={() => setExpanded(expanded === template.id ? null : template.id)}
              canInvite={auth.orgUser.role === 'ADMIN'}
              onInvited={load}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}

function TemplateCard({ template, expanded, onToggle, canInvite, onInvited }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50"
      >
        <div>
          <p className="font-medium text-slate-800">{template.roleName}</p>
          <p className="text-sm text-slate-500">
            {template.jobId ? `${template.jobId} · ` : ''}
            {template.questionMode === 'AI' ? 'AI-generated questions' : 'Manual questions'} ·{' '}
            {template.sessionCount} candidate{template.sessionCount === 1 ? '' : 's'}
          </p>
        </div>
        <span className="text-slate-400 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          {canInvite && <InvitePanel templateId={template.id} onInvited={onInvited} />}

          {template.sessions.length === 0 ? (
            <p className="text-sm text-slate-500">No candidates invited yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-md">
              {template.sessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/dashboard/${session.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{session.candidateName}</p>
                    <p className="text-xs text-slate-500">{session.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {session.resumeJdScore != null && (
                      <span className="text-xs text-slate-500">JD fit: {session.resumeJdScore}</span>
                    )}
                    {session.evaluationScore != null && (
                      <span className="text-sm font-medium text-slate-700">{session.evaluationScore}/100</span>
                    )}
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${
                        STATUS_STYLES[session.status] || 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {session.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InvitePanel({ templateId, onInvited }) {
  const [bulk, setBulk] = useState(false);
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Invite {bulk ? 'candidates in bulk' : 'a candidate'}</p>
        <div className="flex text-xs border border-slate-300 rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setBulk(false)}
            className={`px-2 py-1 ${!bulk ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => setBulk(true)}
            className={`px-2 py-1 ${bulk ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
          >
            Bulk
          </button>
        </div>
      </div>
      {bulk ? (
        <BulkInviteForm templateId={templateId} onInvited={onInvited} />
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

function BulkInviteForm({ templateId, onInvited }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);
  const [invites, setInvites] = useState(null);

  const rows = parseCandidateRows(text);

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
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not invite these candidates.');
      if (err instanceof ApiError && err.body && Array.isArray(err.body.rowErrors)) {
        setRowErrors(err.body.rowErrors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <p className="text-xs text-slate-500">
        One candidate per line as <span className="font-mono">name, email</span>, or upload a .csv with
        those two columns. Each invite uses 1 credit. If any row is invalid, nobody is invited.
      </p>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Jane Doe, jane@example.com\nRavi Kumar, ravi@example.com'}
        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} className="text-xs" />
        <button
          type="submit"
          disabled={submitting || rows.length === 0}
          className="ml-auto bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {submitting ? 'Inviting…' : `Invite ${rows.length} candidate${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {rowErrors.length > 0 && (
        <ul className="text-xs text-red-600 list-disc pl-5">
          {rowErrors.map((r, i) => (
            <li key={i}>
              Row {r.row}: {r.message}
            </li>
          ))}
        </ul>
      )}
      {invites && (
        <div className="text-xs text-emerald-700 space-y-1">
          <p className="font-medium">{invites.length} invited. Send each candidate their link:</p>
          <ul className="space-y-0.5 break-all">
            {invites.map((inv) => (
              <li key={inv.session.id}>
                {inv.session.candidateName} ({inv.session.email}): <span className="font-mono">{inv.inviteLink}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

function InviteForm({ templateId, onInvited }) {
  const [candidateName, setCandidateName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [inviteLink, setInviteLink] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInviteLink(null);
    try {
      const { inviteLink: link } = await api.inviteCandidate(templateId, {
        candidateName: candidateName.trim(),
        email: email.trim(),
      });
      setInviteLink(link);
      setCandidateName('');
      setEmail('');
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not invite this candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          required
          placeholder="Candidate name"
          value={candidateName}
          onChange={(e) => setCandidateName(e.target.value)}
          className="flex-1 min-w-[10rem] border border-slate-300 rounded-md px-2 py-1.5 text-sm"
        />
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 min-w-[10rem] border border-slate-300 rounded-md px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={submitting || !candidateName.trim() || !email.trim()}
          className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {submitting ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {inviteLink && (
        <p className="text-xs text-emerald-700 break-all">
          Invite link (send to the candidate): <span className="font-mono">{inviteLink}</span>
        </p>
      )}
    </form>
  );
}
