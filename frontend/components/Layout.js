import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { api } from '../lib/api';
import { Badge } from './ui';

const APP_NAME = 'AI Interview Bot';

const WIDTHS = {
  narrow: 'max-w-md',
  default: 'max-w-3xl',
  wide: 'max-w-5xl',
};

// Two shells:
// - candidate (default): brand only, no links into the reviewer side, plus a
//   footer reminding them a person makes the decision.
// - reviewer: org, credits, signed-in user, nav and logout.
export default function Layout({ title, variant = 'candidate', auth, width = 'default', children }) {
  const pageTitle = title ? `${title} · ${APP_NAME}` : APP_NAME;

  return (
    <div className="flex min-h-screen flex-col">
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>

      {variant === 'reviewer' ? <ReviewerHeader auth={auth} width={width} /> : <CandidateHeader width={width} />}

      <main id="main" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 py-8 focus:outline-none sm:py-10 ${WIDTHS[width]}`}>
        {children}
      </main>

      {variant !== 'reviewer' && (
        <footer className="border-t border-slate-200 bg-white">
          <p className={`mx-auto px-4 py-4 text-xs text-slate-600 ${WIDTHS[width]}`}>
            This interview is AI-assisted. A person on the hiring team makes the final decision, and
            you can ask for a human review once you finish.
          </p>
        </footer>
      )}
    </div>
  );
}

function Brand({ href }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold text-slate-900">
      <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">
        AI
      </span>
      {APP_NAME}
    </Link>
  );
}

function CandidateHeader({ width }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className={`mx-auto flex items-center px-4 py-3 ${WIDTHS[width]}`}>
        <Brand href="/" />
      </div>
    </header>
  );
}

function ReviewerHeader({ auth, width }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const onDashboard = router.pathname.startsWith('/dashboard');

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api.logout();
    } catch {
      // Cookie may already be gone; send them to login either way.
    }
    router.push('/login');
  };

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className={`mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 ${WIDTHS[width]}`}>
        <div className="flex items-center gap-6">
          <Brand href={auth ? '/dashboard' : '/'} />
          {auth && (
            <nav aria-label="Main">
              <Link
                href="/dashboard"
                aria-current={onDashboard ? 'page' : undefined}
                className={`text-sm ${onDashboard ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Interviews
              </Link>
            </nav>
          )}
        </div>
        {auth && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-700">{auth.organization.name}</span>
            <Badge tone={auth.organization.creditBalance > 0 ? 'brand' : 'warning'}>
              {auth.organization.creditBalance} credit{auth.organization.creditBalance === 1 ? '' : 's'}
            </Badge>
            {auth.orgUser && auth.orgUser.email && (
              <span className="hidden text-slate-500 md:inline" title={auth.orgUser.email}>
                {auth.orgUser.email}
              </span>
            )}
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
            >
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
