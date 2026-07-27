jest.mock('../src/db/prismaClient', () => ({
  interview: { findUnique: jest.fn() },
  question: { findUnique: jest.fn() },
  consentRecord: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
}));

jest.mock('../src/services/voiceService', () => {
  const actual = jest.requireActual('../src/services/voiceService');
  return {
    ...actual,
    transcribeAudio: jest.fn(),
    synthesizeSpeech: jest.fn(),
  };
});

const request = require('supertest');
const prisma = require('../src/db/prismaClient');
const voiceService = require('../src/services/voiceService');
const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
});

describe('POST /api/interviews/:id/answers/transcribe', () => {
  it('returns 400 when no audio file is attached', async () => {
    const res = await request(app).post('/api/interviews/int_1/answers/transcribe');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 404 when the interview does not exist', async () => {
    prisma.interview.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/interviews/int_missing/answers/transcribe')
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('interview_not_found');
  });

  it('returns 409 when the interview is not in progress', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'COMPLETED',
      mode: 'VOICE',
      candidateId: 'cand_1',
    });

    const res = await request(app)
      .post('/api/interviews/int_1/answers/transcribe')
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(409);
    expect(voiceService.transcribeAudio).not.toHaveBeenCalled();
  });

  it('returns 403 when the interview was not started in voice mode', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'IN_PROGRESS',
      mode: 'TEXT',
      candidateId: 'cand_1',
    });

    const res = await request(app)
      .post('/api/interviews/int_1/answers/transcribe')
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('voice_not_enabled');
    expect(voiceService.transcribeAudio).not.toHaveBeenCalled();
  });

  it('returns 403 when voice_recording consent is missing or withdrawn', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'IN_PROGRESS',
      mode: 'VOICE',
      candidateId: 'cand_1',
    });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
    ]);

    const res = await request(app)
      .post('/api/interviews/int_1/answers/transcribe')
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('voice_consent_required');
    expect(voiceService.transcribeAudio).not.toHaveBeenCalled();
  });

  it('transcribes the audio and logs an audit entry without persisting a response', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'IN_PROGRESS',
      mode: 'VOICE',
      candidateId: 'cand_1',
    });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
      { consentType: 'voice_recording', consentWithdrawnAt: null },
    ]);
    voiceService.transcribeAudio.mockResolvedValue({ text: 'My answer', model: 'whisper-1' });

    const res = await request(app)
      .post('/api/interviews/int_1/answers/transcribe')
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('My answer');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'voice_answer_transcribed', entityType: 'interview' }),
      })
    );
  });

  it('returns 502 when the STT provider fails', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'IN_PROGRESS',
      mode: 'VOICE',
      candidateId: 'cand_1',
    });
    prisma.consentRecord.findMany.mockResolvedValue([
      { consentType: 'data_processing', consentWithdrawnAt: null },
      { consentType: 'voice_recording', consentWithdrawnAt: null },
    ]);
    voiceService.transcribeAudio.mockRejectedValue(
      new voiceService.VoiceProviderError('STT transcription failed: network error')
    );

    const res = await request(app)
      .post('/api/interviews/int_1/answers/transcribe')
      .attach('audio', Buffer.from('fake-audio'), 'answer.webm');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('stt_failed');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/interviews/:id/questions/:questionId/audio', () => {
  it('returns 404 when the question does not belong to the interview', async () => {
    prisma.question.findUnique.mockResolvedValue({ id: 'q1', interviewId: 'int_other' });

    const res = await request(app).get('/api/interviews/int_1/questions/q1/audio');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('question_not_found');
  });

  it('returns synthesized audio for a valid question', async () => {
    prisma.question.findUnique.mockResolvedValue({
      id: 'q1',
      interviewId: 'int_1',
      questionText: 'Tell me about yourself',
    });
    voiceService.synthesizeSpeech.mockResolvedValue({
      audioBuffer: Buffer.from('fake-mp3-bytes'),
      contentType: 'audio/mpeg',
      model: 'tts-1',
    });

    const res = await request(app).get('/api/interviews/int_1/questions/q1/audio');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(voiceService.synthesizeSpeech).toHaveBeenCalledWith('Tell me about yourself');
  });

  it('returns 502 when the TTS provider fails', async () => {
    prisma.question.findUnique.mockResolvedValue({
      id: 'q1',
      interviewId: 'int_1',
      questionText: 'Tell me about yourself',
    });
    voiceService.synthesizeSpeech.mockRejectedValue(
      new voiceService.VoiceProviderError('TTS synthesis failed: network error')
    );

    const res = await request(app).get('/api/interviews/int_1/questions/q1/audio');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('tts_failed');
  });
});
