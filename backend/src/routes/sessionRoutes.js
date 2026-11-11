const express = require('express');
const multer = require('multer');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { logAuditEvent } = require('../services/auditLogService');
const { hasValidConsent } = require('../services/consentService');
const anthropicService = require('../services/anthropicService');
const voiceService = require('../services/voiceService');
const resumeParserService = require('../services/resumeParserService');
const storageService = require('../services/storageService');
const retentionService = require('../services/retentionService');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Candidate-facing routes, addressed entirely by the opaque `invite_token`
// (never the internal candidate_session id reviewers use) — unauthenticated
// by design, same as the old candidate flow. See docs/DECISIONS.md.

async function findSessionByToken(token) {
  return prisma.candidateSession.findUnique({
    where: { inviteToken: token },
    include: { template: true },
  });
}

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

const MAX_REVIEW_REASON_LENGTH = 2000;

function toCandidateReviewView(r) {
  return {
    id: r.id,
    status: r.status,
    reason: r.reason,
    requestedAt: r.requestedAt,
    resolvedAt: r.resolvedAt,
    candidateResponse: r.candidateResponse,
  };
}

function mapVoiceProviderError(err, res, errorCode) {
  if (err instanceof voiceService.VoiceProviderError) {
    res.status(502).json({ error: errorCode, message: err.message });
    return true;
  }
  return false;
}

// Fetch session/template state — drives which screen the candidate flow
// shows (consent / resume upload / interview / complete) and recovers
// progress on a page refresh, same purpose the old GET /:id/progress served.
router.get('/:token', async (req, res, next) => {
  try {
    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.anonymizedAt) {
      // Nothing personal is left to show.
      return res.json({ status: session.status, anonymized: true, roleName: session.template.roleName });
    }

    const [questions, reviewRequests] = await Promise.all([
      prisma.question.findMany({
        where: { sessionId: session.id },
        orderBy: { orderIndex: 'asc' },
        include: { responses: true },
      }),
      prisma.humanReviewRequest.findMany({
        where: { sessionId: session.id },
        orderBy: { requestedAt: 'desc' },
      }),
    ]);

    res.json({
      status: session.status,
      mode: session.mode,
      candidateName: session.candidateName,
      email: session.email,
      roleName: session.template.roleName,
      resumeUploaded: !!session.resumeText,
      transcript: questions.map((q) => ({
        questionId: q.id,
        orderIndex: q.orderIndex,
        questionText: q.questionText,
        responseText: q.responses[0] ? q.responses[0].responseText : null,
      })),
      // Candidate-safe view only: no internal notes, outcome, or scores.
      reviewRequests: reviewRequests.map(toCandidateReviewView),
      // Shown in the consent text so it always matches the server setting.
      retentionDays: config.dataRetentionDays,
    });
  } catch (err) {
    next(err);
  }
});

// Consent screen (existing, unchanged) already recorded a consent_records
// row via POST /api/consent — this links that record to the session,
// starts it, and records the candidate's chosen text/voice mode.
router.post('/:token/start', async (req, res, next) => {
  try {
    const { consentRecordId, mode } = req.body;
    if (!consentRecordId) {
      return res.status(400).json({ error: 'invalid_request', message: 'consentRecordId is required' });
    }

    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.status !== 'INVITED') {
      return res.status(409).json({ error: 'session_not_invited', message: `Session status is ${session.status}` });
    }

    const candidate = await prisma.candidate.findUnique({ where: { email: session.email } });
    if (!candidate) {
      return res.status(404).json({
        error: 'candidate_not_found',
        message: 'Record consent for this candidate before starting the session',
      });
    }

    const normalizedMode = mode === 'VOICE' ? 'VOICE' : 'TEXT';
    const consented = await hasValidConsent(candidate.id, config.requiredConsentTypesForMode(normalizedMode));
    if (!consented) {
      return res.status(403).json({
        error: 'consent_required',
        message:
          normalizedMode === 'VOICE'
            ? 'Candidate consent to data processing and voice recording must be recorded before a voice session can start'
            : 'Candidate consent must be recorded before the session can start',
      });
    }

    // The linked record must be this candidate's own, live data_processing
    // consent — not just any id the browser sends.
    const linkedConsent = await prisma.consentRecord.findUnique({ where: { id: consentRecordId } });
    if (
      !linkedConsent ||
      linkedConsent.candidateId !== candidate.id ||
      linkedConsent.consentType !== 'data_processing' ||
      linkedConsent.consentWithdrawnAt
    ) {
      return res.status(400).json({
        error: 'invalid_consent_record',
        message: "consentRecordId must be this candidate's active data_processing consent",
      });
    }

    await prisma.candidateSession.update({
      where: { id: session.id },
      data: {
        status: 'IN_PROGRESS',
        mode: normalizedMode,
        consentRecordId,
        startedAt: new Date(),
      },
    });

    res.status(200).json({ status: 'IN_PROGRESS' });
  } catch (err) {
    next(err);
  }
});

