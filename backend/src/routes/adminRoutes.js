const express = require('express');
const prisma = require('../db/prismaClient');
const { requireOpsKey } = require('../middleware/auth');
const creditService = require('../services/creditService');
const retentionService = require('../services/retentionService');
const { logAuditEvent } = require('../services/auditLogService');

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

// Phase 7 / DPDP: run the data-retention job now. Same code path as
// `npm run retention` (scheduled via the host's cron). `dryRun: true` lists
// what would be anonymized without changing anything.
router.post('/retention/run', async (req, res, next) => {
  try {
    const result = await retentionService.runRetention({ dryRun: req.body.dryRun === true });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Phase 7 / DPDP: everything the audit log holds about one candidate, for
// answering a candidate's or regulator's request. Look up by email (before
// anonymization), candidateId, or sessionId.
router.get('/audit-log', async (req, res, next) => {
  try {
    const { email, candidateId, sessionId } = req.query;
    if (!email && !candidateId && !sessionId) {
      return res.status(400).json({ error: 'invalid_request', message: 'email, candidateId, or sessionId is required' });
    }

    let candidate = null;
    if (candidateId) candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    else if (email) candidate = await prisma.candidate.findUnique({ where: { email } });

    const sessionWhere = sessionId ? { id: sessionId } : email ? { email } : null;
    const sessions = sessionWhere
      ? await prisma.candidateSession.findMany({
          where: sessionWhere,
          select: {
            id: true,
            email: true,
            evaluations: { select: { id: true } },
            humanReviewRequests: { select: { id: true } },
          },
        })
      : [];

    if (!candidate && sessions.length === 0) {
      return res.status(404).json({ error: 'candidate_not_found' });
    }
    if (!candidate && sessions[0] && !sessions[0].email.startsWith('anonymized+')) {
      candidate = await prisma.candidate.findUnique({ where: { email: sessions[0].email } });
    }

    const consentRecords = candidate
      ? await prisma.consentRecord.findMany({ where: { candidateId: candidate.id }, select: { id: true } })
      : [];

    const entityIds = [
      ...sessions.flatMap((s) => [s.id, ...s.evaluations.map((e) => e.id), ...s.humanReviewRequests.map((r) => r.id)]),
      ...consentRecords.map((c) => c.id),
    ];
    const or = [{ entityId: { in: entityIds } }];
    if (candidate) or.push({ actorId: candidate.id });

    const entries = await prisma.auditLog.findMany({ where: { OR: or }, orderBy: { createdAt: 'asc' } });

    await logAuditEvent({
      actorType: 'ops',
      action: 'audit_log_queried',
      entityType: candidate ? 'candidate' : 'candidate_session',
      entityId: candidate ? candidate.id : sessions[0].id,
      outputRef: `entries:${entries.length}`,
      purpose: 'DPDP: audit trail lookup for a specific candidate',
    });

    res.status(200).json({
      candidateId: candidate ? candidate.id : null,
      sessionIds: sessions.map((s) => s.id),
      entries,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
