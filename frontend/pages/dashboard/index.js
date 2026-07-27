import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '../../components/Layout';
import { api, ApiError } from '../../lib/api';

const STATUS_STYLES = {
  SCHEDULED: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
};

export default function DashboardPage() {
  const [interviews, setInterviews] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listInterviews()
      .then((data) => setInterviews(data.interviews))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load interviews.'));
  }, []);

  return (
    <Layout>
      <h1 className="text-2xl font-semibold mb-6">Interviews</h1>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {!interviews && !error && <p className="text-slate-500">Loading…</p>}
      {interviews && interviews.length === 0 && (
        <p className="text-slate-500">No interviews yet.</p>
      )}

      {interviews && interviews.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {interviews.map((interview) => (
            <Link
              key={interview.id}
              href={`/dashboard/${interview.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-slate-50"
            >
              <div>
                <p className="font-medium text-slate-800">{interview.candidate.fullName}</p>
                <p className="text-sm text-slate-500">
                  {interview.candidate.email}
                  {interview.jobTitle ? ` · ${interview.jobTitle}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {interview.evaluation && (
                  <span className="text-sm font-medium text-slate-700">
                    {interview.evaluation.overallScore}/100
                  </span>
                )}
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full ${
                    STATUS_STYLES[interview.status] || 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {interview.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
