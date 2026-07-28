jest.mock('../src/db/prismaClient', () => ({
  orgUser: { findUnique: jest.fn() },
  loginOtp: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  organization: { findUnique: jest.fn() },
}));

jest.mock('../src/services/emailService', () => ({
  sendOtpEmail: jest.fn(),
}));

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const emailService = require('../src/services/emailService');
const authService = require('../src/services/authService');
const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/request-otp', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/auth/request-otp').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when no org_user has that email', async () => {
    prisma.orgUser.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/request-otp').send({ email: 'nobody@acme.com' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('org_user_not_found');
    expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('creates an OTP record and emails the code', async () => {
    prisma.orgUser.findUnique.mockResolvedValue({ id: 'orguser_1', email: 'reviewer@acme.com' });
    prisma.loginOtp.create.mockResolvedValue({});

    const res = await request(app).post('/api/auth/request-otp').send({ email: 'reviewer@acme.com' });

    expect(res.status).toBe(200);
    expect(prisma.loginOtp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgUserId: 'orguser_1' }) })
    );
    expect(emailService.sendOtpEmail).toHaveBeenCalledWith('reviewer@acme.com', expect.any(String));
  });
});

describe('POST /api/auth/verify-otp', () => {
  it('returns 401 when there is no matching unconsumed OTP', async () => {
    prisma.orgUser.findUnique.mockResolvedValue({ id: 'orguser_1', email: 'reviewer@acme.com' });
    prisma.loginOtp.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'reviewer@acme.com', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('otp_expired_or_invalid');
  });

  it('returns 401 when the OTP has expired', async () => {
    prisma.orgUser.findUnique.mockResolvedValue({ id: 'orguser_1', email: 'reviewer@acme.com' });
    prisma.loginOtp.findFirst.mockResolvedValue({
      id: 'otp_1',
      codeHash: await authService.hashOtpCode('123456'),
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'reviewer@acme.com', code: '123456' });

    expect(res.status).toBe(401);
  });

  it('returns 401 when the code does not match', async () => {
    prisma.orgUser.findUnique.mockResolvedValue({ id: 'orguser_1', email: 'reviewer@acme.com' });
    prisma.loginOtp.findFirst.mockResolvedValue({
      id: 'otp_1',
      codeHash: await authService.hashOtpCode('123456'),
      expiresAt: new Date(Date.now() + 60000),
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'reviewer@acme.com', code: '000000' });

    expect(res.status).toBe(401);
    expect(prisma.loginOtp.update).not.toHaveBeenCalled();
  });

  it('sets a session cookie and consumes the OTP on a correct code', async () => {
    prisma.orgUser.findUnique.mockResolvedValue({
      id: 'orguser_1',
      email: 'reviewer@acme.com',
      orgId: 'org_1',
      role: 'REVIEWER',
    });
    prisma.loginOtp.findFirst.mockResolvedValue({
      id: 'otp_1',
      codeHash: await authService.hashOtpCode('123456'),
      expiresAt: new Date(Date.now() + 60000),
    });
    prisma.loginOtp.update.mockResolvedValue({});

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'reviewer@acme.com', code: '123456' });

    expect(res.status).toBe(200);
    expect(prisma.loginOtp.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'otp_1' } })
    );
    expect(res.headers['set-cookie'][0]).toMatch(/^org_session=/);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it("returns the org user and organization when logged in", async () => {
    const token = authService.signSessionToken({
      id: 'orguser_1',
      orgId: 'org_1',
      role: 'REVIEWER',
      email: 'reviewer@acme.com',
    });
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org_1',
      name: 'Acme Corp',
      creditBalance: 5,
    });

    const res = await request(app).get('/api/auth/me').set('Cookie', `org_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.organization).toEqual({ id: 'org_1', name: 'Acme Corp', creditBalance: 5 });
    expect(res.body.orgUser.email).toBe('reviewer@acme.com');
  });
});
