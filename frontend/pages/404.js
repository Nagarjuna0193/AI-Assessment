import Layout from '../components/Layout';
import { ButtonLink } from '../components/ui';

export default function NotFoundPage() {
  return (
    <Layout title="Page not found" width="narrow">
      <div className="card px-6 py-10 text-center">
        <p className="text-sm font-medium text-brand-700">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 text-slate-600">
          If you followed an interview invite link, check that you copied the whole link from the email.
        </p>
        <ButtonLink href="/" variant="secondary" className="mt-6">
          Go to the home page
        </ButtonLink>
      </div>
    </Layout>
  );
}