// Mandatory resume upload: extracts text, stores the original file, then
// makes the one combined Claude call (personalized questions [AI mode only]
// + resume-vs-JD score [always]) and materializes the session's questions.
router.post('/:token/resume', upload.single('resume'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'invalid_request', message: 'resume file is required' });
    }

    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'session_not_in_progress', message: `Session status is ${session.status}` });
    }
    if (session.resumeText) {
      return res.status(409).json({ error: 'resume_already_uploaded' });
    }

    let resumeText;
    try {
      resumeText = await resumeParserService.extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
    } catch (err) {
      if (err instanceof resumeParserService.UnsupportedFileTypeError) {
        return res.status(400).json({ error: 'unsupported_file_type', message: err.message });
      }
      throw err;
    }

    const resumeFileRef = await storageService.uploadResumeFile(session.id, req.file.buffer, req.file.originalname);

    let generated;
    try {
      generated = await anthropicService.generateSessionQuestionsAndScore(
        session.template.jobDescriptionText,
        resumeText,
        session.template.questionMode
      );
    } catch (err) {
      if (mapAnthropicError(err, res, 'question_generation_declined', 'question_generation_failed')) {
        return;
      }
      throw err;
    }

    const questionTexts =
      session.template.questionMode === 'AI'
        ? generated.questions.map((q) => q.questionText)
        : session.template.manualQuestions;

    const [, , questions] = await prisma.$transaction([
      prisma.candidateSession.update({
        where: { id: session.id },
        data: {
          resumeFileRef,
          resumeText,
          resumeJdScore: generated.resumeJdScore,
          resumeJdRationale: generated.resumeJdRationale,
        },
      }),
      prisma.question.createMany({
        data: questionTexts.map((questionText, index) => ({
          sessionId: session.id,
          orderIndex: index,
          questionText,
          generatedByModel: session.template.questionMode === 'AI' ? generated.model : 'manual',
        })),
      }),
      prisma.question.findMany({ where: { sessionId: session.id }, orderBy: { orderIndex: 'asc' } }),
    ]);

    // Both outputs come from the same call, so they share prompt/input refs.
    const auditRefs = {
      modelVersion: generated.model,
      promptRef: generated.promptVersion,
      inputRef: `template:${session.template.id}+resume:${resumeFileRef}`,
    };
    if (session.template.questionMode === 'AI') {
      await logAuditEvent({
        actorType: 'system',
        action: 'question_generated',
        entityType: 'candidate_session',
        entityId: session.id,
        ...auditRefs,
        outputRef: `questions:session:${session.id}`,
        purpose: 'Personalized interview question generation from JD + resume',
      });
    }
    await logAuditEvent({
      actorType: 'system',
      action: 'resume_jd_scored',
      entityType: 'candidate_session',
      entityId: session.id,
      ...auditRefs,
      outputRef: `candidate_session:${session.id}.resume_jd_score`,
      purpose: 'LLM-based resume-vs-JD match scoring',
    });

    const firstQuestion = questions[0];

    res.status(200).json({
      totalQuestions: questions.length,
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

// Submit a candidate's answer — same logic as the old POST /:id/answers,
// looked up by token instead of a raw id.
router.post('/:token/answers', async (req, res, next) => {
  try {
    const { questionId, responseText } = req.body;
    if (!questionId || !responseText) {
      return res.status(400).json({ error: 'invalid_request', message: 'questionId and responseText are required' });
    }

    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'session_not_in_progress', message: `Session status is ${session.status}` });
    }

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question || question.sessionId !== session.id) {
      return res.status(404).json({ error: 'question_not_found' });
    }

    const existingResponse = await prisma.response.findFirst({ where: { questionId } });
    if (existingResponse) {
      return res.status(409).json({ error: 'already_answered' });
    }

    await prisma.response.create({
      data: { sessionId: session.id, questionId, responseText, submittedAt: new Date() },
    });

    const [totalQuestions, answeredCount] = await Promise.all([
      prisma.question.count({ where: { sessionId: session.id } }),
      prisma.response.count({ where: { sessionId: session.id } }),
    ]);

    if (answeredCount >= totalQuestions) {
      const completedAt = new Date();
      await prisma.candidateSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          completedAt,
          // DPDP retention clock starts at completion.
          dataRetentionUntil: retentionService.retentionUntilFrom(completedAt),
        },
      });
      return res.status(200).json({ done: true, message: 'Interview complete' });
    }

    const answeredQuestionIds = (
      await prisma.response.findMany({ where: { sessionId: session.id }, select: { questionId: true } })
    ).map((r) => r.questionId);

    const nextQuestion = await prisma.question.findFirst({
      where: { sessionId: session.id, id: { notIn: answeredQuestionIds } },
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

// STT: transcribe a spoken answer (does not persist — same additive design
// as Phase 4's voice flow, just token-addressed now).
router.post('/:token/answers/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'invalid_request', message: 'audio file is required' });
    }

    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'session_not_in_progress', message: `Session status is ${session.status}` });
    }
    if (session.mode !== 'VOICE') {
      return res.status(403).json({ error: 'voice_not_enabled', message: 'This session was not started in voice mode' });
    }

    const candidate = await prisma.candidate.findUnique({ where: { email: session.email } });
    const consented = candidate && (await hasValidConsent(candidate.id, [config.voiceConsentType]));
    if (!consented) {
      return res.status(403).json({
        error: 'voice_consent_required',
        message: 'Candidate has not consented (or has withdrawn consent) to voice recording',
      });
    }

    let transcription;
    try {
      transcription = await voiceService.transcribeAudio(req.file.buffer, req.file.originalname, req.file.mimetype);
    } catch (err) {
      if (mapVoiceProviderError(err, res, 'stt_failed')) {
        return;
      }
      throw err;
    }

    await logAuditEvent({
      actorType: 'candidate',
      actorId: candidate.id,
      action: 'voice_answer_transcribed',
      entityType: 'candidate_session',
      entityId: session.id,
      modelVersion: transcription.model,
      purpose: 'STT transcription of a spoken interview answer',
    });

    res.status(200).json({ text: transcription.text });
  } catch (err) {
    next(err);
  }
});

