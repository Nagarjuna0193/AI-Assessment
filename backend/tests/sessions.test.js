jest.mock('../src/db/prismaClient', () => {
  const prisma = {
    candidateSession: { findUnique: jest.fn(), update: jest.fn() },
    candidate: { findUnique: jest.fn() },
    consentRecord: { findMany: jest.fn() },
    question: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      createMany: jest.fn(),
    },
    response: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    auditLog: { create: jest.fn() },
    humanReviewRequest: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    evaluation: { findFirst: jest.fn() },
    $transaction: jest.fn((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return prisma;
});

jest.mock('../src/services/anthropicService', () => {
  const actual = jest.requireActual('../src/services/anthropicService');
  return { ...actual, generateSessionQuestionsAndScore: jest.fn() };
});

jest.mock('../src/services/voiceService', () => {
  const actual = jest.requireActual('../src/services/voiceService');
  return { ...actual, transcribeAudio: jest.fn(), synthesizeSpeech: jest.fn() };
});

jest.mock('../src/services/resumeParserService', () => {
  const actual = jest.requireActual('../src/services/resumeParserService');
  return { ...actual, extractText: jest.fn() };
});

jest.mock('../src/services/storageService', () => ({
  uploadResumeFile: jest.fn(),
}));

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const anthropicService = require('../src/services/anthropicService');
const voiceService = require('../src/services/voiceService');
const resumeParserService = require('../src/services/resumeParserService');
const storageService = require('../src/services/storageService');
const app = require('../src/app');

const TOKEN = 'tok_abc123';

function baseSession(overrides = {}) {
  return {
    id: 'sess_1',
    orgId: 'org_1',
    templateId: 'tmpl_1',
    candidateName: 'Jane Doe',
    email: 'jane@example.com',
    inviteToken: TOKEN,
    status: 'INVITED',
    mode: 'TEXT',
    resumeText: null,
    template: {
      id: 'tmpl_1',
      jobDescriptionText: 'JD text',
      questionMode: 'AI',
      manualQuestions: null,
      roleName: 'Backend Engineer',
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
});

describe('GET /api/sessions/:token', () => {
  it('returns 404 for an unknown token', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/sessions/${TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session_not_found');
  });

  it('returns status/mode/candidate/role info and the transcript so far', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS', resumeText: 'resume' }));
    prisma.question.findMany.mockResolvedValue([
      { id: 'q1', orderIndex: 0, questionText: 'Q1', responses: [{ responseText: 'A1' }] },
    ]);
    prisma.humanReviewRequest.findMany.mockResolvedValue([
      {
        id: 'rr_1',
        status: 'RESOLVED',
        reason: 'r',
        outcome: 'upheld',
        resolutionNotes: 'internal only',
        candidateResponse: 'We reviewed it.',
        requestedAt: new Date('2026-07-02'),
        resolvedAt: new Date('2026-07-03'),
      },
    ]);

    const res = await request(app).get(`/api/sessions/${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.roleName).toBe('Backend Engineer');
    expect(res.body.resumeUploaded).toBe(true);
    expect(res.body.transcript).toEqual([
      { questionId: 'q1', orderIndex: 0, questionText: 'Q1', responseText: 'A1' },
    ]);
    // Candidate view must not leak internal reviewer notes or the outcome.
    expect(res.body.reviewRequests[0].candidateResponse).toBe('We reviewed it.');
    expect(res.body.reviewRequests[0]).not.toHaveProperty('resolutionNotes');
    expect(res.body.reviewRequests[0]).not.toHaveProperty('outcome');
  });
});

describe('POST /api/sessions/:token/review-requests', () => {
  const url = `/api/sessions/${TOKEN}/review-requests`;

  it('returns 400 without a reason', async () => {
    const res = await request(app).post(url).send({ reason: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when the interview is not complete', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    const res = await request(app).post(url).send({ reason: 'Please review' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('session_not_complete');
  });

  it('returns 409 when a request is already open', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'COMPLETED' }));
    prisma.humanReviewRequest.findFirst.mockResolvedValue({ id: 'rr_open' });
    const res = await request(app).post(url).send({ reason: 'Please review' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('review_already_open');
    expect(prisma.humanReviewRequest.create).not.toHaveBeenCalled();
  });

  it('creates a request linked to the latest evaluation and audit-logs it', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'COMPLETED' }));
    prisma.humanReviewRequest.findFirst.mockResolvedValue(null);
    prisma.evaluation.findFirst.mockResolvedValue({ id: 'eval_1' });
    prisma.humanReviewRequest.create.mockResolvedValue({
      id: 'rr_1',
      status: 'OPEN',
      reason: 'Please review',
      requestedAt: new Date(),
      resolvedAt: null,
      candidateResponse: null,
    });
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });

    const res = await request(app).post(url).send({ reason: '  Please review  ' });

    expect(res.status).toBe(201);
    expect(prisma.humanReviewRequest.create).toHaveBeenCalledWith({
      data: { sessionId: 'sess_1', evaluationId: 'eval_1', reason: 'Please review' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'human_review_requested', actorId: 'cand_1' }),
      })
    );
  });
});

describe('POST /api/sessions/:token/start', () => {
  it('returns 400 when consentRecordId is missing', async () => {
    const res = await request(app).post(`/api/sessions/${TOKEN}/start`).send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 when the session is not INVITED', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));

    const res = await request(app).post(`/api/sessions/${TOKEN}/start`).send({ consentRecordId: 'consent_1' });

    expect(res.status).toBe(409);
  });

  it('returns 403 when consent has not been recorded', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession());
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.consentRecord.findMany.mockResolvedValue([]);

    const res = await request(app).post(`/api/sessions/${TOKEN}/start`).send({ consentRecordId: 'consent_1' });

    expect(res.status).toBe(403);
    expect(prisma.candidateSession.update).not.toHaveBeenCalled();
  });

  it('starts the session and links the consent record', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession());
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);
    prisma.candidateSession.update.mockResolvedValue({});

    const res = await request(app).post(`/api/sessions/${TOKEN}/start`).send({ consentRecordId: 'consent_1' });

    expect(res.status).toBe(200);
    expect(prisma.candidateSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_PROGRESS', consentRecordId: 'consent_1' }),
      })
    );
  });
});

describe('POST /api/sessions/:token/resume', () => {
  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post(`/api/sessions/${TOKEN}/resume`);
    expect(res.status).toBe(400);
  });

  it('returns 409 when the session already has a resume', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS', resumeText: 'already there' }));

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/resume`)
      .attach('resume', Buffer.from('%PDF-1.4 fake'), 'resume.pdf');

    expect(res.status).toBe(409);
  });

  it('extracts text, uploads the file, generates personalized questions + a resume score (AI mode)', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    resumeParserService.extractText.mockResolvedValue('Resume text');
    storageService.uploadResumeFile.mockResolvedValue('supabase://resumes/sess_1/resume.pdf');
    anthropicService.generateSessionQuestionsAndScore.mockResolvedValue({
      questions: [{ questionText: 'Q1' }, { questionText: 'Q2' }],
      resumeJdScore: 85,
      resumeJdRationale: 'Strong match',
      model: 'claude-opus-5',
    });
    prisma.candidateSession.update.mockResolvedValue({});
    prisma.question.createMany.mockResolvedValue({ count: 2 });
    prisma.question.findMany.mockResolvedValue([
      { id: 'q1', orderIndex: 0, questionText: 'Q1' },
      { id: 'q2', orderIndex: 1, questionText: 'Q2' },
    ]);

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/resume`)
      .attach('resume', Buffer.from('%PDF-1.4 fake'), 'resume.pdf');

    expect(res.status).toBe(200);
    expect(res.body.totalQuestions).toBe(2);
    expect(res.body.firstQuestion.questionText).toBe('Q1');
    expect(prisma.candidateSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resumeJdScore: 85, resumeJdRationale: 'Strong match' }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'resume_jd_scored' }) })
    );
  });

  it('uses the template manual question set (MANUAL mode) and still scores the resume', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(
      baseSession({
        status: 'IN_PROGRESS',
        template: {
          id: 'tmpl_1',
          jobDescriptionText: 'JD text',
          questionMode: 'MANUAL',
          manualQuestions: ['Manual Q1', 'Manual Q2'],
          roleName: 'Backend Engineer',
        },
      })
    );
    resumeParserService.extractText.mockResolvedValue('Resume text');
    storageService.uploadResumeFile.mockResolvedValue('local://uploads/resume.pdf');
    anthropicService.generateSessionQuestionsAndScore.mockResolvedValue({
      questions: null,
      resumeJdScore: 60,
      resumeJdRationale: 'Partial match',
      model: 'claude-opus-5',
    });
    prisma.candidateSession.update.mockResolvedValue({});
    prisma.question.createMany.mockResolvedValue({ count: 2 });
    prisma.question.findMany.mockResolvedValue([
      { id: 'q1', orderIndex: 0, questionText: 'Manual Q1' },
      { id: 'q2', orderIndex: 1, questionText: 'Manual Q2' },
    ]);

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/resume`)
      .attach('resume', Buffer.from('%PDF-1.4 fake'), 'resume.pdf');

    expect(res.status).toBe(200);
    expect(prisma.question.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ questionText: 'Manual Q1', generatedByModel: 'manual' }),
          expect.objectContaining({ questionText: 'Manual Q2', generatedByModel: 'manual' }),
        ],
      })
    );
    // Manual mode: no question_generated audit entry, only resume_jd_scored.
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'resume_jd_scored' }) })
    );
  });

  it('returns 502 when Claude declines the request', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    resumeParserService.extractText.mockResolvedValue('Resume text');
    storageService.uploadResumeFile.mockResolvedValue('supabase://resumes/sess_1/resume.pdf');
    anthropicService.generateSessionQuestionsAndScore.mockRejectedValue(
      new anthropicService.AnthropicRefusalError('cyber')
    );

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/resume`)
      .attach('resume', Buffer.from('%PDF-1.4 fake'), 'resume.pdf');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('question_generation_declined');
    expect(prisma.candidateSession.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/sessions/:token/answers', () => {
  it('returns the next question when more remain', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    prisma.question.findUnique.mockResolvedValue({ id: 'q1', sessionId: 'sess_1' });
    prisma.response.findFirst.mockResolvedValue(null);
    prisma.response.create.mockResolvedValue({});
    prisma.question.count.mockResolvedValue(2);
    prisma.response.count.mockResolvedValue(1);
    prisma.response.findMany.mockResolvedValue([{ questionId: 'q1' }]);
    prisma.question.findFirst.mockResolvedValue({ id: 'q2', orderIndex: 1, questionText: 'Q2' });

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/answers`)
      .send({ questionId: 'q1', responseText: 'answer 1' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(false);
    expect(res.body.nextQuestion.id).toBe('q2');
  });

  it('marks the session complete on the final answer', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    prisma.question.findUnique.mockResolvedValue({ id: 'q2', sessionId: 'sess_1' });
    prisma.response.findFirst.mockResolvedValue(null);
    prisma.response.create.mockResolvedValue({});
    prisma.question.count.mockResolvedValue(2);
    prisma.response.count.mockResolvedValue(2);
    prisma.candidateSession.update.mockResolvedValue({});

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/answers`)
      .send({ questionId: 'q2', responseText: 'answer 2' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(prisma.candidateSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
  });

  it('rejects a duplicate answer to an already-answered question', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    prisma.question.findUnique.mockResolvedValue({ id: 'q1', sessionId: 'sess_1' });
    prisma.response.findFirst.mockResolvedValue({ id: 'resp_1' });

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/answers`)
      .send({ questionId: 'q1', responseText: 'answer again' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_answered');
  });
});

