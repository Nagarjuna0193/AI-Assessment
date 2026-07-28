import { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../components/Layout';
import { api, ApiError } from '../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.requestOtp(email.trim());
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send login code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.verifyOtp(email.trim(), code.trim());
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-sm mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Reviewer login</h1>
        <p className="text-slate-500 mb-6">
          {step === 'email'
            ? "We'll email you a one-time login code."
            : `Enter the code sent to ${email}.`}
        </p>

        {step === 'email' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <label className="block text-sm">
              <span className="text-slate-700 font-medium">Work email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input mt-1"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full bg-slate-900 text-white rounded-md py-2.5 font-medium disabled:opacity-40 hover:bg-slate-800"
            >
              {submitting ? 'Sending…' : 'Send login code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <label className="block text-sm">
              <span className="text-slate-700 font-medium">Login code</span>
              <input
                type="text"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input mt-1"
                autoFocus
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !code.trim()}
              className="w-full bg-slate-900 text-white rounded-md py-2.5 font-medium disabled:opacity-40 hover:bg-slate-800"
            >
              {submitting ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
              className="w-full text-sm text-slate-500 hover:text-slate-800"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>

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