// Phase 6 / DPDP: the candidate asks for a human to review the AI-assisted
// assessment of their completed interview. One OPEN request at a time; a
// new one can be filed after the previous is resolved.
router.post('/:token/review-requests', async (req, res, next) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) {
      return res.status(400).json({ error: 'invalid_request', message: 'reason is required' });
    }
    if (reason.length > MAX_REVIEW_REASON_LENGTH) {
      return res.status(400).json({
        error: 'invalid_request',
        message: `reason must be at most ${MAX_REVIEW_REASON_LENGTH} characters`,
      });
    }

    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.anonymizedAt) {
      return res.status(409).json({ error: 'session_anonymized' });
    }
    if (session.status !== 'COMPLETED') {
      return res.status(409).json({
        error: 'session_not_complete',
        message: 'Human review can be requested once the interview is complete',
      });
    }

    const open = await prisma.humanReviewRequest.findFirst({ where: { sessionId: session.id, status: 'OPEN' } });
    if (open) {
      return res.status(409).json({
        error: 'review_already_open',
        message: 'A review request for this interview is already being handled',
      });
    }

    const latestEvaluation = await prisma.evaluation.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const reviewRequest = await prisma.humanReviewRequest.create({
      data: {
        sessionId: session.id,
        evaluationId: latestEvaluation ? latestEvaluation.id : null,
        reason,
      },
    });

    const candidate = await prisma.candidate.findUnique({ where: { email: session.email } });
    await logAuditEvent({
      actorType: 'candidate',
      actorId: candidate ? candidate.id : null,
      action: 'human_review_requested',
      entityType: 'human_review_request',
      entityId: reviewRequest.id,
      inputRef: latestEvaluation ? `evaluation:${latestEvaluation.id}` : `candidate_session:${session.id}`,
      purpose: 'DPDP: candidate request for human review of AI-assisted assessment',
    });

    res.status(201).json({ reviewRequest: toCandidateReviewView(reviewRequest) });
  } catch (err) {
    next(err);
  }
});

