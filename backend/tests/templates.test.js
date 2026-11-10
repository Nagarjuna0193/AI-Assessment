jest.mock('../src/db/prismaClient', () => {
  const prisma = {
    interviewTemplate: { create: jest.fn(), findUnique: jest.fn() },
    organization: { findUnique: jest.fn(), updateMany: jest.fn() },
    candidateSession: { create: jest.fn() },
    creditTransaction: { create: jest.fn() },
    $transaction: jest.fn((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return prisma;
});

jest.mock('../src/services/resumeParserService', () => {
  const actual = jest.requireActual('../src/services/resumeParserService');
  return {
    ...actual,
    extractText: jest.fn(),
  };
});

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const resumeParserService = require('../src/services/resumeParserService');
const authService = require('../src/services/authService');
const app = require('../src/app');

function cookieFor(role) {
  const token = authService.signSessionToken({
    id: 'orguser_1',
    orgId: 'org_1',
    role,
    email: 'user@acme.com',
  });
  return `org_session=${token}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/templates', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await request(app).post('/api/templates').send({ roleName: 'Backend Engineer' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a REVIEWER-role org_user', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookieFor('REVIEWER'))
      .send({ roleName: 'Backend Engineer', jobDescriptionText: 'JD' });

    expect(res.status).toBe(403);
    expect(prisma.interviewTemplate.create).not.toHaveBeenCalled();
  });

  it('returns 400 when roleName is missing', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookieFor('ADMIN'))
      .send({ jobDescriptionText: 'JD' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when neither jobDescriptionText nor a file is provided', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookieFor('ADMIN'))
      .send({ roleName: 'Backend Engineer' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for MANUAL mode with no manualQuestions', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookieFor('ADMIN'))
      .send({ roleName: 'Backend Engineer', jobDescriptionText: 'JD', questionMode: 'MANUAL' });

    expect(res.status).toBe(400);
    expect(prisma.interviewTemplate.create).not.toHaveBeenCalled();
  });

  it('creates an AI-mode template from pasted JD text', async () => {
    prisma.interviewTemplate.create.mockResolvedValue({
      id: 'tmpl_1',
      orgId: 'org_1',
      roleName: 'Backend Engineer',
      questionMode: 'AI',
    });

    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookieFor('ADMIN'))
      .send({ roleName: 'Backend Engineer', jobId: 'REQ-1', jobDescriptionText: 'JD text' });

    expect(res.status).toBe(201);
    expect(prisma.interviewTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: 'org_1',
          roleName: 'Backend Engineer',
          jobId: 'REQ-1',
          jobDescriptionText: 'JD text',
          questionMode: 'AI',
          createdByOrgUserId: 'orguser_1',
        }),
      })
    );
  });

  it('creates a MANUAL-mode template with a fixed question set', async () => {
    prisma.interviewTemplate.create.mockResolvedValue({ id: 'tmpl_1', questionMode: 'MANUAL' });

    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookieFor('ADMIN'))
      .field('roleName', 'Backend Engineer')
      .field('jobDescriptionText', 'JD text')
      .field('questionMode', 'MANUAL')
      .field('manualQuestions', JSON.stringify(['Q1', 'Q2']));

    expect(res.status).toBe(201);
    expect(prisma.interviewTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ questionMode: 'MANUAL', manualQuestions: ['Q1', 'Q2'] }),
      })
    );
  });

  it('extracts JD text from an uploaded file when no jobDescriptionText is given', async () => {
    resumeParserService.extractText.mockResolvedValue('Extracted JD text');
    prisma.interviewTemplate.create.mockResolvedValue({ id: 'tmpl_1' });

    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookieFor('ADMIN'))
      .field('roleName', 'Backend Engineer')
      .attach('jobDescriptionFile', Buffer.from('%PDF-1.4 fake'), 'jd.pdf');

    expect(res.status).toBe(201);
    expect(resumeParserService.extractText).toHaveBeenCalled();
    expect(prisma.interviewTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobDescriptionText: 'Extracted JD text' }) })
    );
  });
});

describe('POST /api/templates/:templateId/sessions (invite a candidate)', () => {
  it('returns 404 when the template does not exist', async () => {
    prisma.interviewTemplate.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/templates/tmpl_missing/sessions')
      .set('Cookie', cookieFor('ADMIN'))
      .send({ candidateName: 'Jane Doe', email: 'jane@example.com' });

    expect(res.status).toBe(404);
  });

  it('returns 402 when the organization has no credits remaining', async () => {
    prisma.interviewTemplate.findUnique.mockResolvedValue({ id: 'tmpl_1', orgId: 'org_1' });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org_1', creditBalance: 0 });

    const res = await request(app)
      .post('/api/templates/tmpl_1/sessions')
      .set('Cookie', cookieFor('ADMIN'))
      .send({ candidateName: 'Jane Doe', email: 'jane@example.com' });

    expect(res.status).toBe(402);
    expect(prisma.candidateSession.create).not.toHaveBeenCalled();
  });

  it('creates a session, deducts a credit, and returns an invite link', async () => {
    prisma.interviewTemplate.findUnique.mockResolvedValue({ id: 'tmpl_1', orgId: 'org_1' });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org_1', creditBalance: 5 });
    prisma.candidateSession.create.mockResolvedValue({
      id: 'sess_1',
      candidateName: 'Jane Doe',
      email: 'jane@example.com',
      status: 'INVITED',
      inviteToken: 'tok_abc123',
    });
    prisma.organization.updateMany.mockResolvedValue({ count: 1 });
    prisma.creditTransaction.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/templates/tmpl_1/sessions')
      .set('Cookie', cookieFor('ADMIN'))
      .send({ candidateName: 'Jane Doe', email: 'jane@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.session.inviteToken).toBe('tok_abc123');
    expect(res.body.inviteLink).toContain('tok_abc123');
    expect(prisma.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: 'sess_1', type: 'DEDUCTION' }) })
    );
  });
});

describe('POST /api/templates/:templateId/sessions/bulk (bulk invite)', () => {
  const url = '/api/templates/tmpl_1/sessions/bulk';

  it('returns 403 for a REVIEWER-role org_user', async () => {
    const res = await request(app)
      .post(url)
      .set('Cookie', cookieFor('REVIEWER'))
      .send({ candidates: [{ candidateName: 'A', email: 'a@example.com' }] });
    expect(res.status).toBe(403);
  });

  it('returns 400 with per-row errors and invites nobody when any row is invalid', async () => {
    const res = await request(app)
      .post(url)
      .set('Cookie', cookieFor('ADMIN'))
      .send({
        candidates: [
          { candidateName: 'A', email: 'a@example.com' },
          { candidateName: '', email: 'not-an-email' },
          { candidateName: 'C', email: 'A@example.com' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_rows');
    expect(res.body.rowErrors.map((e) => e.row)).toEqual([2, 2, 3]);
    expect(prisma.candidateSession.create).not.toHaveBeenCalled();
  });

  it('returns 400 when the batch exceeds the size cap', async () => {
    const candidates = Array.from({ length: 101 }, (_, i) => ({ candidateName: `C${i}`, email: `c${i}@example.com` }));
    const res = await request(app).post(url).set('Cookie', cookieFor('ADMIN')).send({ candidates });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('too_many_candidates');
  });

  it('returns 402 up front when the org has fewer credits than rows', async () => {
    prisma.interviewTemplate.findUnique.mockResolvedValue({ id: 'tmpl_1', orgId: 'org_1' });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org_1', creditBalance: 1 });

    const res = await request(app)
      .post(url)
      .set('Cookie', cookieFor('ADMIN'))
      .send({
        candidates: [
          { candidateName: 'A', email: 'a@example.com' },
          { candidateName: 'B', email: 'b@example.com' },
        ],
      });

    expect(res.status).toBe(402);
    expect(prisma.candidateSession.create).not.toHaveBeenCalled();
  });

  it('returns 402 when credits run out mid-transaction (whole batch rolls back)', async () => {
    prisma.interviewTemplate.findUnique.mockResolvedValue({ id: 'tmpl_1', orgId: 'org_1' });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org_1', creditBalance: 2 });
    prisma.candidateSession.create.mockImplementation(({ data }) => Promise.resolve({ id: `s_${data.email}`, ...data }));
    prisma.organization.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    prisma.creditTransaction.create.mockResolvedValue({});

    const res = await request(app)
      .post(url)
      .set('Cookie', cookieFor('ADMIN'))
      .send({
        candidates: [
          { candidateName: 'A', email: 'a@example.com' },
          { candidateName: 'B', email: 'b@example.com' },
        ],
      });

    expect(res.status).toBe(402);
  });

  it('invites every candidate, deducting one credit each, and returns all invite links', async () => {
    prisma.interviewTemplate.findUnique.mockResolvedValue({ id: 'tmpl_1', orgId: 'org_1' });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org_1', creditBalance: 5 });
    prisma.candidateSession.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `s_${data.email}`, status: 'INVITED', ...data })
    );
    prisma.organization.updateMany.mockResolvedValue({ count: 1 });
    prisma.creditTransaction.create.mockResolvedValue({});

    const res = await request(app)
      .post(url)
      .set('Cookie', cookieFor('ADMIN'))
      .send({
        candidates: [
          { candidateName: ' A ', email: 'A@Example.com' },
          { candidateName: 'B', email: 'b@example.com' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.invites).toHaveLength(2);
    expect(res.body.invites[0].session.email).toBe('a@example.com');
    expect(res.body.invites[0].session.candidateName).toBe('A');
    expect(res.body.invites[0].inviteLink).toContain('/invite/');
    expect(prisma.creditTransaction.create).toHaveBeenCalledTimes(2);
  });
});
