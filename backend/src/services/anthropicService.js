const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const config = require('../config');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const QuestionSetSchema = z.object({
  questions: z
    .array(
      z.object({
        questionText: z.string(),
      })
    )
    .min(1),
});

const EvaluationSchema = z.object({
  overallScore: z.number(),
  summaryText: z.string(),
  scorecard: z.array(
    z.object({
      criterion: z.string(),
      score: z.number(),
      notes: z.string(),
    })
  ),
});

class AnthropicRefusalError extends Error {
  constructor(category) {
    super(`Claude declined the request (category: ${category || 'unknown'})`);
    this.name = 'AnthropicRefusalError';
    this.category = category;
  }
}

class AnthropicParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnthropicParseError';
  }
}

async function generateQuestions(jobDescriptionText, resumeText) {
  const response = await client.messages.parse({
    model: config.anthropicModel,
    max_tokens: 4096,
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(QuestionSetSchema),
    },
    system:
      'You generate structured interview questions for a candidate based on a job ' +
      'description and resume. Generate 5-8 questions that probe relevant experience, ' +
      'skills gaps, and role fit. Do not include preamble or commentary outside the ' +
      'structured output.',
    messages: [
      {
        role: 'user',
        content: `Job description:\n${jobDescriptionText}\n\nCandidate resume:\n${resumeText}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new AnthropicRefusalError(response.stop_details && response.stop_details.category);
  }
  if (!response.parsed_output) {
    throw new AnthropicParseError('Claude response did not match the expected question schema');
  }

  return {
    questions: response.parsed_output.questions,
    model: response.model,
  };
}

async function evaluateTranscript(jobDescriptionText, transcript) {
  const transcriptText = transcript
    .map(
      (entry, i) =>
        `Q${i + 1}: ${entry.questionText}\nA${i + 1}: ${entry.responseText || '(no answer provided)'}`
    )
    .join('\n\n');

  const response = await client.messages.parse({
    model: config.anthropicModel,
    max_tokens: 4096,
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(EvaluationSchema),
    },
    system:
      'You evaluate a candidate interview transcript against a job description. Score ' +
      'overall fit from 0-100, and provide a per-criterion scorecard with brief notes. ' +
      'Be specific and evidence-based; base every score only on what the candidate ' +
      'actually said in the transcript.',
    messages: [
      {
        role: 'user',
        content: `Job description:\n${jobDescriptionText}\n\nInterview transcript:\n${transcriptText}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new AnthropicRefusalError(response.stop_details && response.stop_details.category);
  }
  if (!response.parsed_output) {
    throw new AnthropicParseError('Claude response did not match the expected evaluation schema');
  }

  return {
    ...response.parsed_output,
    model: response.model,
  };
}

module.exports = {
  generateQuestions,
  evaluateTranscript,
  AnthropicRefusalError,
  AnthropicParseError,
};
