jest.mock('../src/db/prismaClient', () => ({
  interviewTemplate: { findMany: jest.fn() },
  candidateSession: { findUnique: jest.fn() },
  question: { findMany: jest.fn() },
  evaluation: { create: jest.fn() },
  auditLog: { create: jest.fn() },
}));

jest.mock('../src/services/anthropicService', () => {
  const actual = jest.requireActual('../src/services/anthropicService');
  return {
    ...actual,
    evaluateTranscript: jest.fn(),
  };
});

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const anthropicService = require('../src/services/anthropicService');
const authService = require('../src/services/authService');
const app = require('../src/app');

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
});

describe('GET /api/interviews (list templates)', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await request(app).get('/api/interviews');
    expect(res.status).toBe(401);
    expect(prisma.interviewTemplate.findMany).not.toHaveBeenCalled();
  });

  it("lists only the logged-in org's templates, with session counts/statuses", async () => {
    prisma.interviewTemplate.findMany.mockResolvedValue([
      {
        id: 'tmpl_1',
        roleName: 'Backend Engineer',
        jobId: 'REQ-1',
        questionMode: 'AI',
        createdAt: new Date('2026-07-01'),
        candidateSessions: [
          {
            id: 'sess_1',
            candidateName: 'Jane Doe',
            email: 'jane@example.com',
            status: 'COMPLETED',
            resumeJdScore: 82,
            createdAt: new Date('2026-07-02'),
            evaluations: [{ overallScore: 78 }],
          },
          {
            id: 'sess_2',
            candidateName: 'John Smith',
            email: 'john@example.com',
            status: 'INVITED',
            resumeJdScore: null,
            createdAt: new Date('2026-07-03'),
            evaluations: [],
          },
        ],
      },
    ]);

    const res = await request(app).get('/api/interviews').set('Cookie', orgSessionCookie());

    expect(res.status).toBe(200);
    expect(prisma.interviewTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org_1' } })
    );
    expect(res.body.templates).toHaveLength(1);
    const template = res.body.templates[0];
    expect(template.sessionCount).toBe(2);
    expect(template.statusCounts).toEqual({ COMPLETED: 1, INVITED: 1 });
    expect(template.sessions[0].evaluationScore).toBe(78);
    expect(template.sessions[1].evaluationScore).toBeNull();
  });
});

describe('GET /api/interviews/:id (template + session detail)', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await request(app).get('/api/interviews/sess_1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when the session does not exist', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/interviews/sess_missing').set('Cookie', orgSessionCookie());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session_not_found');
  });

  it('returns 404 when the session belongs to a different org', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      orgId: 'org_other',
      template: {},
      questions: [],
      evaluations: [],
    });

    const res = await request(app).get('/api/interviews/sess_1').set('Cookie', orgSessionCookie());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session_not_found');
  });

  it('returns template info + session resume score/transcript/evaluation', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      orgId: 'org_1',
      candidateName: 'Jane Doe',
      email: 'jane@example.com',
      status: 'COMPLETED',
      mode: 'TEXT',
      resumeJdScore: 82,
      resumeJdRationale: 'Strong backend experience match.',
      createdAt: new Date('2026-07-01'),
      completedAt: new Date('2026-07-01'),
      template: {
        id: 'tmpl_1',
        roleName: 'Backend Engineer',
        jobId: 'REQ-1',
        jobDescriptionText: 'JD text',
        questionMode: 'AI',
      },
      questions: [
        { id: 'q1', orderIndex: 0, questionText: 'Q1', responses: [{ responseText: 'A1' }] },
      ],
      evaluations: [{ id: 'eval_1', overallScore: 78, summaryText: 'Good fit', scorecard: [] }],
    });

    const res = await request(app).get('/api/interviews/sess_1').set('Cookie', orgSessionCookie());

    expect(res.status).toBe(200);
    expect(res.body.template.roleName).toBe('Backend Engineer');
    expect(res.body.session.resumeJdScore).toBe(82);
    expect(res.body.session.resumeJdRationale).toBe('Strong backend experience match.');
    expect(res.body.transcript).toEqual([
      { questionId: 'q1', orderIndex: 0, questionText: 'Q1', responseText: 'A1' },
    ]);
    expect(res.body.evaluation.overallScore).toBe(78);
  });
});

describe('POST /api/interviews/:id/evaluate', () => {
  it('rejects when the session is not complete', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      orgId: 'org_1',
      status: 'IN_PROGRESS',
      template: { jobDescriptionText: 'JD' },
    });

    const res = await request(app)
      .post('/api/interviews/sess_1/evaluate')
      .set('Cookie', orgSessionCookie())
      .send({});

    expect(res.status).toBe(409);
    expect(anthropicService.evaluateTranscript).not.toHaveBeenCalled();
  });

  it('returns 404 when the session belongs to a different org', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      orgId: 'org_other',
      status: 'COMPLETED',
      template: { jobDescriptionText: 'JD' },
    });

    const res = await request(app)
      .post('/api/interviews/sess_1/evaluate')
      .set('Cookie', orgSessionCookie())
      .send({});

    expect(res.status).toBe(404);
  });

  it('generates and stores an evaluation, and logs an audit entry', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      orgId: 'org_1',
      status: 'COMPLETED',
      template: { jobDescriptionText: 'JD' },
    });
    prisma.question.findMany.mockResolvedValue([
      { questionText: 'Q1', responses: [{ responseText: 'A1' }] },
    ]);
    anthropicService.evaluateTranscript.mockResolvedValue({
      overallScore: 80,
      recommendation: 'advance',
      summaryText: 'Good fit',
      strengths: [{ point: 'Clear', evidence: 'Q1' }],
      concerns: [],
      scorecard: [{ criterion: 'Communication', score: 4, evidence: 'Q1', notes: 'Clear', questionNumbers: [1] }],
      model: 'claude-opus-5-5',
      promptVersion: 'evaluation.v2',
    });
    prisma.evaluation.create.mockResolvedValue({ id: 'eval_1', overallScore: 80 });

    const res = await request(app)
      .post('/api/interviews/sess_1/evaluate')
      .set('Cookie', orgSessionCookie())
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.evaluation.overallScore).toBe(80);
    expect(prisma.evaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'sess_1',
          recommendation: 'advance',
          strengths: [{ point: 'Clear', evidence: 'Q1' }],
          concerns: [],
          promptVersion: 'evaluation.v2',
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'evaluation_generated',
          entityType: 'evaluation',
          promptRef: 'evaluation.v2',
          inputRef: 'candidate_session:sess_1',
          outputRef: 'evaluation:eval_1',
        }),
      })
    );
  });

  it('returns 502 when Claude declines the evaluation request', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      orgId: 'org_1',
      status: 'COMPLETED',
      template: { jobDescriptionText: 'JD' },
    });
    prisma.question.findMany.mockResolvedValue([
      { questionText: 'Q1', responses: [{ responseText: 'A1' }] },
    ]);
    anthropicService.evaluateTranscript.mockRejectedValue(
      new anthropicService.AnthropicRefusalError(null)
    );

    const res = await request(app)
      .post('/api/interviews/sess_1/evaluate')
      .set('Cookie', orgSessionCookie())
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('evaluation_declined');
    expect(prisma.evaluation.create).not.toHaveBeenCalled();
  });
});
