jest.mock('../src/db/prismaClient', () => {
  const prisma = {
    candidateSession: { findUnique: jest.fn(), update: jest.fn() },
    candidate: { findUnique: jest.fn() },
    consentRecord: { findMany: jest.fn(), findUnique: jest.fn() },
    proctoringEvent: { count: jest.fn(), create: jest.fn() },
    question: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
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
  return {
    ...actual,
    generateSessionQuestionsAndScore: jest.fn(),
    generateInterviewPlan: jest.fn(),
    generateNextTurn: jest.fn(),
  };
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

jest.mock('../src/services/retentionService', () => {
  const actual = jest.requireActual('../src/services/retentionService');
  return { ...actual, anonymizeSession: jest.fn() };
});

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const anthropicService = require('../src/services/anthropicService');
const voiceService = require('../src/services/voiceService');
const resumeParserService = require('../src/services/resumeParserService');
const storageService = require('../src/services/storageService');
const retentionService = require('../src/services/retentionService');
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
      { questionId: 'q1', orderIndex: 0, questionText: 'Q1', leadIn: null, kind: null, responseText: 'A1' },
    ]);
    expect(res.body.conversational).toBe(false);
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
    prisma.consentRecord.findUnique.mockResolvedValue({
      id: 'consent_1',
      candidateId: 'cand_1',
      consentType: 'data_processing',
      consentWithdrawnAt: null,
    });
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

describe('POST /api/sessions/:token/start consent-record ownership', () => {
  it("returns 400 when the consent record belongs to someone else", async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession());
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);
    prisma.consentRecord.findUnique.mockResolvedValue({
      id: 'consent_other',
      candidateId: 'cand_2',
      consentType: 'data_processing',
      consentWithdrawnAt: null,
    });

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/start`)
      .send({ consentRecordId: 'consent_other' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_consent_record');
    expect(prisma.candidateSession.update).not.toHaveBeenCalled();
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

  it('AI mode: scores the resume, stores the interview plan, and creates only the opening question', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    resumeParserService.extractText.mockResolvedValue('Resume text');
    storageService.uploadResumeFile.mockResolvedValue('supabase://resumes/sess_1/resume.pdf');
    anthropicService.generateInterviewPlan.mockResolvedValue({
      resumeJdScore: 85,
      resumeJdRationale: 'Strong match',
      topics: [
        { topic: 'Node.js APIs', why: 'Core requirement', starterQuestion: 'Tell me about an API you built.' },
        { topic: 'Postgres', why: 'Core requirement', starterQuestion: 'How do you design schemas?' },
        { topic: 'Ownership', why: 'Resume claim', starterQuestion: 'What did you own end to end?' },
      ],
      openingLeadIn: 'Welcome, this will be a conversation.',
      openingQuestion: 'What drew you to backend work?',
      model: 'claude-opus-5-5',
      promptVersion: 'interview_plan.v1',
    });
    prisma.candidateSession.update.mockResolvedValue({});
    prisma.question.createMany.mockResolvedValue({ count: 1 });
    prisma.question.findMany.mockResolvedValue([
      { id: 'q1', orderIndex: 0, questionText: 'What drew you to backend work?', leadIn: 'Welcome, this will be a conversation.', kind: 'opening' },
    ]);

    const res = await request(app)
      .post(`/api/sessions/${TOKEN}/resume`)
      .attach('resume', Buffer.from('%PDF-1.4 fake'), 'resume.pdf');

    expect(res.status).toBe(200);
    expect(res.body.conversational).toBe(true);
    expect(res.body.totalQuestions).toBeNull();
    expect(res.body.firstQuestion).toEqual({
      id: 'q1',
      orderIndex: 0,
      questionText: 'What drew you to backend work?',
      leadIn: 'Welcome, this will be a conversation.',
      kind: 'opening',
    });
    expect(anthropicService.generateSessionQuestionsAndScore).not.toHaveBeenCalled();
    expect(prisma.candidateSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resumeJdScore: 85,
          resumeJdRationale: 'Strong match',
          interviewPlan: expect.objectContaining({ topics: expect.any(Array), limits: expect.any(Object) }),
        }),
      })
    );
    expect(prisma.question.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          orderIndex: 0,
          kind: 'opening',
          topic: 'Node.js APIs',
          generatedByModel: 'claude-opus-5-5',
        }),
      ],
    });
    const actions = prisma.auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(['interview_plan_generated', 'resume_jd_scored']);
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
    anthropicService.generateInterviewPlan.mockRejectedValue(new anthropicService.AnthropicRefusalError('cyber'));

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
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', dataRetentionUntil: expect.any(Date) }),
      })
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

describe('GET /api/sessions/:token for an anonymized session', () => {
  it('returns only status, roleName and anonymized: true', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(
      baseSession({ status: 'COMPLETED', anonymizedAt: new Date(), candidateName: '[removed]' })
    );
    const res = await request(app).get(`/api/sessions/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'COMPLETED', anonymized: true, roleName: 'Backend Engineer' });
    expect(prisma.question.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/sessions/:token/proctoring-events', () => {
  const url = `/api/sessions/${TOKEN}/proctoring-events`;

  it('returns 400 for an unknown event type', async () => {
    const res = await request(app).post(url).send({ eventType: 'screenshot' });
    expect(res.status).toBe(400);
    expect(prisma.proctoringEvent.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the session is not in progress', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'COMPLETED' }));
    const res = await request(app).post(url).send({ eventType: 'tab_hidden' });
    expect(res.status).toBe(409);
    expect(prisma.proctoringEvent.create).not.toHaveBeenCalled();
  });

  it('records the event with a server timestamp', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    prisma.proctoringEvent.count.mockResolvedValue(3);
    prisma.proctoringEvent.create.mockResolvedValue({});

    const res = await request(app).post(url).send({ eventType: 'fullscreen_exit', occurredAt: '1999-01-01' });

    expect(res.status).toBe(201);
    expect(prisma.proctoringEvent.create).toHaveBeenCalledWith({
      data: { sessionId: 'sess_1', eventType: 'fullscreen_exit', occurredAt: expect.any(Date) },
    });
    const { occurredAt } = prisma.proctoringEvent.create.mock.calls[0][0].data;
    expect(occurredAt.getFullYear()).toBeGreaterThan(2000);
  });

  it('stops recording past the per-session cap', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    prisma.proctoringEvent.count.mockResolvedValue(200);

    const res = await request(app).post(url).send({ eventType: 'tab_hidden' });

    expect(res.status).toBe(202);
    expect(prisma.proctoringEvent.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/sessions/:token/erasure', () => {
  const url = `/api/sessions/${TOKEN}/erasure`;

  it('requires explicit confirmation', async () => {
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(400);
    expect(retentionService.anonymizeSession).not.toHaveBeenCalled();
  });

  it('returns 409 when already anonymized', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ anonymizedAt: new Date() }));
    const res = await request(app).post(url).send({ confirm: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_anonymized');
  });

  it('anonymizes the session with the candidate as actor', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS' }));
    prisma.candidate.findUnique.mockResolvedValue({ id: 'cand_1' });
    retentionService.anonymizeSession.mockResolvedValue({ sessionId: 'sess_1', candidateAnonymized: true });

    const res = await request(app).post(url).send({ confirm: true });

    expect(res.status).toBe(200);
    expect(retentionService.anonymizeSession).toHaveBeenCalledWith('sess_1', {
      actorType: 'candidate',
      actorId: 'cand_1',
      reason: 'candidate_erasure_request',
    });
  });
});

