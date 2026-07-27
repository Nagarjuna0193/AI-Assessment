jest.mock('../src/db/prismaClient', () => ({
  candidate: { findUnique: jest.fn() },
  consentRecord: { findMany: jest.fn() },
  interview: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  question: { findUnique: jest.fn(), count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  response: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  evaluation: { create: jest.fn() },
  auditLog: { create: jest.fn() },
}));

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
const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
});

describe('POST /api/interviews', () => {
  it('returns 404 when the candidate has not gone through consent', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
    });

    expect(res.status).toBe(404);
    expect(anthropicService.generateQuestions).not.toHaveBeenCalled();
  });

  it('rejects with 403 when consent has not been recorded', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1', email: 'a@b.com' });
    prisma.consentRecord.findMany.mockResolvedValue([]);

    const res = await request(app).post('/api/interviews').send({
      candidateEmail: 'a@b.com',
      jobDescriptionText: 'JD',
      resumeText: 'Resume',
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('consent_required');
    expect(anthropicService.generateQuestions).not.toHaveBeenCalled();
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
