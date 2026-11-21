import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../components/Layout';
import { Button, Field, FormError } from '../components/ui';
import { api, ApiError } from '../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const headingRef = useRef(null);

  // Move focus to the heading when the step changes so screen-reader users
  // hear the new instructions.
  useEffect(() => {
    if (step === 'code' && headingRef.current) headingRef.current.focus();
  }, [step]);

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
      setSubmitting(false);
    }
  };

  return (
    <Layout variant="reviewer" title="Reviewer login" width="narrow">
      <div className="card p-6 sm:p-8">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight focus:outline-none">
          {step === 'email' ? 'Reviewer login' : 'Check your email'}
        </h1>
        <p className="mt-1 mb-6 text-sm text-slate-600">
          {step === 'email' ? (
            "We'll email you a one-time login code. No password needed."
          ) : (
            <>
              Enter the code we sent to <span className="font-medium text-slate-900">{email}</span>.
            </>
          )}
        </p>

        {step === 'email' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <Field label="Work email" required>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </Field>
            <FormError>{error}</FormError>
            <Button type="submit" block loading={submitting} loadingText="Sending…" disabled={!email.trim()}>
              Send login code
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <Field label="Login code" hint="The code expires after a few minutes." required>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="input text-center font-mono text-lg tracking-[0.5em]"
              />
            </Field>
            <FormError>{error}</FormError>
            <Button type="submit" block loading={submitting} loadingText="Verifying…" disabled={!code.trim()}>
              Verify &amp; sign in
            </Button>
            <Button
              variant="ghost"
              block
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
      </div>
    </Layout>
  );
}
