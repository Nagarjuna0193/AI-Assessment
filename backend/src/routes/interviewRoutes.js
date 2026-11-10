const express = require('express');
const prisma = require('../db/prismaClient');
const { logAuditEvent } = require('../services/auditLogService');
const anthropicService = require('../services/anthropicService');
const { requireOrgAuth } = require('../middleware/auth');

const router = express.Router();

// Reviewer-facing routes, org-scoped. Phase 4.6 changed these from
// flat-interview responses to templates (list) / template+session detail
// (single) — a breaking response-shape change from the original Phase 2
// endpoints. See docs/API.md and docs/DECISIONS.md.

function mapAnthropicError(err, res, declinedError, failedError) {
  if (err instanceof anthropicService.AnthropicRefusalError) {
    res.status(502).json({ error: declinedError, message: err.message });
    return true;
  }
  if (err instanceof anthropicService.AnthropicParseError) {
    res.status(502).json({ error: failedError, message: err.message });
    return true;
  }
  return false;
}

// List templates for the logged-in org, each with its candidate sessions'
// counts/statuses so the dashboard can render an expandable list.
router.get('/', requireOrgAuth, async (req, res, next) => {
  try {
    const templates = await prisma.interviewTemplate.findMany({
      where: { orgId: req.orgUser.orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        candidateSessions: {
          orderBy: { createdAt: 'desc' },
          include: { evaluations: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
    });

    res.json({
      templates: templates.map((template) => {
        const statusCounts = template.candidateSessions.reduce((acc, s) => {
          acc[s.status] = (acc[s.status] || 0) + 1;
          return acc;
        }, {});

        return {
          id: template.id,
          roleName: template.roleName,
          jobId: template.jobId,
          questionMode: template.questionMode,
          createdAt: template.createdAt,
          sessionCount: template.candidateSessions.length,
          statusCounts,
          sessions: template.candidateSessions.map((s) => ({
            id: s.id,
            candidateName: s.candidateName,
            email: s.email,
            status: s.status,
            resumeJdScore: s.resumeJdScore,
            createdAt: s.createdAt,
            evaluationScore: s.evaluations[0] ? s.evaluations[0].overallScore : null,
          })),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Fetch one candidate session (by its internal id) plus its template info,
// resume score, transcript, and evaluation — the reviewer detail view.
router.get('/:id', requireOrgAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const session = await prisma.candidateSession.findUnique({
      where: { id },
      include: {
        template: true,
        questions: { orderBy: { orderIndex: 'asc' }, include: { responses: true } },
        evaluations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!session || session.orgId !== req.orgUser.orgId) {
      return res.status(404).json({ error: 'session_not_found' });
    }

    res.json({
      template: {
        id: session.template.id,
        roleName: session.template.roleName,
        jobId: session.template.jobId,
        jobDescriptionText: session.template.jobDescriptionText,
        questionMode: session.template.questionMode,
      },
      session: {
        id: session.id,
        candidateName: session.candidateName,
        email: session.email,
        status: session.status,
        mode: session.mode,
        resumeJdScore: session.resumeJdScore,
        resumeJdRationale: session.resumeJdRationale,
        createdAt: session.createdAt,
        completedAt: session.completedAt,
      },
      transcript: session.questions.map((q) => ({
        questionId: q.id,
        orderIndex: q.orderIndex,
        questionText: q.questionText,
        responseText: q.responses[0] ? q.responses[0].responseText : null,
      })),
      evaluation: session.evaluations[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// Trigger evaluation of a completed session's full transcript. Surfaces
// resume_jd_score/rationale alongside interview performance via the same
// GET /:id detail response above, rather than a second report screen.
router.post('/:id/evaluate', requireOrgAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const session = await prisma.candidateSession.findUnique({ where: { id }, include: { template: true } });
    if (!session || session.orgId !== req.orgUser.orgId) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.status !== 'COMPLETED') {
      return res.status(409).json({
        error: 'session_not_complete',
        message: `Session status is ${session.status}; all questions must be answered before evaluation`,
      });
    }

    const questions = await prisma.question.findMany({
      where: { sessionId: id },
      orderBy: { orderIndex: 'asc' },
      include: { responses: true },
    });

    const transcript = questions.map((q) => ({
      questionText: q.questionText,
      responseText: q.responses[0] && q.responses[0].responseText,
    }));

    let result;
    try {
      result = await anthropicService.evaluateTranscript(session.template.jobDescriptionText, transcript, {
        mode: session.mode,
      });
    } catch (err) {
      if (mapAnthropicError(err, res, 'evaluation_declined', 'evaluation_failed')) {
        return;
      }
      throw err;
    }

    // Each run adds a new row (re-evaluation keeps history); the detail
    // view shows the latest.
    const evaluation = await prisma.evaluation.create({
      data: {
        sessionId: id,
        overallScore: result.overallScore,
        recommendation: result.recommendation,
        summaryText: result.summaryText,
        strengths: result.strengths,
        concerns: result.concerns,
        scorecard: result.scorecard,
        modelVersion: result.model,
        promptVersion: result.promptVersion,
        evaluatedAt: new Date(),
      },
    });

    await logAuditEvent({
      actorType: 'recruiter',
      actorId: req.orgUser.orgUserId,
      action: 'evaluation_generated',
      entityType: 'evaluation',
      entityId: evaluation.id,
      modelVersion: result.model,
      promptRef: result.promptVersion,
      inputRef: `candidate_session:${id}`,
      outputRef: `evaluation:${evaluation.id}`,
      purpose: 'LLM-based transcript evaluation against job description (triggered by reviewer)',
    });

    res.status(201).json({ evaluation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
