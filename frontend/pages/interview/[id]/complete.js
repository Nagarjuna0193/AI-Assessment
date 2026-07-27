import Layout from '../../../components/Layout';

export default function InterviewCompletePage() {
  return (
    <Layout>
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Interview complete</h1>
        <p className="text-slate-500">
          Thank you for completing your interview. Your responses have been recorded and will be
          reviewed by the hiring team. If you have questions about how your data was used or
          would like to request a human review of your evaluation, please contact the recruiter
          who invited you.
        </p>
      </div>
    </Layout>
  );
}
