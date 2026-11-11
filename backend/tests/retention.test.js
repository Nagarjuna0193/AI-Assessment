process.env.OPS_API_KEY = 'test-ops-key';

jest.mock('../src/db/prismaClient', () => {
  const prisma = {
    candidateSession: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    candidate: { findUnique: jest.fn(), update: jest.fn() },
    consentRecord: { updateMany: jest.fn(), findMany: jest.fn() },
    response: { updateMany: jest.fn() },
    question: { updateMany: jest.fn() },
    evaluation: { update: jest.fn() },
    humanReviewRequest: { updateMany: jest.fn() },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return prisma;
});

jest.mock('../src/services/storageService', () => ({
  uploadResumeFile: jest.fn(),
  deleteResumeFile: jest.fn(),
}));

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const storageService = require('../src/services/storageService');
const retentionService = require('../src/services/retentionService');
const app = require('../src/app');

function liveSession(overrides = {}) {
  return {
    id: 'sess_1',
    email: 'jane@example.com',
    candidateName: 'Jane Doe',
    status: 'COMPLETED',
    resumeFileRef: 'local://uploads/resumes/sess_1/cv.pdf',
    anonymizedAt: null,
    evaluations: [
      {
        id: 'eval_1',
        scorecard: [{ criterion: 'Node.js', score: 4, evidence: 'I built X at Acme', notes: 'n', questionNumbers: [1] }],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.candidateSession.update.mockResolvedValue({});
  prisma.candidate.update.mockResolvedValue({});
  storageService.deleteResumeFile.mockResolvedValue();
});

describe('retentionService.anonymizeSession', () => {
  it('removes personal data from the session and its children, keeping scores', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(liveSession());
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.candidateSession.count.mockResolvedValue(0);

    const result = await retentionService.anonymizeSession('sess_1', {
      actorType: 'system',
      reason: 'retention_expired',
    });

    expect(result).toEqual({ sessionId: 'sess_1', candidateAnonymized: true });
    expect(storageService.deleteResumeFile).toHaveBeenCalledWith('local://uploads/resumes/sess_1/cv.pdf');
    expect(prisma.response.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess_1' },
      data: { responseText: '[removed]', responseAudioUrl: null },
    });
    expect(prisma.question.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess_1' },
      data: { questionText: '[removed]' },
    });
    const evalUpdate = prisma.evaluation.update.mock.calls[0][0];
    expect(evalUpdate.data.scorecard).toEqual([{ criterion: 'Node.js', score: 4 }]);
    expect(evalUpdate.data.summaryText).toBeNull();
    expect(evalUpdate.data).not.toHaveProperty('overallScore');

    const sessionUpdate = prisma.candidateSession.update.mock.calls[0][0].data;
    expect(sessionUpdate).toEqual(
      expect.objectContaining({
        candidateName: '[removed]',
        email: 'anonymized+sess_1@invalid.local',
        resumeText: null,
        resumeFileRef: null,
        resumeJdRationale: null,
        anonymizedAt: expect.any(Date),
      })
    );
    // Completed sessions keep their status.
    expect(sessionUpdate).not.toHaveProperty('status');

    expect(prisma.candidate.update).toHaveBeenCalledWith({
      where: { id: 'cand_1' },
      data: expect.objectContaining({ fullName: '[removed]', email: 'anonymized+cand_1@invalid.local', phone: null }),
    });
    expect(prisma.consentRecord.updateMany).toHaveBeenCalledWith({
      where: { candidateId: 'cand_1', consentWithdrawnAt: null },
      data: { consentWithdrawnAt: expect.any(Date) },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'system',
        action: 'data_anonymized',
        entityType: 'candidate_session',
        entityId: 'sess_1',
      }),
    });
  });

  it('cancels an in-progress session', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(liveSession({ status: 'IN_PROGRESS', evaluations: [] }));
    prisma.candidate.findUnique.mockResolvedValue(null);

    await retentionService.anonymizeSession('sess_1', { actorType: 'candidate', reason: 'candidate_erasure_request' });

    expect(prisma.candidateSession.update.mock.calls[0][0].data.status).toBe('CANCELLED');
  });

  it("keeps the candidate row and consents when they have another live session", async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(liveSession());
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.candidateSession.count.mockResolvedValue(1);

    const result = await retentionService.anonymizeSession('sess_1', {
      actorType: 'candidate',
      reason: 'candidate_erasure_request',
    });

    expect(result.candidateAnonymized).toBe(false);
    expect(prisma.candidate.update).not.toHaveBeenCalled();
    expect(prisma.consentRecord.updateMany).not.toHaveBeenCalled();
  });

  it('changes nothing if the resume file cannot be deleted', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(liveSession());
    storageService.deleteResumeFile.mockRejectedValue(new Error('storage down'));

    await expect(
      retentionService.anonymizeSession('sess_1', { actorType: 'system', reason: 'retention_expired' })
    ).rejects.toThrow('storage down');
    expect(prisma.candidateSession.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to anonymize twice', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(liveSession({ anonymizedAt: new Date() }));
    await expect(
      retentionService.anonymizeSession('sess_1', { actorType: 'system', reason: 'retention_expired' })
    ).rejects.toBeInstanceOf(retentionService.AlreadyAnonymizedError);
  });
});

