process.env.OPS_API_KEY = 'test-ops-key';

jest.mock('../src/db/prismaClient', () => {
  const prisma = {
    organization: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    orgUser: { create: jest.fn() },
    creditTransaction: { create: jest.fn() },
    $transaction: jest.fn((cb) => cb(prisma)),
  };
  return prisma;
});

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ops auth', () => {
  it('rejects admin routes without a valid x-ops-key', async () => {
    const res = await request(app).post('/api/admin/organizations').send({ name: 'Acme' });
    expect(res.status).toBe(401);
  });

  it('rejects admin routes with the wrong x-ops-key', async () => {
    const res = await request(app)
      .post('/api/admin/organizations')
      .set('x-ops-key', 'wrong-key')
      .send({ name: 'Acme' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/organizations', () => {
  it('creates an organization', async () => {
    prisma.organization.create.mockResolvedValue({ id: 'org_1', name: 'Acme', creditBalance: 0 });

    const res = await request(app)
      .post('/api/admin/organizations')
      .set('x-ops-key', 'test-ops-key')
      .send({ name: 'Acme' });

    expect(res.status).toBe(201);
    expect(res.body.organization.id).toBe('org_1');
  });
});

describe('POST /api/admin/organizations/:orgId/users', () => {
  it('returns 404 when the organization does not exist', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/admin/organizations/org_missing/users')
      .set('x-ops-key', 'test-ops-key')
      .send({ email: 'reviewer@acme.com' });

    expect(res.status).toBe(404);
  });

  it('invites an org_user with a default REVIEWER role', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org_1', name: 'Acme' });
    prisma.orgUser.create.mockResolvedValue({
      id: 'orguser_1',
      email: 'reviewer@acme.com',
      orgId: 'org_1',
      role: 'REVIEWER',
    });

    const res = await request(app)
      .post('/api/admin/organizations/org_1/users')
      .set('x-ops-key', 'test-ops-key')
      .send({ email: 'reviewer@acme.com' });

    expect(res.status).toBe(201);
    expect(prisma.orgUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'REVIEWER' }) })
    );
  });
});

describe('POST /api/admin/organizations/:orgId/credits/grant', () => {
  it('returns 400 for a non-positive amount', async () => {
    const res = await request(app)
      .post('/api/admin/organizations/org_1/credits/grant')
      .set('x-ops-key', 'test-ops-key')
      .send({ amount: 0, addedBy: 'ops@company.com' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the organization does not exist', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/admin/organizations/org_missing/credits/grant')
      .set('x-ops-key', 'test-ops-key')
      .send({ amount: 10, addedBy: 'ops@company.com' });

    expect(res.status).toBe(404);
  });

  it('grants credits and records a GRANT transaction', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org_1', name: 'Acme', creditBalance: 5 });
    prisma.organization.update.mockResolvedValue({ id: 'org_1', name: 'Acme', creditBalance: 15 });
    prisma.creditTransaction.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/admin/organizations/org_1/credits/grant')
      .set('x-ops-key', 'test-ops-key')
      .send({ amount: 10, addedBy: 'ops@company.com' });

    expect(res.status).toBe(201);
    expect(res.body.organization.creditBalance).toBe(15);
    expect(prisma.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: 'org_1', amount: 10, type: 'GRANT', addedBy: 'ops@company.com' }),
      })
    );
  });
});
