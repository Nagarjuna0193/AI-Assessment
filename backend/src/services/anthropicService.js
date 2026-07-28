const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const config = require('../config');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// AI-mode session start: personalized questions + resume-vs-JD score in one
// call (see docs/DECISIONS.md — this is what makes questions personalized
// to each candidate's actual resume, per Phase 4.6).
const SessionQuestionsAndScoreSchema = z.object({
  questions: z
    .array(
      z.object({
        questionText: z.string(),
      })
    )
    .min(1),
  resumeJdScore: z.number().min(0).max(100),
  resumeJdRationale: z.string(),
});

// MANUAL-mode session start: questions are fixed on the template, but the
// resume is still worth scoring against the JD.
const ResumeScoreOnlySchema = z.object({
  resumeJdScore: z.number().min(0).max(100),
  resumeJdRationale: z.string(),
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

// One call per candidate session, per Phase 4.6: AI mode returns
// personalized questions + a resume-vs-JD score; MANUAL mode returns only
// the score (questions are already fixed on the template).
async function generateSessionQuestionsAndScore(jobDescriptionText, resumeText, questionMode) {
  const isAiMode = questionMode === 'AI';
  const schema = isAiMode ? SessionQuestionsAndScoreSchema : ResumeScoreOnlySchema;

  const system = isAiMode
    ? 'You do two things from a job description and a candidate resume: (1) generate 5-8 ' +
      'personalized interview questions that probe this specific candidate\'s relevant ' +
      'experience, skills gaps, and role fit, and (2) score how well the resume matches ' +
      'the job description from 0-100 with a short evidence-based rationale. Do not ' +
      'include preamble or commentary outside the structured output.'
    : 'You score how well a candidate resume matches a job description, from 0-100, with ' +
      'a short evidence-based rationale. Do not include preamble or commentary outside ' +
      'the structured output.';

  const response = await client.messages.parse({
    model: config.anthropicModel,
    max_tokens: 4096,
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(schema),
    },
    system,
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
    throw new AnthropicParseError('Claude response did not match the expected schema');
  }

  return {
    questions: isAiMode ? response.parsed_output.questions : null,
    resumeJdScore: response.parsed_output.resumeJdScore,
    resumeJdRationale: response.parsed_output.resumeJdRationale,
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
  generateSessionQuestionsAndScore,
  evaluateTranscript,
  AnthropicRefusalError,
  AnthropicParseError,
};
