import Link from 'next/link';

export default function Layout({ children, accountInfo }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="font-semibold text-slate-800">
            AI Interview Bot
          </Link>
          <div className="flex items-center gap-4">
            {accountInfo}
            <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
              Reviewer dashboard
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
