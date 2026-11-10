// Unit tests for the Claude service wrapper itself (route tests mock this
// whole module). The SDK client is mocked; `parse` stands in for
// client.beta.messages.parse.
const mockParse = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  function Anthropic() {
    return { beta: { messages: { parse: mockParse } } };
  }
  Anthropic.APIError = APIError;
  return Anthropic;
});

const Anthropic = require('@anthropic-ai/sdk');
const anthropicService = require('../src/services/anthropicService');

const validEvaluation = {
  overallScore: 72,
  recommendation: 'further_review',
  summaryText: 'Solid fundamentals, thin on system design.',
  strengths: [{ point: 'Clear API design reasoning', evidence: '"I version endpoints from day one" (Q2)' }],
  concerns: [{ point: 'Little scaling experience', evidence: 'Q4 answer stayed high level' }],
  scorecard: [
    { criterion: 'Node.js backend depth', score: 4, evidence: 'Q1, Q2', notes: 'Concrete examples', questionNumbers: [1, 2] },
  ],
};

beforeEach(() => mockParse.mockReset());

describe('evaluateTranscript', () => {
  it('returns the parsed report plus the serving model and prompt version', async () => {
    mockParse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: validEvaluation, model: 'claude-opus-5-5' });

    const result = await anthropicService.evaluateTranscript('JD', [{ questionText: 'Q', responseText: 'A' }], {
      mode: 'VOICE',
    });

    expect(result.recommendation).toBe('further_review');
    expect(result.model).toBe('claude-opus-5-5');
    expect(result.promptVersion).toBe(anthropicService.PROMPT_VERSIONS.evaluation);

    const request = mockParse.mock.calls[0][0];
    expect(request.fallbacks).toBe('default');
    expect(request.betas).toContain('server-side-fallback-2026-07-01');
    expect(request.messages[0].content).toContain('machine-transcribed');
    expect(request.messages[0].content).toContain('A1: A');
  });

  it('throws AnthropicRefusalError on a refusal stop reason', async () => {
    mockParse.mockResolvedValue({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, parsed_output: null });

    await expect(anthropicService.evaluateTranscript('JD', [])).rejects.toBeInstanceOf(
      anthropicService.AnthropicRefusalError
    );
  });

  it('throws AnthropicParseError when there is no parsed output', async () => {
    mockParse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null });

    await expect(anthropicService.evaluateTranscript('JD', [])).rejects.toBeInstanceOf(
      anthropicService.AnthropicParseError
    );
  });

  it('wraps client-side schema validation failures as AnthropicParseError', async () => {
    mockParse.mockRejectedValue(new Error('overallScore: Too big: expected number to be <=100'));

    await expect(anthropicService.evaluateTranscript('JD', [])).rejects.toBeInstanceOf(
      anthropicService.AnthropicParseError
    );
  });

  it('re-throws API errors (rate limit, network) untouched', async () => {
    const apiErr = new Anthropic.APIError('rate limited');
    mockParse.mockRejectedValue(apiErr);

    await expect(anthropicService.evaluateTranscript('JD', [])).rejects.toBe(apiErr);
  });
});

describe('generateSessionQuestionsAndScore', () => {
  it('returns questions in AI mode with the AI prompt version', async () => {
    mockParse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { questions: [{ questionText: 'Tell me about X' }], resumeJdScore: 80, resumeJdRationale: 'r' },
      model: 'claude-opus-5-5',
    });

    const result = await anthropicService.generateSessionQuestionsAndScore('JD', 'resume', 'AI');
    expect(result.questions).toHaveLength(1);
    expect(result.promptVersion).toBe(anthropicService.PROMPT_VERSIONS.sessionQuestionsAndScore);
  });

  it('returns null questions in MANUAL mode', async () => {
    mockParse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { resumeJdScore: 55, resumeJdRationale: 'r' },
      model: 'claude-opus-5-5',
    });

    const result = await anthropicService.generateSessionQuestionsAndScore('JD', 'resume', 'MANUAL');
    expect(result.questions).toBeNull();
    expect(result.promptVersion).toBe(anthropicService.PROMPT_VERSIONS.resumeScoreOnly);
  });
});
