const express = require('express');
const prisma = require('../db/prismaClient');
const { logAuditEvent } = require('../services/auditLogService');

const router = express.Router();

// DPDP: this is the only path that may record consent. No interview can be
// created for a candidate until a record exists here — enforced in
// interviewRoutes via consentService.hasValidConsent.
router.post('/', async (req, res, next) => {
  try {
    const { email, fullName, phone, consentType, consentTextVersion, ipAddress } = req.body;

    if (!email || !fullName || !consentType || !consentTextVersion) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'email, fullName, consentType, and consentTextVersion are required',
      });
    }

    const candidate = await prisma.candidate.upsert({
      where: { email },
      update: { fullName, phone },
      create: { email, fullName, phone },
    });

    const consentRecord = await prisma.consentRecord.create({
      data: {
        candidateId: candidate.id,
        consentType,
        consentTextVersion,
        consentGivenAt: new Date(),
        ipAddress: ipAddress || req.ip,
      },
    });

    await logAuditEvent({
      actorType: 'candidate',
      actorId: candidate.id,
      action: 'consent_recorded',
      entityType: 'consent_record',
      entityId: consentRecord.id,
      purpose: 'DPDP consent capture prior to interview',
    });

    res.status(201).json({ candidate, consentRecord });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
