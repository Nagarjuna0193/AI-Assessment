import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '../lib/api';

// Gates a page behind org_user login, redirecting to /login on a 401.
// `children` is a render-prop so pages get the logged-in org/user without
// needing their own auth-check boilerplate.
export default function RequireAuth({ children }) {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((data) => {
        setAuth(data);
        setChecked(true);
      })
      .catch(() => {
        router.replace('/login');
      });
  }, [router]);

  if (!checked) {
    return <p className="text-slate-500">Loading…</p>;
  }

  return children(auth);
}