describe('POST /api/sessions/:token/review-requests on an anonymized session', () => {
  it('returns 409 session_anonymized', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(
      baseSession({ status: 'COMPLETED', anonymizedAt: new Date() })
    );
    const res = await request(app).post(`/api/sessions/${TOKEN}/review-requests`).send({ reason: 'Please check' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('session_anonymized');
    expect(prisma.humanReviewRequest.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/sessions/:token/answers (conversational, Phase 7.6)', () => {
  const plan = {
    topics: [
      { topic: 'APIs', why: 'Core', starterQuestion: 'Tell me about an API you built.' },
      { topic: 'Databases', why: 'Core', starterQuestion: 'How do you design schemas?' },
      { topic: 'Ownership', why: 'Resume', starterQuestion: 'What did you own end to end?' },
    ],
  };
  const convSession = () => baseSession({ status: 'IN_PROGRESS', resumeText: 'Resume text', interviewPlan: plan });

  function answeredQuestions(n, kinds = []) {
    return Array.from({ length: n }, (_, i) => ({
      id: `q${i + 1}`,
      orderIndex: i,
      questionText: `Q${i + 1}`,
      kind: kinds[i] || (i === 0 ? 'opening' : 'new_topic'),
      topic: i === 0 ? 'APIs' : 'Databases',
      responses: [{ responseText: `A${i + 1}` }],
    }));
  }

  function arrangeAnswer(questions) {
    prisma.candidateSession.findUnique.mockResolvedValue(convSession());
    prisma.question.findUnique.mockResolvedValue({ id: questions[questions.length - 1].id, sessionId: 'sess_1' });
    prisma.response.findFirst.mockResolvedValue(null);
    prisma.response.create.mockResolvedValue({});
    prisma.question.findMany.mockResolvedValue(questions);
    prisma.question.create.mockImplementation(({ data }) => Promise.resolve({ id: 'q_new', ...data }));
    prisma.candidateSession.update.mockResolvedValue({});
  }

  it('writes the AI follow-up as the next question, built from the answers so far', async () => {
    arrangeAnswer(answeredQuestions(1));
    anthropicService.generateNextTurn.mockResolvedValue({
      action: 'follow_up',
      topic: 'APIs',
      leadIn: 'Thanks, that helps.',
      questionText: 'You said you cut latency in half. How did you measure it?',
      rationale: 'Answer claimed a result without evidence.',
      model: 'claude-opus-5-5',
      promptVersion: 'interview_turn.v1',
    });

    const res = await request(app).post(`/api/sessions/${TOKEN}/answers`).send({ questionId: 'q1', responseText: 'A1' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(false);
    expect(res.body.nextQuestion).toEqual({
      id: 'q_new',
      orderIndex: 1,
      questionText: 'You said you cut latency in half. How did you measure it?',
      leadIn: 'Thanks, that helps.',
      kind: 'follow_up',
    });
    // Candidate response must not include the reviewer-only rationale.
    expect(res.body.nextQuestion).not.toHaveProperty('rationale');
    expect(anthropicService.generateNextTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeText: 'Resume text',
        turns: [{ questionText: 'Q1', responseText: 'A1', kind: 'opening', topic: 'APIs' }],
      })
    );
    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderIndex: 1, kind: 'follow_up', rationale: 'Answer claimed a result without evidence.' }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'question_generated', promptRef: 'interview_turn.v1' }) })
    );
  });

  it('ignores an AI "end" before the minimum and asks the next planned topic instead', async () => {
    arrangeAnswer(answeredQuestions(2));
    anthropicService.generateNextTurn.mockResolvedValue({
      action: 'end',
      topic: '',
      leadIn: 'Thanks!',
      questionText: '',
      rationale: 'Done',
      model: 'claude-opus-5-5',
      promptVersion: 'interview_turn.v1',
    });

    const res = await request(app).post(`/api/sessions/${TOKEN}/answers`).send({ questionId: 'q2', responseText: 'A2' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(false);
    expect(res.body.nextQuestion.questionText).toBe('What did you own end to end?');
    expect(res.body.nextQuestion.kind).toBe('plan_fallback');
    expect(prisma.candidateSession.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'interview_turn_overridden' }) })
    );
  });

  it('falls back to the plan when the AI call fails, so the candidate is not stuck', async () => {
    arrangeAnswer(answeredQuestions(1));
    anthropicService.generateNextTurn.mockRejectedValue(new anthropicService.AnthropicParseError('bad output'));

    const res = await request(app).post(`/api/sessions/${TOKEN}/answers`).send({ questionId: 'q1', responseText: 'A1' });

    expect(res.status).toBe(200);
    expect(res.body.nextQuestion.questionText).toBe('How do you design schemas?');
    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'plan_fallback', generatedByModel: 'plan-fallback' }),
    });
  });

  it('completes the interview when the AI ends after the minimum', async () => {
    arrangeAnswer(answeredQuestions(5));
    anthropicService.generateNextTurn.mockResolvedValue({
      action: 'end',
      topic: '',
      leadIn: 'Thank you, that covers everything.',
      questionText: '',
      rationale: 'All topics covered',
      model: 'claude-opus-5-5',
      promptVersion: 'interview_turn.v1',
    });

    const res = await request(app).post(`/api/sessions/${TOKEN}/answers`).send({ questionId: 'q5', responseText: 'A5' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(res.body.closingMessage).toBe('Thank you, that covers everything.');
    expect(prisma.candidateSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', dataRetentionUntil: expect.any(Date) }) })
    );
  });

  it('ends at the maximum without calling the AI', async () => {
    arrangeAnswer(answeredQuestions(10));

    const res = await request(app).post(`/api/sessions/${TOKEN}/answers`).send({ questionId: 'q10', responseText: 'A10' });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(anthropicService.generateNextTurn).not.toHaveBeenCalled();
  });
});

describe('POST /api/sessions/:token/next-question (Phase 7.6 recovery)', () => {
  it('returns the pending question without calling the AI when one is waiting', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(
      baseSession({ status: 'IN_PROGRESS', resumeText: 'r', interviewPlan: { topics: [] } })
    );
    prisma.question.findMany.mockResolvedValue([
      { id: 'q1', orderIndex: 0, questionText: 'Q1', kind: 'opening', topic: 'APIs', responses: [] },
    ]);

    const res = await request(app).post(`/api/sessions/${TOKEN}/next-question`);

    expect(res.status).toBe(200);
    expect(res.body.nextQuestion.id).toBe('q1');
    expect(anthropicService.generateNextTurn).not.toHaveBeenCalled();
  });

  it('returns 409 for a fixed-question (non-conversational) session', async () => {
    prisma.candidateSession.findUnique.mockResolvedValue(baseSession({ status: 'IN_PROGRESS', resumeText: 'r' }));

    const res = await request(app).post(`/api/sessions/${TOKEN}/next-question`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_conversational');
  });
});
