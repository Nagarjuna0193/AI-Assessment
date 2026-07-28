import Link from 'next/link';
import Layout from '../components/Layout';

// Phase 4.6: candidates no longer land here to fill in JD/resume text
// themselves — they arrive via a per-candidate invite link
// (/invite/[token]) sent after an org admin creates an interview template
// and invites them. This page is just a pointer for anyone who lands here
// directly. See docs/DECISIONS.md.
export default function HomePage() {
  return (
    <Layout>
      <div className="max-w-md mx-auto text-center py-12">
        <h1 className="text-2xl font-semibold mb-3">AI Interview Bot</h1>
        <p className="text-slate-500 mb-6">
          Candidates: use the invite link sent to you by email to start your interview.
        </p>
        <Link
          href="/login"
          className="inline-block bg-slate-900 text-white rounded-md px-5 py-2.5 font-medium hover:bg-slate-800"
        >
          Reviewer / admin login
        </Link>
      </div>
    </Layout>
  );
}
