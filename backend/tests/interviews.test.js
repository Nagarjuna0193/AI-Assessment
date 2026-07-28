jest.mock('../src/db/prismaClient', () => {
  const prisma = {
    candidate: { findUnique: jest.fn() },
    consentRecord: { findMany: jest.fn() },
    interview: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    question: { findUnique: jest.fn(), count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    response: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    evaluation: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    organization: { findUnique: jest.fn(), updateMany: jest.fn() },
    creditTransaction: { create: jest.fn() },
    $transaction: jest.fn((cb) => cb(prisma)),
  };
  return prisma;
});

jest.mock('../src/services/anthropicService', () => {
  const actual = jest.requireActual('../src/services/anthropicService');
  return {
    ...actual,
    generateQuestions: jest.fn(),
    evaluateTranscript: jest.fn(),
  };
});

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const anthropicService = require('../src/services/anthropicService');
const authService = require('../src/services/authService');
const app = require('../src/app');

const ORG = { id: 'org_1', name: 'Acme Corp', creditBalance: 5 };

function orgSessionCookie(overrides = {}) {
  const token = authService.signSessionToken({
    id: 'orguser_1',
    orgId: 'org_1',
    role: 'REVIEWER',
    email: 'reviewer@acme.com',
    ...overrides,
  });
  return `org_session=${token}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.organization.findUnique.mockResolvedValue({ ...ORG });
  prisma.organization.updateMany.mockResolvedValue({ count: 1 });
  prisma.creditTransaction.create.mockResolvedValue({});
});

describe('POST /api/interviews', () => {
  it('returns 404 when the candidate has not gone through consent', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      orgId: 'org_1',
    });

    expect(res.status).toBe(404);
    expect(anthropicService.generateQuestions).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 404 when the organization does not exist', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.organization.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      orgId: 'org_missing',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('organization_not_found');
    expect(anthropicService.generateQuestions).not.toHaveBeenCalled();
  });

  it('returns 402 when the organization has no credits remaining', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.organization.findUnique.mockResolvedValue({ ...ORG, creditBalance: 0 });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      orgId: 'org_1',
    });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('insufficient_credits');
    expect(anthropicService.generateQuestions).not.toHaveBeenCalled();
  });

  it('rejects with 403 when consent has not been recorded', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.consentRecord.findMany.mockResolvedValue([]);

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      orgId: 'org_1',
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('consent_required');
    expect(anthropicService.generateQuestions).not.toHaveBeenCalled();
  });

  it('rejects a voice-mode interview with 403 when only data_processing consent is recorded', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      mode: 'VOICE',
      orgId: 'org_1',
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('consent_required');
    expect(anthropicService.generateQuestions).not.toHaveBeenCalled();
  });

  it('creates a voice-mode interview when both data_processing and voice_recording consent exist', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
      { consentType: 'voice_recording', consentWithdrawnAt: null },
    ]);
    anthropicService.generateQuestions.mockResolvedValue({
      questions: [{ questionText: 'Q1' }],
      model: 'claude-opus-5',
    });
    prisma.interview.create.mockResolvedValue({
      id: 'int_voice',
      questions: [{ id: 'q1', orderIndex: 0, questionText: 'Q1' }],
    });

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      mode: 'VOICE',
      orgId: 'org_1',
    });

    expect(res.status).toBe(201);
    expect(prisma.interview.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mode: 'VOICE', orgId: 'org_1' }) })
    );
    expect(prisma.organization.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org_1', creditBalance: { gt: 0 } } })
    );
  });

  it('generates questions and creates the interview when consent exists', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);
    anthropicService.generateQuestions.mockResolvedValue({
      questions: [{ questionText: 'Q1' }, { questionText: 'Q2' }],
      model: 'claude-opus-5',
    });
    prisma.interview.create.mockResolvedValue({
      id: 'int_1',
      questions: [
        { id: 'q1', orderIndex: 0, questionText: 'Q1' },
        { id: 'q2', orderIndex: 1, questionText: 'Q2' },
      ],
    });

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      orgId: 'org_1',
    });

    expect(res.status).toBe(201);
    expect(res.body.interviewId).toBe('int_1');
    expect(res.body.totalQuestions).toBe(2);
    expect(res.body.firstQuestion.questionText).toBe('Q1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'question_generated', entityType: 'interview' }),
      })
    );
    expect(prisma.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: 'org_1', type: 'DEDUCTION', interviewId: 'int_1' }),
      })
    );
  });

  it('returns 402 and does not create the interview when the atomic credit deduction loses the race', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);
    anthropicService.generateQuestions.mockResolvedValue({
      questions: [{ questionText: 'Q1' }],
      model: 'claude-opus-5',
    });
    prisma.interview.create.mockResolvedValue({ id: 'int_1', questions: [] });
    prisma.organization.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      orgId: 'org_1',
    });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('insufficient_credits');
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });

  it('returns 502 when Claude declines the request', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);
    anthropicService.generateQuestions.mockRejectedValue(
      new anthropicService.AnthropicRefusalError('cyber')
    );

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
      orgId: 'org_1',
    });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('question_generation_declined');
    expect(prisma.interview.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/interviews/:id/answers', () => {
  it('returns the next question when more remain', async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: 'int_1', status: 'IN_PROGRESS' });
    prisma.question.findUnique.mockResolvedValue({ id: 'q1', interviewId: 'int_1' });
    prisma.response.findFirst.mockResolvedValue(null);
    prisma.response.create.mockResolvedValue({});
    prisma.question.count.mockResolvedValue(2);
    prisma.response.count.mockResolvedValue(1);
    prisma.response.findMany.mockResolvedValue([{ questionId: 'q1' }]);
    prisma.question.findFirst.mockResolvedValue({ id: 'q2', orderIndex: 1, questionText: 'Q2' });

    const res = await request(app)
      .post('/api/interviews/int_1/answers')
      .send({ questionId: 'q1', responseText: 'answer 1' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(false);
    expect(res.body.nextQuestion.id).toBe('q2');
  });

  it('marks the interview complete on the final answer', async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: 'int_1', status: 'IN_PROGRESS' });
    prisma.question.findUnique.mockResolvedValue({ id: 'q2', interviewId: 'int_1' });
    prisma.response.findFirst.mockResolvedValue(null);
    prisma.response.create.mockResolvedValue({});
    prisma.question.count.mockResolvedValue(2);
    prisma.response.count.mockResolvedValue(2);
    prisma.interview.update.mockResolvedValue({});

    const res = await request(app)
      .post('/api/interviews/int_1/answers')
      .send({ questionId: 'q2', responseText: 'answer 2' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(prisma.interview.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
  });

  it('rejects an answer once the interview is no longer in progress', async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: 'int_1', status: 'COMPLETED' });

    const res = await request(app)
      .post('/api/interviews/int_1/answers')
      .send({ questionId: 'q1', responseText: 'answer' });

    expect(res.status).toBe(409);
    expect(prisma.response.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate answer to an already-answered question', async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: 'int_1', status: 'IN_PROGRESS' });
    prisma.question.findUnique.mockResolvedValue({ id: 'q1', interviewId: 'int_1' });
    prisma.response.findFirst.mockResolvedValue({ id: 'resp_1' });

    const res = await request(app)
      .post('/api/interviews/int_1/answers')
      .send({ questionId: 'q1', responseText: 'answer again' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_answered');
    expect(prisma.response.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/interviews/:id/evaluate', () => {
  it('rejects when the interview is not complete', async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: 'int_1', status: 'IN_PROGRESS' });

    const res = await request(app).post('/api/interviews/int_1/evaluate').send({});

    expect(res.status).toBe(409);
    expect(anthropicService.evaluateTranscript).not.toHaveBeenCalled();
  });

  it('generates and stores an evaluation, and logs an audit entry', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'COMPLETED',
      jobDescriptionText: 'JD',
    });
    prisma.question.findMany.mockResolvedValue([
      { questionText: 'Q1', responses: [{ responseText: 'A1' }] },
    ]);
    anthropicService.evaluateTranscript.mockResolvedValue({
      overallScore: 80,
      summaryText: 'Good fit',
      scorecard: [{ criterion: 'Communication', score: 8, notes: 'Clear' }],
      model: 'claude-opus-5',
    });
    prisma.evaluation.create.mockResolvedValue({ id: 'eval_1', overallScore: 80 });

    const res = await request(app).post('/api/interviews/int_1/evaluate').send({});

    expect(res.status).toBe(201);
    expect(res.body.evaluation.overallScore).toBe(80);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'evaluation_generated', entityType: 'evaluation' }),
      })
    );
  });

  it('returns 502 when Claude declines the evaluation request', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'COMPLETED',
      jobDescriptionText: 'JD',
    });
    prisma.question.findMany.mockResolvedValue([
      { questionText: 'Q1', responses: [{ responseText: 'A1' }] },
    ]);
    anthropicService.evaluateTranscript.mockRejectedValue(
      new anthropicService.AnthropicRefusalError(null)
    );

    const res = await request(app).post('/api/interviews/int_1/evaluate').send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('evaluation_declined');
    expect(prisma.evaluation.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/interviews', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await request(app).get('/api/interviews');

    expect(res.status).toBe(401);
    expect(prisma.interview.findMany).not.toHaveBeenCalled();
  });

  it("lists only the logged-in org's interviews, with candidate and latest evaluation summary", async () => {
    prisma.interview.findMany.mockResolvedValue([
      {
        id: 'int_1',
        jobTitle: 'Backend Engineer',
        mode: 'TEXT',
        status: 'COMPLETED',
        createdAt: new Date('2026-07-01'),
        candidate: { id: 'cand_1', fullName: 'Jane Doe', email: 'a@b.com' },
        evaluations: [{ overallScore: 78 }],
      },
      {
        id: 'int_2',
        jobTitle: 'Frontend Engineer',
        mode: 'TEXT',
        status: 'IN_PROGRESS',
        createdAt: new Date('2026-07-02'),
        candidate: { id: 'cand_2', fullName: 'John Smith', email: 'c@d.com' },
        evaluations: [],
      },
    ]);

    const res = await request(app).get('/api/interviews').set('Cookie', orgSessionCookie());

    expect(res.status).toBe(200);
    expect(res.body.interviews).toHaveLength(2);
    expect(res.body.interviews[0].evaluation).toEqual({ overallScore: 78 });
    expect(res.body.interviews[1].evaluation).toBeNull();
    expect(prisma.interview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org_1' } })
    );
  });
});

describe('GET /api/interviews/:id/progress', () => {
  it('returns 404 when the interview does not exist', async () => {
    prisma.interview.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/interviews/int_missing/progress');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('interview_not_found');
  });

  it('returns minimal progress data with no session cookie (candidate-facing, unauthenticated)', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      orgId: 'org_1',
      jobTitle: 'Backend Engineer',
      jobDescriptionText: 'should not be exposed here',
      mode: 'TEXT',
      status: 'IN_PROGRESS',
      questions: [
        { id: 'q1', orderIndex: 0, questionText: 'Q1', responses: [{ responseText: 'A1' }] },
        { id: 'q2', orderIndex: 1, questionText: 'Q2', responses: [] },
      ],
    });

    const res = await request(app).get('/api/interviews/int_1/progress');

    expect(res.status).toBe(200);
    expect(res.body.interview).toEqual({
      id: 'int_1',
      jobTitle: 'Backend Engineer',
      mode: 'TEXT',
      status: 'IN_PROGRESS',
    });
    expect(res.body.transcript).toEqual([
      { questionId: 'q1', orderIndex: 0, questionText: 'Q1', responseText: 'A1' },
      { questionId: 'q2', orderIndex: 1, questionText: 'Q2', responseText: null },
    ]);
  });
});

describe('GET /api/interviews/:id', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await request(app).get('/api/interviews/int_1');

    expect(res.status).toBe(401);
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the interview does not exist', async () => {
    prisma.interview.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/interviews/int_missing')
      .set('Cookie', orgSessionCookie());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('interview_not_found');
  });

  it("returns 404 when the interview belongs to a different org", async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      orgId: 'org_other',
      candidate: { id: 'cand_1', fullName: 'Jane Doe', email: 'a@b.com' },
      questions: [],
      evaluations: [],
    });

    const res = await request(app).get('/api/interviews/int_1').set('Cookie', orgSessionCookie());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('interview_not_found');
  });

  it('returns the transcript and evaluation for a completed interview', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      orgId: 'org_1',
      jobTitle: 'Backend Engineer',
      jobDescriptionText: 'JD text',
      mode: 'TEXT',
      status: 'COMPLETED',
      createdAt: new Date('2026-07-01'),
      completedAt: new Date('2026-07-01'),
      candidate: { id: 'cand_1', fullName: 'Jane Doe', email: 'a@b.com' },
      questions: [
        {
          id: 'q1',
          orderIndex: 0,
          questionText: 'Q1',
          responses: [{ responseText: 'A1' }],
        },
      ],
      evaluations: [{ id: 'eval_1', overallScore: 78, summaryText: 'Good fit', scorecard: [] }],
    });

    const res = await request(app).get('/api/interviews/int_1').set('Cookie', orgSessionCookie());

    expect(res.status).toBe(200);
    expect(res.body.interview.id).toBe('int_1');
    expect(res.body.transcript).toEqual([
      { questionId: 'q1', orderIndex: 0, questionText: 'Q1', responseText: 'A1' },
    ]);
    expect(res.body.evaluation.overallScore).toBe(78);
  });
});
