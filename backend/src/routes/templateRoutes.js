const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { requireOrgAuth, requireOrgRole } = require('../middleware/auth');
const resumeParserService = require('../services/resumeParserService');
const creditService = require('../services/creditService');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Create an interview template (role + JD + question mode). Org ADMIN only —
// this is the "Create Interview" admin page's backing endpoint, a real gap
// in Phase 1-4.5 (no such flow existed before). See docs/DECISIONS.md.
router.post('/', requireOrgAuth, requireOrgRole('ADMIN'), upload.single('jobDescriptionFile'), async (req, res, next) => {
  try {
    const { roleName, jobId, jobDescriptionText, questionMode } = req.body;
    const normalizedMode = questionMode === 'MANUAL' ? 'MANUAL' : 'AI';

    if (!roleName) {
      return res.status(400).json({ error: 'invalid_request', message: 'roleName is required' });
    }

    let resolvedJdText = jobDescriptionText;
    if (!resolvedJdText && req.file) {
      try {
        resolvedJdText = await resumeParserService.extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
      } catch (err) {
        if (err instanceof resumeParserService.UnsupportedFileTypeError) {
          return res.status(400).json({ error: 'unsupported_file_type', message: err.message });
        }
        throw err;
      }
    }
    if (!resolvedJdText) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'jobDescriptionText or a jobDescriptionFile (PDF/DOCX) is required',
      });
    }

    let manualQuestions = null;
    if (normalizedMode === 'MANUAL') {
      const raw = req.body.manualQuestions;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((q) => typeof q === 'string' && q.trim())) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'manualQuestions must be a non-empty array of question strings when questionMode is MANUAL',
        });
      }
      manualQuestions = parsed;
    }

    const template = await prisma.interviewTemplate.create({
      data: {
        orgId: req.orgUser.orgId,
        roleName,
        jobId: jobId || null,
        jobDescriptionText: resolvedJdText,
        questionMode: normalizedMode,
        manualQuestions,
        createdByOrgUserId: req.orgUser.orgUserId,
      },
    });

    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
});

// Invite one candidate to a template — creates the candidate_session and
// deducts exactly 1 credit (moved here from template creation in Phase 4.6;
// a template with zero candidates shouldn't consume credits). Single-
// candidate only: bulk invite is Phase 4.7, not built here — see
// docs/DECISIONS.md for why this minimal endpoint exists at all.
router.post('/:templateId/sessions', requireOrgAuth, requireOrgRole('ADMIN'), async (req, res, next) => {
  try {
    const { templateId } = req.params;
    const { candidateName, email } = req.body;

    if (!candidateName || !email) {
      return res.status(400).json({ error: 'invalid_request', message: 'candidateName and email are required' });
    }

    const template = await prisma.interviewTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.orgId !== req.orgUser.orgId) {
      return res.status(404).json({ error: 'template_not_found' });
    }

    const organization = await prisma.organization.findUnique({ where: { id: req.orgUser.orgId } });
    if (organization.creditBalance <= 0) {
      return res.status(402).json({ error: 'insufficient_credits', message: 'Organization has no credits remaining' });
    }

    const inviteToken = crypto.randomBytes(24).toString('base64url');

    let session;
    try {
      session = await prisma.$transaction(async (tx) => {
        const created = await tx.candidateSession.create({
          data: {
            templateId: template.id,
            orgId: template.orgId,
            candidateName,
            email,
            inviteToken,
          },
        });

        await creditService.deductCreditForSession(tx, template.orgId, created.id);

        return created;
      });
    } catch (err) {
      if (err instanceof creditService.InsufficientCreditsError) {
        return res.status(402).json({ error: 'insufficient_credits', message: 'Organization has no credits remaining' });
      }
      throw err;
    }

    res.status(201).json({
      session: {
        id: session.id,
        candidateName: session.candidateName,
        email: session.email,
        status: session.status,
        inviteToken: session.inviteToken,
      },
      inviteLink: `${config.frontendUrl}/invite/${session.inviteToken}`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
