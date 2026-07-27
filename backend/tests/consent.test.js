jest.mock('../src/db/prismaClient', () => ({
  candidate: { upsert: jest.fn() },
  consentRecord: { create: jest.fn(), findMany: jest.fn() },
  auditLog: { create: jest.fn() },
}));

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const app = require('../src/app');

describe('POST /api/consent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/consent').send({});
    expect(res.status).toBe(400);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it('creates/updates the candidate and records consent + an audit log entry', async () => {
    prisma.candidate.upsert.mockResolvedValue({
      id: 'cand_1',
      email: 'a@b.com',
      fullName: 'A B',
    });
    prisma.consentRecord.create.mockResolvedValue({
      id: 'consent_1',
      candidateId: 'cand_1',
      consentType: 'data_processing',
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app).post('/api/consent').send({
      email: 'a@b.com',
      fullName: 'A B',
      consentType: 'data_processing',
      consentTextVersion: 'v1',
    });

    expect(res.status).toBe(201);
    expect(res.body.candidate.id).toBe('cand_1');
    expect(res.body.consentRecord.id).toBe('consent_1');
    expect(prisma.consentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ candidateId: 'cand_1', consentType: 'data_processing' }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'consent_recorded', entityType: 'consent_record' }),
      })
    );
  });
});
