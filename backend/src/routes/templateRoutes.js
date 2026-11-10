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

// Phase 4.7 bulk invite cap — pilot scale is 50-100 interviews total, so a
// single batch larger than this is almost certainly a mistake (wrong file
// pasted) rather than a real need. See docs/DECISIONS.md.
const MAX_BULK_INVITES = 100;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Creates one candidate_session and deducts its credit inside the caller's
// transaction. Shared by the single and bulk invite endpoints so both use
// the exact same atomic credit-deduction path.
async function createInvitedSession(tx, template, { candidateName, email }) {
  const created = await tx.candidateSession.create({
    data: {
      templateId: template.id,
      orgId: template.orgId,
      candidateName,
      email,
      inviteToken: crypto.randomBytes(24).toString('base64url'),
    },
  });

  await creditService.deductCreditForSession(tx, template.orgId, created.id);

  return created;
}

function toInviteResponse(session) {
  return {
    session: {
      id: session.id,
      candidateName: session.candidateName,
      email: session.email,
      status: session.status,
      inviteToken: session.inviteToken,
    },
    inviteLink: `${config.frontendUrl}/invite/${session.inviteToken}`,
  };
}

async function findOrgTemplate(templateId, orgId) {
  const template = await prisma.interviewTemplate.findUnique({ where: { id: templateId } });
  return template && template.orgId === orgId ? template : null;
}

// Invite one candidate to a template — creates the candidate_session and
// deducts exactly 1 credit (moved here from template creation in Phase 4.6;
// a template with zero candidates shouldn't consume credits).
router.post('/:templateId/sessions', requireOrgAuth, requireOrgRole('ADMIN'), async (req, res, next) => {
  try {
    const { candidateName, email } = req.body;

    if (!candidateName || !email) {
      return res.status(400).json({ error: 'invalid_request', message: 'candidateName and email are required' });
    }

    const template = await findOrgTemplate(req.params.templateId, req.orgUser.orgId);
    if (!template) {
      return res.status(404).json({ error: 'template_not_found' });
    }

    const organization = await prisma.organization.findUnique({ where: { id: req.orgUser.orgId } });
    if (organization.creditBalance <= 0) {
      return res.status(402).json({ error: 'insufficient_credits', message: 'Organization has no credits remaining' });
    }

    let session;
    try {
      session = await prisma.$transaction((tx) => createInvitedSession(tx, template, { candidateName, email }));
    } catch (err) {
      if (err instanceof creditService.InsufficientCreditsError) {
        return res.status(402).json({ error: 'insufficient_credits', message: 'Organization has no credits remaining' });
      }
      throw err;
    }

    res.status(201).json(toInviteResponse(session));
  } catch (err) {
    next(err);
  }
});

// Phase 4.7: invite many candidates against one template at once. The
// frontend parses pasted/CSV rows into JSON; this endpoint validates every
// row up front and then creates all sessions in ONE transaction — either
// every candidate is invited (and charged 1 credit each) or none are. See
// docs/DECISIONS.md for why all-or-nothing rather than partial success.
router.post('/:templateId/sessions/bulk', requireOrgAuth, requireOrgRole('ADMIN'), async (req, res, next) => {
  try {
    const { candidates } = req.body;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'candidates must be a non-empty array' });
    }
    if (candidates.length > MAX_BULK_INVITES) {
      return res.status(400).json({
        error: 'too_many_candidates',
        message: `At most ${MAX_BULK_INVITES} candidates can be invited in one batch`,
      });
    }

    const rowErrors = [];
    const seenEmails = new Set();
    const normalized = candidates.map((row, index) => {
      const candidateName = row && typeof row.candidateName === 'string' ? row.candidateName.trim() : '';
      const email = row && typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
      if (!candidateName) rowErrors.push({ row: index + 1, message: 'candidateName is required' });
      if (!EMAIL_PATTERN.test(email)) {
        rowErrors.push({ row: index + 1, message: 'a valid email is required' });
      } else if (seenEmails.has(email)) {
        rowErrors.push({ row: index + 1, message: `duplicate email ${email} in this batch` });
      }
      seenEmails.add(email);
      return { candidateName, email };
    });

    if (rowErrors.length > 0) {
      return res.status(400).json({ error: 'invalid_rows', message: 'Some rows are invalid; nothing was invited', rowErrors });
    }

    const template = await findOrgTemplate(req.params.templateId, req.orgUser.orgId);
    if (!template) {
      return res.status(404).json({ error: 'template_not_found' });
    }

    const organization = await prisma.organization.findUnique({ where: { id: req.orgUser.orgId } });
    if (organization.creditBalance < normalized.length) {
      return res.status(402).json({
        error: 'insufficient_credits',
        message: `This batch needs ${normalized.length} credits; the organization has ${organization.creditBalance}`,
      });
    }

    let sessions;
    try {
      sessions = await prisma.$transaction(async (tx) => {
        const created = [];
        for (const row of normalized) {
          created.push(await createInvitedSession(tx, template, row));
        }
        return created;
      }, { timeout: 30000 });
    } catch (err) {
      if (err instanceof creditService.InsufficientCreditsError) {
        return res.status(402).json({
          error: 'insufficient_credits',
          message: 'Organization ran out of credits during the batch; nothing was invited',
        });
      }
      throw err;
    }

    res.status(201).json({ invites: sessions.map(toInviteResponse) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