describe('retentionService.runRetention', () => {
  it('anonymizes expired sessions, holds ones with an open review, and reports failures', async () => {
    prisma.candidateSession.findMany.mockResolvedValue([
      { id: 'sess_ok', humanReviewRequests: [] },
      { id: 'sess_held', humanReviewRequests: [{ id: 'rr_1' }] },
      { id: 'sess_bad', humanReviewRequests: [] },
    ]);
    prisma.candidate.findUnique.mockResolvedValue(null);
    storageService.deleteResumeFile.mockImplementation((ref) =>
      ref && ref.includes('sess_bad') ? Promise.reject(new Error('storage down')) : Promise.resolve()
    );
    prisma.candidateSession.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(liveSession({ id: where.id, evaluations: [], resumeFileRef: `local://${where.id}` }))
    );

    const result = await retentionService.runRetention();

    expect(result.anonymized).toEqual(['sess_ok']);
    expect(result.held).toEqual(['sess_held']);
    expect(result.failed).toEqual([{ sessionId: 'sess_bad', error: 'storage down' }]);
  });

  it('dry run changes nothing', async () => {
    prisma.candidateSession.findMany.mockResolvedValue([{ id: 'sess_ok', humanReviewRequests: [] }]);

    const result = await retentionService.runRetention({ dryRun: true });

    expect(result).toEqual({ anonymized: ['sess_ok'], held: [], failed: [], dryRun: true });
    expect(prisma.candidateSession.update).not.toHaveBeenCalled();
  });

  it('queries by stored retention date with a completedAt/createdAt fallback', async () => {
    prisma.candidateSession.findMany.mockResolvedValue([]);
    const now = new Date('2027-06-01T00:00:00Z');

    await retentionService.findExpiredSessions(now);

    const { where } = prisma.candidateSession.findMany.mock.calls[0][0];
    expect(where.anonymizedAt).toBeNull();
    const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    expect(where.OR).toEqual([
      { dataRetentionUntil: { lte: now } },
      { dataRetentionUntil: null, completedAt: { lte: cutoff } },
      { dataRetentionUntil: null, completedAt: null, createdAt: { lte: cutoff } },
    ]);
  });
});

describe('POST /api/admin/retention/run', () => {
  it('requires the ops key', async () => {
    const res = await request(app).post('/api/admin/retention/run').send({});
    expect(res.status).toBe(401);
  });

  it('runs the job and returns the result', async () => {
    prisma.candidateSession.findMany.mockResolvedValue([]);
    const res = await request(app).post('/api/admin/retention/run').set('x-ops-key', 'test-ops-key').send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ anonymized: [], held: [], failed: [], dryRun: true });
  });
});

describe('GET /api/admin/audit-log', () => {
  it('returns 400 without a lookup key', async () => {
    const res = await request(app).get('/api/admin/audit-log').set('x-ops-key', 'test-ops-key');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown candidate', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    prisma.candidateSession.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/admin/audit-log?email=nobody@example.com').set('x-ops-key', 'test-ops-key');
    expect(res.status).toBe(404);
  });

  it("collects entries for the candidate's sessions, evaluations, reviews and consents, and logs the lookup", async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.candidateSession.findMany.mockResolvedValue([
      { id: 'sess_1', email: 'jane@example.com', evaluations: [{ id: 'eval_1' }], humanReviewRequests: [{ id: 'rr_1' }] },
    ]);
    prisma.consentRecord.findMany.mockResolvedValue([{ id: 'consent_1' }]);
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'a1', action: 'consent_recorded' }]);

    const res = await request(app).get('/api/admin/audit-log?email=jane@example.com').set('x-ops-key', 'test-ops-key');

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { entityId: { in: ['sess_1', 'eval_1', 'rr_1', 'consent_1'] } },
          { actorId: 'cand_1' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorType: 'ops', action: 'audit_log_queried', entityId: 'cand_1' }),
    });
  });
});
