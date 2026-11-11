const { Prisma } = require('@prisma/client');
const prisma = require('../db/prismaClient');
const config = require('../config');
const storageService = require('./storageService');
const { logAuditEvent } = require('./auditLogService');

// Phase 7 / DPDP data retention and erasure. Personal data is anonymized,
// not hard-deleted: identifying text is replaced or cleared, while scores,
// the credit ledger, consent timestamps and the audit log stay (with no
// personal identifiers) so pilot statistics and the audit trail survive.
// See docs/COMPLIANCE.md ("Data retention & erasure") and docs/DECISIONS.md.

const REMOVED = '[removed]';
const DAY_MS = 24 * 60 * 60 * 1000;

function retentionUntilFrom(date) {
  return new Date(date.getTime() + config.dataRetentionDays * DAY_MS);
}

function anonymizedEmail(id) {
  return `anonymized+${id}@invalid.local`;
}

// Keep the criterion name and score (useful for aggregate pilot stats);
// drop evidence/notes, which quote or paraphrase the candidate.
function stripScorecard(scorecard) {
  if (!Array.isArray(scorecard)) return scorecard;
  return scorecard.map((row) => ({ criterion: row.criterion, score: row.score }));
}

class SessionNotFoundError extends Error {}
class AlreadyAnonymizedError extends Error {}

// Anonymizes one candidate_session and everything hanging off it. If this
// was the candidate's last non-anonymized session, the candidates row is
// anonymized too and their consents are marked withdrawn.
//
// `actor` is { actorType, actorId } for the audit entry; `reason` is
// "retention_expired" or "candidate_erasure_request".
async function anonymizeSession(sessionId, { actorType, actorId = null, reason }) {
  const session = await prisma.candidateSession.findUnique({
    where: { id: sessionId },
    include: { evaluations: { select: { id: true, scorecard: true } } },
  });
  if (!session) throw new SessionNotFoundError(sessionId);
  if (session.anonymizedAt) throw new AlreadyAnonymizedError(sessionId);

  // Delete the file first: if storage fails, nothing is marked anonymized
  // and the next run retries.
  await storageService.deleteResumeFile(session.resumeFileRef);

  const now = new Date();
  const originalEmail = session.email;

  await prisma.$transaction([
    prisma.response.updateMany({
      where: { sessionId },
      data: { responseText: REMOVED, responseAudioUrl: null },
    }),
    // AI-generated questions are personalized from the resume.
    prisma.question.updateMany({ where: { sessionId }, data: { questionText: REMOVED } }),
    ...session.evaluations.map((e) =>
      prisma.evaluation.update({
        where: { id: e.id },
        data: {
          summaryText: null,
          // Json columns need DbNull, not a plain null.
          strengths: Prisma.DbNull,
          concerns: Prisma.DbNull,
          scorecard: stripScorecard(e.scorecard),
          humanReviewNotes: null,
        },
      })
    ),
    prisma.humanReviewRequest.updateMany({
      where: { sessionId, status: 'OPEN' },
      data: { status: 'RESOLVED', outcome: 'data_erased', resolvedAt: now },
    }),
    prisma.humanReviewRequest.updateMany({
      where: { sessionId },
      data: { reason: REMOVED, resolutionNotes: null, candidateResponse: null },
    }),
    prisma.candidateSession.update({
      where: { id: sessionId },
      data: {
        candidateName: REMOVED,
        email: anonymizedEmail(sessionId),
        resumeText: null,
        resumeFileRef: null,
        resumeJdRationale: null,
        anonymizedAt: now,
        ...(session.status === 'INVITED' || session.status === 'IN_PROGRESS' ? { status: 'CANCELLED' } : {}),
      },
    }),
  ]);

  let candidateAnonymized = false;
  const candidate = await prisma.candidate.findUnique({ where: { email: originalEmail } });
  if (candidate) {
    const otherLiveSessions = await prisma.candidateSession.count({
      where: { email: originalEmail, anonymizedAt: null },
    });
    if (otherLiveSessions === 0) {
      await prisma.$transaction([
        prisma.consentRecord.updateMany({
          where: { candidateId: candidate.id, consentWithdrawnAt: null },
          data: { consentWithdrawnAt: now },
        }),
        prisma.consentRecord.updateMany({ where: { candidateId: candidate.id }, data: { ipAddress: null } }),
        prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            fullName: REMOVED,
            email: anonymizedEmail(candidate.id),
            phone: null,
            resumeText: null,
            resumeUrl: null,
            anonymizedAt: now,
          },
        }),
      ]);
      candidateAnonymized = true;
    }
  }

  await logAuditEvent({
    actorType,
    actorId,
    action: 'data_anonymized',
    entityType: 'candidate_session',
    entityId: sessionId,
    outputRef: candidateAnonymized && candidate ? `candidate:${candidate.id}` : null,
    purpose:
      reason === 'candidate_erasure_request'
        ? 'DPDP: candidate withdrew consent and requested erasure'
        : 'DPDP: data retention period expired',
  });

  return { sessionId, candidateAnonymized };
}

// Sessions whose retention window has passed. Sessions without a stored
// retention date fall back to completedAt (or createdAt if never completed)
// plus DATA_RETENTION_DAYS.
async function findExpiredSessions(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.dataRetentionDays * DAY_MS);
  return prisma.candidateSession.findMany({
    where: {
      anonymizedAt: null,
      OR: [
        { dataRetentionUntil: { lte: now } },
        { dataRetentionUntil: null, completedAt: { lte: cutoff } },
        { dataRetentionUntil: null, completedAt: null, createdAt: { lte: cutoff } },
      ],
    },
    select: {
      id: true,
      humanReviewRequests: { where: { status: 'OPEN' }, select: { id: true } },
    },
  });
}

// The retention job. A session with an OPEN human-review request is held
// (not anonymized) until the request is resolved — erasing the data a
// reviewer is about to look at would defeat the candidate's own request.
async function runRetention({ now = new Date(), dryRun = false } = {}) {
  const expired = await findExpiredSessions(now);
  const result = { anonymized: [], held: [], failed: [], dryRun };

  for (const s of expired) {
    if (s.humanReviewRequests.length > 0) {
      result.held.push(s.id);
      continue;
    }
    if (dryRun) {
      result.anonymized.push(s.id);
      continue;
    }
    try {
      await anonymizeSession(s.id, { actorType: 'system', reason: 'retention_expired' });
      result.anonymized.push(s.id);
    } catch (err) {
      result.failed.push({ sessionId: s.id, error: err.message });
    }
  }

  return result;
}

module.exports = {
  anonymizeSession,
  runRetention,
  findExpiredSessions,
  retentionUntilFrom,
  stripScorecard,
  SessionNotFoundError,
  AlreadyAnonymizedError,
  REMOVED,
};
