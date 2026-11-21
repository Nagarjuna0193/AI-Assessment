// Phase 7.6: conversational (adaptive) AI-mode interviews.
//
// The AI proposes each next question from the candidate's answers
// (anthropicService.generateNextTurn); this module applies the server-side
// rules that keep every candidate's interview within the same bounds no
// matter what the model (or a prompt-injected answer) says:
//   - between MIN and MAX questions in total,
//   - at most MAX_CONSECUTIVE_FOLLOW_UPS follow-ups in a row,
//   - if the AI call fails or proposes something invalid, fall back to the
//     next uncovered topic from the interview plan, so a candidate is never
//     left stuck mid-interview.
// Every override is returned so the caller can audit-log it.
const anthropicService = require('./anthropicService');

const LIMITS = Object.freeze({ minQuestions: 5, maxQuestions: 10, maxConsecutiveFollowUps: 2 });

const CLOSING_LEAD_IN =
  "Thank you, that's everything I wanted to ask. Your answers have been recorded for the hiring team.";
// Used only if the plan has no uncovered topic left but the minimum isn't met.
const GENERIC_QUESTION =
  'Is there anything else about your experience that you think is especially relevant to this role?';

function trailingFollowUps(turns) {
  let n = 0;
  for (let i = turns.length - 1; i >= 0 && turns[i].kind === 'follow_up'; i -= 1) n += 1;
  return n;
}

function nextUncoveredTopic(plan, turns) {
  const covered = new Set(turns.map((t) => (t.topic || '').toLowerCase()));
  return (plan.topics || []).find((t) => !covered.has(t.topic.toLowerCase())) || null;
}

// A question from the plan instead of the AI's proposal. Returns an "end"
// decision when the plan is used up and the minimum is already met.
function planFallback(plan, turns, reason) {
  const topic = nextUncoveredTopic(plan, turns);
  if (!topic && turns.length >= LIMITS.minQuestions) {
    return { end: true, leadIn: CLOSING_LEAD_IN, source: 'plan_exhausted', override: reason };
  }
  return {
    end: false,
    question: {
      questionText: topic ? topic.starterQuestion : GENERIC_QUESTION,
      leadIn: 'Thanks. Let’s move on to something else.',
      kind: 'plan_fallback',
      topic: topic ? topic.topic : 'Open',
      rationale: topic
        ? `Planned topic (${topic.why}) asked from the interview plan because: ${reason}.`
        : `General closing question asked because: ${reason}.`,
      generatedByModel: 'plan-fallback',
    },
    source: 'plan_fallback',
    override: reason,
  };
}

// turns: [{ questionText, responseText, kind, topic }] in order, all answered.
// Returns { end: true, leadIn, ... } or { end: false, question: {...}, ... },
// plus model/promptVersion when the AI was called, and override/error when
// the AI's proposal was not used as-is.
async function decideNextTurn({ jobDescriptionText, resumeText, plan, turns }) {
  if (turns.length >= LIMITS.maxQuestions) {
    return { end: true, leadIn: CLOSING_LEAD_IN, source: 'max_questions' };
  }

  let proposal;
  try {
    proposal = await anthropicService.generateNextTurn({ jobDescriptionText, resumeText, plan, turns, limits: LIMITS });
  } catch (err) {
    console.error('[conversation] next-turn generation failed, using plan fallback:', err.message);
    return { ...planFallback(plan, turns, 'AI question generation failed'), error: err.message };
  }

  const ai = { model: proposal.model, promptVersion: proposal.promptVersion, aiAction: proposal.action };

  if (proposal.action === 'end') {
    if (turns.length < LIMITS.minQuestions) {
      return { ...ai, ...planFallback(plan, turns, `AI proposed ending before the minimum of ${LIMITS.minQuestions} questions`) };
    }
    return { ...ai, end: true, leadIn: proposal.leadIn || CLOSING_LEAD_IN, source: 'ai' };
  }

  if (!proposal.questionText || !proposal.questionText.trim()) {
    return { ...ai, ...planFallback(plan, turns, 'AI returned an empty question') };
  }

  if (proposal.action === 'follow_up' && trailingFollowUps(turns) >= LIMITS.maxConsecutiveFollowUps) {
    return {
      ...ai,
      ...planFallback(plan, turns, `follow-up limit of ${LIMITS.maxConsecutiveFollowUps} in a row reached`),
    };
  }

  return {
    ...ai,
    end: false,
    source: 'ai',
    question: {
      questionText: proposal.questionText.trim(),
      leadIn: proposal.leadIn ? proposal.leadIn.trim() : null,
      kind: proposal.action,
      topic: proposal.topic,
      rationale: proposal.rationale,
      generatedByModel: proposal.model,
    },
  };
}

module.exports = { LIMITS, CLOSING_LEAD_IN, decideNextTurn, trailingFollowUps, nextUncoveredTopic };
