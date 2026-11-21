import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from './Layout';
import { Alert, Button, LoadingState } from './ui';
import { api, ApiError } from '../lib/api';

// Gates a page behind org_user login. `children` is a render-prop:
// children(auth, refreshAuth) — refreshAuth re-fetches /me, e.g. so the
// header's credit balance updates after invites.
//
// Only a 401 sends the user to /login. Any other failure (API down,
// network) shows a retry instead, so an outage isn't mistaken for a logout.
export default function RequireAuth({ children }) {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  const [error, setError] = useState(null);

  const fetchMe = useCallback(
    () =>
      api
        .me()
        .then((data) => {
          setAuth(data);
          setError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            router.replace('/login');
          } else {
            setError('We could not reach the server. Check your connection and try again.');
          }
        }),
    [router]
  );

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  if (error && !auth) {
    return (
      <Layout variant="reviewer" title="Connection problem">
        <Alert tone="error" title="Something went wrong">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={fetchMe}>
            Try again
          </Button>
        </Alert>
      </Layout>
    );
  }

  if (!auth) {
    return (
      <Layout variant="reviewer" title="Loading">
        <LoadingState />
      </Layout>
    );
  }

  return children(auth, fetchMe);
}
