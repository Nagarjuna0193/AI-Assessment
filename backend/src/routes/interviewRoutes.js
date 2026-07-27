const express = require('express');
const prisma = require('../db/prismaClient');
const { logAuditEvent } = require('../services/auditLogService');
const { hasValidConsent } = require('../services/consentService');
const anthropicService = require('../services/anthropicService');

const router = express.Router();

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

// Create an interview: accepts JD + resume text, enforces DPDP consent, then
// calls Claude to generate the question set and persists it.
router.post('/', async (req, res, next) => {
  try {
    const { candidateEmail, jobTitle, jobDescriptionText, resumeText, mode } = req.body;

    if (!candidateEmail || !jobDescriptionText || !resumeText) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'candidateEmail, jobDescriptionText, and resumeText are required',
      });
    }

    const candidate = await prisma.candidate.findUnique({ where: { email: candidateEmail } });
    if (!candidate) {
      return res.status(404).json({
        error: 'candidate_not_found',
        message: 'Record consent for this candidate before starting an interview',
      });
    }

    const consented = await hasValidConsent(candidate.id);
    if (!consented) {
      return res.status(403).json({
        error: 'consent_required',
        message: 'Candidate consent must be recorded before an interview can start',
      });
    }

    let generated;
    try {
      generated = await anthropicService.generateQuestions(jobDescriptionText, resumeText);
    } catch (err) {
      if (mapAnthropicError(err, res, 'question_generation_declined', 'question_generation_failed')) {
        return;
      }
      throw err;
    }

    const interview = await prisma.interview.create({
      data: {
        candidateId: candidate.id,
        jobTitle: jobTitle || null,
        jobDescriptionText,
        mode: mode === 'VOICE' ? 'VOICE' : 'TEXT',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        questions: {
          create: generated.questions.map((q, index) => ({
            orderIndex: index,
            questionText: q.questionText,
            generatedByModel: generated.model,
          })),
        },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });

    await logAuditEvent({
      actorType: 'system',
      action: 'question_generated',
      entityType: 'interview',
      entityId: interview.id,
      modelVersion: generated.model,
      purpose: 'Interview question generation from JD + resume',
    });

    const firstQuestion = interview.questions[0];

    res.status(201).json({
      interviewId: interview.id,
      totalQuestions: interview.questions.length,
      firstQuestion: firstQuestion && {
        id: firstQuestion.id,
        orderIndex: firstQuestion.orderIndex,
        questionText: firstQuestion.questionText,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Submit a candidate's answer to a question; returns the next question or an
// end-of-interview signal.
router.post('/:id/answers', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { questionId, responseText } = req.body;

    if (!questionId || !responseText) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'questionId and responseText are required',
      });
    }

    const interview = await prisma.interview.findUnique({ where: { id } });
    if (!interview) {
      return res.status(404).json({ error: 'interview_not_found' });
    }
    if (interview.status !== 'IN_PROGRESS') {
      return res.status(409).json({
        error: 'interview_not_in_progress',
        message: `Interview status is ${interview.status}`,
      });
    }

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question || question.interviewId !== id) {
      return res.status(404).json({ error: 'question_not_found' });
    }

    const existingResponse = await prisma.response.findFirst({ where: { questionId } });
    if (existingResponse) {
      return res.status(409).json({ error: 'already_answered' });
    }

    await prisma.response.create({
      data: {
        interviewId: id,
        questionId,
        responseText,
        submittedAt: new Date(),
      },
    });

    const [totalQuestions, answeredCount] = await Promise.all([
      prisma.question.count({ where: { interviewId: id } }),
      prisma.response.count({ where: { interviewId: id } }),
    ]);

    if (answeredCount >= totalQuestions) {
      await prisma.interview.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return res.status(200).json({ done: true, message: 'Interview complete' });
    }

    const answeredQuestionIds = (
      await prisma.response.findMany({ where: { interviewId: id }, select: { questionId: true } })
    ).map((r) => r.questionId);

    const nextQuestion = await prisma.question.findFirst({
      where: { interviewId: id, id: { notIn: answeredQuestionIds } },
      orderBy: { orderIndex: 'asc' },
    });

    res.status(200).json({
      done: false,
      nextQuestion: nextQuestion && {
        id: nextQuestion.id,
        orderIndex: nextQuestion.orderIndex,
        questionText: nextQuestion.questionText,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Trigger evaluation of a completed interview's full transcript.
router.post('/:id/evaluate', async (req, res, next) => {
  try {
    const { id } = req.params;

    const interview = await prisma.interview.findUnique({ where: { id } });
    if (!interview) {
      return res.status(404).json({ error: 'interview_not_found' });
    }
    if (interview.status !== 'COMPLETED') {
      return res.status(409).json({
        error: 'interview_not_complete',
        message: `Interview status is ${interview.status}; all questions must be answered before evaluation`,
      });
    }

    const questions = await prisma.question.findMany({
      where: { interviewId: id },
      orderBy: { orderIndex: 'asc' },
      include: { responses: true },
    });

    const transcript = questions.map((q) => ({
      questionText: q.questionText,
      responseText: q.responses[0] && q.responses[0].responseText,
    }));

    let result;
    try {
      result = await anthropicService.evaluateTranscript(interview.jobDescriptionText, transcript);
    } catch (err) {
      if (mapAnthropicError(err, res, 'evaluation_declined', 'evaluation_failed')) {
        return;
      }
      throw err;
    }

    const evaluation = await prisma.evaluation.create({
      data: {
        interviewId: id,
        overallScore: result.overallScore,
        summaryText: result.summaryText,
        scorecard: result.scorecard,
        modelVersion: result.model,
        evaluatedAt: new Date(),
      },
    });

    await logAuditEvent({
      actorType: 'system',
      action: 'evaluation_generated',
      entityType: 'evaluation',
      entityId: evaluation.id,
      modelVersion: result.model,
      purpose: 'LLM-based transcript evaluation against job description',
    });

    res.status(201).json({ evaluation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
