// Local-testing stand-in for the Claude and OpenAI voice calls, enabled only
// by AI_MOCK_MODE=true (refused when NODE_ENV=production — see config.js).
// Lets the full candidate/reviewer flow be exercised without API keys.
//
// Outputs are generic and deterministic, NOT an assessment of the candidate.
// Every result carries model "mock-ai" so it is obvious in audit_log
// (model_version), on evaluation rows, and in the reviewer UI.
const MOCK_MODEL = 'mock-ai';

const GENERIC_QUESTIONS = [
  'Walk us through your most relevant experience for this role.',
  'Describe a challenging problem you solved recently. What was your approach?',
  'Tell us about a time you had to learn something new quickly.',
  'How do you handle disagreement with a teammate about how to do something?',
  'What interests you about this role, and what would you focus on in your first three months?',
];

function generateSessionQuestionsAndScore(questionMode, promptVersions) {
  const isAiMode = questionMode === 'AI';
  return {
    questions: isAiMode ? GENERIC_QUESTIONS.map((questionText) => ({ questionText })) : null,
    resumeJdScore: 70,
    resumeJdRationale: '[Mock AI] Placeholder score for local testing. No resume analysis was performed.',
    model: MOCK_MODEL,
    promptVersion: isAiMode ? promptVersions.sessionQuestionsAndScore : promptVersions.resumeScoreOnly,
  };
}

// Score loosely tracks how much the candidate wrote, so different test runs
// show different-looking reports. Still a placeholder.
function evaluateTranscript(transcript, promptVersion) {
  const answered = transcript.filter((t) => t.responseText && t.responseText.trim());
  const avgWords = answered.length
    ? answered.reduce((n, t) => n + t.responseText.trim().split(/\s+/).length, 0) / answered.length
    : 0;
  const criterionScore = avgWords >= 60 ? 4 : avgWords >= 20 ? 3 : 2;
  const overallScore = criterionScore * 20 - 5;
  const allQuestions = transcript.map((_, i) => i + 1);
  const firstAnswer = answered[0] ? answered[0].responseText.trim().slice(0, 120) : 'No answer provided';

  const criterion = (name) => ({
    criterion: name,
    score: criterionScore,
    evidence: `[Mock AI] Placeholder based on answer length (avg ${Math.round(avgWords)} words).`,
    notes: '',
    questionNumbers: allQuestions,
  });

  return {
    overallScore,
    recommendation: criterionScore >= 4 ? 'advance' : criterionScore === 3 ? 'further_review' : 'do_not_advance',
    summaryText:
      '[Mock AI] This report was generated in local testing mode without calling an AI model. ' +
      'Scores are placeholders derived from answer length and say nothing about the candidate.',
    strengths: [{ point: '[Mock AI] Placeholder strength', evidence: firstAnswer }],
    concerns: [{ point: '[Mock AI] Placeholder concern', evidence: firstAnswer }],
    scorecard: [criterion('Relevant experience'), criterion('Problem solving'), criterion('Communication'), criterion('Role fit')],
    model: MOCK_MODEL,
    promptVersion,
  };
}

function transcribeAudio(buffer) {
  const kb = Math.max(1, Math.round((buffer ? buffer.length : 0) / 1024));
  return {
    text: `[Mock transcription of a ${kb} KB recording] Edit this text with your actual answer before submitting.`,
    model: MOCK_MODEL,
  };
}

// One second of silence as a valid 8 kHz mono 8-bit WAV, so the "Play
// question" button has something real to play.
function synthesizeSpeech() {
  const sampleRate = 8000;
  const dataSize = sampleRate;
  const buf = Buffer.alloc(44 + dataSize, 0x80);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return { audioBuffer: buf, contentType: 'audio/wav', model: MOCK_MODEL };
}

module.exports = {
  MOCK_MODEL,
  generateSessionQuestionsAndScore,
  evaluateTranscript,
  transcribeAudio,
  synthesizeSpeech,
};
