jest.mock('../src/services/anthropicService', () => ({ generateNextTurn: jest.fn() }));

const anthropicService = require('../src/services/anthropicService');
const conversation = require('../src/services/conversationService');
const mockAi = require('../src/services/mockAiService');

const plan = {
  topics: [
    { topic: 'APIs', why: 'Core', starterQuestion: 'Tell me about an API you built.' },
    { topic: 'Databases', why: 'Core', starterQuestion: 'How do you design schemas?' },
  ],
};
const turn = (kind, topic = 'APIs') => ({ questionText: 'Q', responseText: 'A', kind, topic });

beforeEach(() => jest.clearAllMocks());

describe('conversationService.decideNextTurn guard rails', () => {
  it('caps consecutive follow-ups and moves to the next planned topic', async () => {
    anthropicService.generateNextTurn.mockResolvedValue({
      action: 'follow_up',
      topic: 'APIs',
      leadIn: 'ok',
      questionText: 'Yet another follow-up?',
      rationale: 'r',
      model: 'm',
      promptVersion: 'p',
    });

    const d = await conversation.decideNextTurn({
      plan,
      turns: [turn('opening'), turn('follow_up'), turn('follow_up')],
    });

    expect(d.end).toBe(false);
    expect(d.question.kind).toBe('plan_fallback');
    expect(d.question.questionText).toBe('How do you design schemas?');
    expect(d.override).toMatch(/follow-up limit/);
  });

  it('uses the AI question as-is when it is within the rules', async () => {
    anthropicService.generateNextTurn.mockResolvedValue({
      action: 'new_topic',
      topic: 'Databases',
      leadIn: 'Thanks.',
      questionText: '  How did you model tenants in Postgres?  ',
      rationale: 'r',
      model: 'm',
      promptVersion: 'p',
    });

    const d = await conversation.decideNextTurn({ plan, turns: [turn('opening')] });

    expect(d.override).toBeUndefined();
    expect(d.question).toEqual(
      expect.objectContaining({ questionText: 'How did you model tenants in Postgres?', kind: 'new_topic', generatedByModel: 'm' })
    );
  });

  it('counts only the trailing run of follow-ups', () => {
    expect(conversation.trailingFollowUps([turn('follow_up'), turn('new_topic'), turn('follow_up')])).toBe(1);
  });
});

describe('mockAiService conversational stubs', () => {
  const limits = conversation.LIMITS;

  it('plans topics and an opening question tagged mock-ai', () => {
    const p = mockAi.generateInterviewPlan('interview_plan.v1');
    expect(p.topics.length).toBeGreaterThanOrEqual(3);
    expect(p.openingQuestion).toBeTruthy();
    expect(p.model).toBe('mock-ai');
  });

  it('follows up on a short answer, quoting it', () => {
    const p = mockAi.generateInterviewPlan('v');
    const t = mockAi.generateNextTurn(
      { plan: p, turns: [{ questionText: 'Q', responseText: 'I built APIs', kind: 'opening', topic: p.topics[0].topic }], limits },
      'v'
    );
    expect(t.action).toBe('follow_up');
    expect(t.questionText).toMatch(/I built APIs/);
  });

  it('moves on after a long answer and ends when the plan is covered', () => {
    const p = mockAi.generateInterviewPlan('v');
    const long = 'word '.repeat(40);
    const next = mockAi.generateNextTurn(
      { plan: p, turns: [{ questionText: 'Q', responseText: long, kind: 'opening', topic: p.topics[0].topic }], limits },
      'v'
    );
    expect(next.action).toBe('new_topic');
    expect(next.topic).toBe(p.topics[1].topic);

    const allCovered = p.topics.map((t) => ({ questionText: 'Q', responseText: long, kind: 'new_topic', topic: t.topic }));
    expect(mockAi.generateNextTurn({ plan: p, turns: allCovered, limits }, 'v').action).toBe('end');
  });
});