describe('POST /api/sessions/:token/answers/transcribe', () => {
  it('returns 403 when the session was not started in voice mode', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS', mode: 'TEXT' }));

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/answers/transcribe`)
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(403);
    expect(voiceService.transcribeAudio).not.toHaveBeenCalled();
  });

  it('returns 403 when voice_recording consent is missing', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS', mode: 'VOICE' }));
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/answers/transcribe`)
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('voice_consent_required');
  });

  it('transcribes audio and logs an audit entry', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS', mode: 'VOICE' }));
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
      { consentType: 'voice_recording', consentWithdrawnAt: null },
    ]);
    voiceService.transcribeAudio.mockResolvedValue({ text: 'My answer', model: 'whisper-1' });

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/answers/transcribe`)
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('My answer');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'voice_answer_transcribed', entityType: 'candidate_session' }),
      })
    );
  });
});

describe('GET /api/sessions/:token/questions/:questionId/audio', () => {
  it('returns 404 when the question does not belong to the session', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession());
    prisma.question.findUnique.mockResolvedValue({ id: 'q1', sessionId: 'sess_other' });

    const res = await request(app).get(`/api/sessions/${TOKEN}/questions/q1/audio`);

    expect(res.status).toBe(404);
  });

  it('returns synthesized audio for a valid question', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession());
    prisma.question.findUnique.mockResolvedValue({ id: 'q1', sessionId: 'sess_1', questionText: 'Tell me about yourself' });
    voiceService.synthesizeSpeech.mockResolvedValue({
      audioBuffer: Buffer.from('fake-mp3-bytes'),
      contentType: 'audio/mpeg',
      model: 'tts-1',
    });

    const res = await request(app).get(`/api/sessions/${TOKEN}/questions/q1/audio`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
  });
});