const PROCTORING_EVENT_TYPES = ['tab_hidden', 'fullscreen_exit'];
// Generous cap so a misbehaving client can't flood the table.
const MAX_PROCTORING_EVENTS_PER_SESSION = 200;

// Phase 7: basic proctoring signal from the interview screen. Context for
// the human reviewer only — never an input to the AI evaluation. Candidates
// are told about it in the consent text (v2).
router.post('/:token/proctoring-events', async (req, res, next) => {
  try {
    const { eventType } = req.body;
    if (!PROCTORING_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({
        error: 'invalid_request',
        message: `eventType must be one of ${PROCTORING_EVENT_TYPES.join(', ')}`,
      });
    }

    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'session_not_in_progress', message: `Session status is ${session.status}` });
    }

    const count = await prisma.proctoringEvent.count({ where: { sessionId: session.id } });
    if (count >= MAX_PROCTORING_EVENTS_PER_SESSION) {
      // Accept silently: the reviewer already sees the cap was hit.
      return res.status(202).json({ recorded: false });
    }

    // Server time, not a client-supplied timestamp.
    await prisma.proctoringEvent.create({
      data: { sessionId: session.id, eventType, occurredAt: new Date() },
    });

    res.status(201).json({ recorded: true });
  } catch (err) {
    next(err);
  }
});

// Phase 7 / DPDP: the candidate withdraws consent and asks for their data to
// be erased. Anonymizes this session immediately (an in-progress interview
// is cancelled). See retentionService.anonymizeSession for what is kept.
router.post('/:token/erasure', async (req, res, next) => {
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({ error: 'invalid_request', message: 'confirm: true is required' });
    }

    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    if (session.anonymizedAt) {
      return res.status(409).json({ error: 'already_anonymized' });
    }

    const candidate = await prisma.candidate.findUnique({ where: { email: session.email } });
    await retentionService.anonymizeSession(session.id, {
      actorType: 'candidate',
      actorId: candidate ? candidate.id : null,
      reason: 'candidate_erasure_request',
    });

    res.status(200).json({ anonymized: true });
  } catch (err) {
    next(err);
  }
});

// TTS: synthesize a question's text so it can be read aloud.
router.get('/:token/questions/:questionId/audio', async (req, res, next) => {
  try {
    const session = await findSessionByToken(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'session_not_found' });
    }

    const question = await prisma.question.findUnique({ where: { id: req.params.questionId } });
    if (!question || question.sessionId !== session.id) {
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
