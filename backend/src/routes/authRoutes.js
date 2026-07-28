const express = require('express');
const prisma = require('../db/prismaClient');
const config = require('../config');
const authService = require('../services/authService');
const emailService = require('../services/emailService');
const { requireOrgAuth } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Request a login OTP for an existing org_user. Org_users are provisioned
// by ops (see /api/admin routes) — there is no self-serve sign-up.
router.post('/request-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'invalid_request', message: 'email is required' });
    }

    const orgUser = await prisma.orgUser.findUnique({ where: { email } });
    if (!orgUser) {
      return res.status(404).json({ error: 'org_user_not_found' });
    }

    const code = authService.generateOtpCode();
    const codeHash = await authService.hashOtpCode(code);

    await prisma.loginOtp.create({
      data: {
        orgUserId: orgUser.id,
        codeHash,
        expiresAt: new Date(Date.now() + config.otpTtlMinutes * 60 * 1000),
      },
    });

    await emailService.sendOtpEmail(orgUser.email, code);

    res.status(200).json({ message: 'OTP sent' });
  } catch (err) {
    next(err);
  }
});

// Verify an OTP and start a session (JWT in an httpOnly cookie).
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'invalid_request', message: 'email and code are required' });
    }

    const orgUser = await prisma.orgUser.findUnique({ where: { email } });
    if (!orgUser) {
      return res.status(404).json({ error: 'org_user_not_found' });
    }

    const otp = await prisma.loginOtp.findFirst({
      where: { orgUserId: orgUser.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.expiresAt < new Date()) {
      return res.status(401).json({ error: 'otp_expired_or_invalid' });
    }

    const matches = await authService.verifyOtpCode(code, otp.codeHash);
    if (!matches) {
      return res.status(401).json({ error: 'otp_expired_or_invalid' });
    }

    await prisma.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const token = authService.signSessionToken(orgUser);
    res.cookie(config.sessionCookieName, token, COOKIE_OPTIONS);

    res.status(200).json({
      orgUser: { id: orgUser.id, email: orgUser.email, orgId: orgUser.orgId, role: orgUser.role },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(config.sessionCookieName, COOKIE_OPTIONS);
  res.status(200).json({ message: 'Logged out' });
});

// Current session + org info (credit balance) for the dashboard header.
router.get('/me', requireOrgAuth, async (req, res, next) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: req.orgUser.orgId } });
    if (!organization) {
      return res.status(404).json({ error: 'organization_not_found' });
    }

    res.status(200).json({
      orgUser: { id: req.orgUser.orgUserId, email: req.orgUser.email, role: req.orgUser.role },
      organization: { id: organization.id, name: organization.name, creditBalance: organization.creditBalance },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
