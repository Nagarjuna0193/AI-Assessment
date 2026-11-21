import Layout from '../components/Layout';
import { ButtonLink } from '../components/ui';

// Phase 4.6: candidates no longer land here to fill in JD/resume text
// themselves — they arrive via a per-candidate invite link
// (/invite/[token]) sent after an org admin creates an interview template
// and invites them. This page is just a pointer for anyone who lands here
// directly. See docs/DECISIONS.md.
export default function HomePage() {
  return (
    <Layout width="narrow">
      <div className="card px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="mt-3 text-slate-600">
          <span className="font-medium text-slate-800">Candidates:</span> open the personal invite link the
          hiring team sent you to start your interview. There is no sign-up.
        </p>
        <div className="mt-8 border-t border-slate-100 pt-6">
          <p className="mb-3 text-sm text-slate-600">Hiring team member?</p>
          <ButtonLink href="/login" variant="secondary">
            Reviewer / admin login
          </ButtonLink>
        </div>
      </div>
    </Layout>
  );
}
