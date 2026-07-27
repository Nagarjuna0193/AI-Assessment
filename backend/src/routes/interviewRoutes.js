const express = require('express');
const multer = require('multer');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { logAuditEvent } = require('../services/auditLogService');
const { hasValidConsent } = require('../services/consentService');
const anthropicService = require('../services/anthropicService');
const voiceService = require('../services/voiceService');

const router = express.Router();

// Voice answers arrive as short (single-answer) audio clips; memory storage
// is fine at pilot scale and avoids writing raw audio to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// List interviews for the reviewer dashboard, most recent first.
router.get('/', async (req, res, next) => {
  try {
    const interviews = await prisma.interview.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        candidate: { select: { id: true, fullName: true, email: true } },
        evaluations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    res.json({
      interviews: interviews.map((interview) => ({
        id: interview.id,
        jobTitle: interview.jobTitle,
        mode: interview.mode,
        status: interview.status,
        createdAt: interview.createdAt,
        candidate: interview.candidate,
        evaluation: interview.evaluations[0]
          ? { overallScore: interview.evaluations[0].overallScore }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Fetch a single interview's full transcript + evaluation for reviewers.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: {
        candidate: { select: { id: true, fullName: true, email: true } },
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { responses: true },
        },
        evaluations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!interview) {
      return res.status(404).json({ error: 'interview_not_found' });
    }

    res.json({
      interview: {
        id: interview.id,
        jobTitle: interview.jobTitle,
        jobDescriptionText: interview.jobDescriptionText,
        mode: interview.mode,
        status: interview.status,
        createdAt: interview.createdAt,
        completedAt: interview.completedAt,
        candidate: interview.candidate,
      },
      transcript: interview.questions.map((q) => ({
        questionId: q.id,
        orderIndex: q.orderIndex,
        questionText: q.questionText,
        responseText: q.responses[0] ? q.responses[0].responseText : null,
      })),
      evaluation: interview.evaluations[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

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

    const normalizedMode = mode === 'VOICE' ? 'VOICE' : 'TEXT';
    const consented = await hasValidConsent(candidate.id, config.requiredConsentTypesForMode(normalizedMode));
    if (!consented) {
      return res.status(403).json({
        error: 'consent_required',
        message:
          normalizedMode === 'VOICE'
            ? 'Candidate consent to data processing and voice recording must be recorded before a voice interview can start'
            : 'Candidate consent must be recorded before an interview can start',
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
        mode: normalizedMode,
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

function mapVoiceProviderError(err, res, errorCode) {
  if (err instanceof voiceService.VoiceProviderError) {
    res.status(502).json({ error: errorCode, message: err.message });
    return true;
  }
  return false;
}

// STT: transcribe a spoken answer to text. Does not persist a response —
// the candidate reviews/edits the transcript client-side and submits it
// through the existing POST /:id/answers, so answer-persistence logic is
// untouched (voice is an alternate input path, not a rebuild of it).
router.post('/:id/answers/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'invalid_request', message: 'audio file is required' });
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
    if (interview.mode !== 'VOICE') {
      return res.status(403).json({
        error: 'voice_not_enabled',
        message: 'This interview was not started in voice mode',
      });
    }

    // Re-checked per call (not just at interview creation) so a withdrawn
    // consent immediately stops further audio being sent to the STT provider.
    const consented = await hasValidConsent(interview.candidateId, [config.voiceConsentType]);
    if (!consented) {
      return res.status(403).json({
        error: 'voice_consent_required',
        message: 'Candidate has not consented (or has withdrawn consent) to voice recording',
      });
    }

    let transcription;
    try {
      transcription = await voiceService.transcribeAudio(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    } catch (err) {
      if (mapVoiceProviderError(err, res, 'stt_failed')) {
        return;
      }
      throw err;
    }

    await logAuditEvent({
      actorType: 'candidate',
      actorId: interview.candidateId,
      action: 'voice_answer_transcribed',
      entityType: 'interview',
      entityId: interview.id,
      modelVersion: transcription.model,
      purpose: 'STT transcription of a spoken interview answer',
    });

    res.status(200).json({ text: transcription.text });
  } catch (err) {
    next(err);
  }
});

// TTS: synthesize a question's text so it can be read aloud to the candidate.
router.get('/:id/questions/:questionId/audio', async (req, res, next) => {
  try {
    const { id, questionId } = req.params;

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question || question.interviewId !== id) {
      return res.status(404).json({ error: 'question_not_found' });
    }

    let speech;
    try {
      speech = await voiceService.synthesizeSpeech(question.questionText);
    } catch (err) {
      if (mapVoiceProviderError(err, res, 'tts_failed')) {
        return;
      }
      throw err;
    }

    res.set('Content-Type', speech.contentType);
    res.send(speech.audioBuffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
