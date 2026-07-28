const express = require('express');
const prisma = require('../db/prismaClient');
const { requireOpsKey } = require('../middleware/auth');
const creditService = require('../services/creditService');

const router = express.Router();

router.use(requireOpsKey);

// Provision a new client organization. Ops-only — no self-serve org
// creation in this phase.
router.post('/organizations', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'invalid_request', message: 'name is required' });
    }

    const organization = await prisma.organization.create({ data: { name } });
    res.status(201).json({ organization });
  } catch (err) {
    next(err);
  }
});

// Invite an org_user (admin/reviewer) into an existing organization.
// Ops-only — org_users cannot self-register.
router.post('/organizations/:orgId/users', async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'invalid_request', message: 'email is required' });
    }
    if (role && role !== 'ADMIN' && role !== 'REVIEWER') {
      return res.status(400).json({ error: 'invalid_request', message: 'role must be ADMIN or REVIEWER' });
    }

    const organization = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!organization) {
      return res.status(404).json({ error: 'organization_not_found' });
    }

    const orgUser = await prisma.orgUser.create({
      data: { email, orgId, role: role || 'REVIEWER' },
    });
    res.status(201).json({ orgUser });
  } catch (err) {
    next(err);
  }
});

// Manually grant credits to an organization. This is the only way credits
// enter the ledger in this phase — no payment gateway/checkout flow (parked
// for later, see TODO.md).
router.post('/organizations/:orgId/credits/grant', async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { amount, addedBy } = req.body;

    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({ error: 'invalid_request', message: 'amount must be a positive integer' });
    }
    if (!addedBy) {
      return res.status(400).json({ error: 'invalid_request', message: 'addedBy is required' });
    }

    const organization = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!organization) {
      return res.status(404).json({ error: 'organization_not_found' });
    }

    const updated = await creditService.grantCredits(orgId, amount, addedBy);
    res.status(201).json({ organization: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
