const mockAi = require('../src/services/mockAiService');

describe('mockAiService (AI_MOCK_MODE, local testing only)', () => {
  const versions = { sessionQuestionsAndScore: 'q.v1', resumeScoreOnly: 'r.v1' };

  test('AI mode returns placeholder questions and score tagged mock-ai', () => {
    const r = mockAi.generateSessionQuestionsAndScore('AI', versions);
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.questions[0]).toHaveProperty('questionText');
    expect(r.resumeJdScore).toBeGreaterThanOrEqual(0);
    expect(r.resumeJdRationale).toMatch(/Mock AI/);
    expect(r.model).toBe('mock-ai');
    expect(r.promptVersion).toBe('q.v1');
  });

  test('MANUAL mode returns no questions', () => {
    const r = mockAi.generateSessionQuestionsAndScore('MANUAL', versions);
    expect(r.questions).toBeNull();
    expect(r.promptVersion).toBe('r.v1');
  });

  test('evaluation matches the evaluation.v2 shape and ranges', () => {
    const r = mockAi.evaluateTranscript(
      [
        { questionText: 'Q1', responseText: 'word '.repeat(70) },
        { questionText: 'Q2', responseText: null },
      ],
      'evaluation.v2'
    );
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(100);
    expect(['advance', 'further_review', 'do_not_advance']).toContain(r.recommendation);
    expect(r.scorecard.length).toBeGreaterThan(0);
    r.scorecard.forEach((c) => {
      expect(c.score).toBeGreaterThanOrEqual(1);
      expect(c.score).toBeLessThanOrEqual(5);
      expect(c.questionNumbers).toEqual([1, 2]);
    });
    expect(r.summaryText).toMatch(/Mock AI/);
    expect(r.model).toBe('mock-ai');
  });

  test('evaluation handles an empty transcript', () => {
    const r = mockAi.evaluateTranscript([], 'evaluation.v2');
    expect(r.scorecard[0].score).toBe(2);
  });

  test('voice stubs return a transcript and a valid WAV', () => {
    expect(mockAi.transcribeAudio(Buffer.alloc(4096)).text).toMatch(/Mock transcription/);
    const speech = mockAi.synthesizeSpeech();
    expect(speech.contentType).toBe('audio/wav');
    expect(speech.audioBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(speech.audioBuffer.toString('ascii', 8, 12)).toBe('WAVE');
  });
});

describe('AI_MOCK_MODE config guard', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  test('is refused when NODE_ENV=production', () => {
    process.env.AI_MOCK_MODE = 'true';
    process.env.NODE_ENV = 'production';
    jest.isolateModules(() => {
      expect(() => require('../src/config')).toThrow(/not allowed/);
    });
  });

  test('is on only for the exact value "true"', () => {
    process.env.NODE_ENV = 'test';
    process.env.AI_MOCK_MODE = '1';
    jest.isolateModules(() => {
      expect(require('../src/config').aiMockMode).toBe(false);
    });
    process.env.AI_MOCK_MODE = 'true';
    jest.isolateModules(() => {
      expect(require('../src/config').aiMockMode).toBe(true);
    });
  });
});
