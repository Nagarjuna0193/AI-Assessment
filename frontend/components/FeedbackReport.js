import { Badge } from './ui';
import { formatDateTime } from '../lib/format';

// Phase 6: recruiter-facing view of an evaluation.v2 structured feedback
// report. Older (pre-v2) evaluations have no recommendation/strengths/
// concerns and a scorecard without evidence — every field is optional here.

const RECOMMENDATIONS = {
  advance: { label: 'Advance', tone: 'success' },
  further_review: { label: 'Further review', tone: 'warning' },
  do_not_advance: { label: 'Do not advance', tone: 'danger' },
};

export function RecommendationBadge({ recommendation }) {
  const rec = RECOMMENDATIONS[recommendation];
  if (!rec) return null;
  return (
    <Badge tone={rec.tone}>
      <span className="sr-only">AI recommendation: </span>
      {rec.label}
    </Badge>
  );
}

// Visual 1–5 meter; the numeric score is always shown next to it, so the
// dots themselves are hidden from assistive tech.
function ScoreDots({ score }) {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-2 w-2 rounded-full ${n <= score ? 'bg-brand-600' : 'bg-slate-200'}`} />
      ))}
    </span>
  );
}

function EvidenceList({ title, items, accent }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${accent}`} />
        {title}
      </h3>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="text-sm">
            <p className="text-slate-900">{item.point}</p>
            {item.evidence && (
              <blockquote className="mt-1 border-l-2 border-slate-200 pl-3 italic text-slate-600">
                &ldquo;{item.evidence}&rdquo;
              </blockquote>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FeedbackReport({ evaluation }) {
  const scorecard = Array.isArray(evaluation.scorecard) ? evaluation.scorecard : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-4xl font-semibold tracking-tight text-slate-900">
          {evaluation.overallScore}
          <span className="text-base font-normal text-slate-500">/100</span>
        </p>
        <RecommendationBadge recommendation={evaluation.recommendation} />
      </div>

      {evaluation.summaryText && <p className="text-sm leading-relaxed text-slate-800">{evaluation.summaryText}</p>}

      {(evaluation.strengths?.length > 0 || evaluation.concerns?.length > 0) && (
        <div className="grid gap-6 sm:grid-cols-2">
          <EvidenceList title="Strengths" items={evaluation.strengths} accent="bg-emerald-500" />
          <EvidenceList title="Concerns" items={evaluation.concerns} accent="bg-rose-500" />
        </div>
      )}

      {scorecard.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Criteria</h3>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {scorecard.map((row, i) => (
              <li key={i} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium text-slate-900">{row.criterion}</span>
                  <span className="flex shrink-0 items-center gap-2 text-slate-700">
                    <ScoreDots score={row.score} />
                    <span className="tabular-nums">
                      {row.score}/5<span className="sr-only"> for {row.criterion}</span>
                    </span>
                  </span>
                </div>
                {row.evidence && <p className="text-slate-700">{row.evidence}</p>}
                {row.notes && <p className="text-slate-600">{row.notes}</p>}
                {Array.isArray(row.questionNumbers) && row.questionNumbers.length > 0 && (
                  <p className="text-xs text-slate-500">
                    From {row.questionNumbers.length === 1 ? 'question' : 'questions'}{' '}
                    {row.questionNumbers.map((n) => `Q${n}`).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
        {evaluation.evaluatedAt && `Generated ${formatDateTime(evaluation.evaluatedAt)}`}
        {evaluation.modelVersion && ` · ${evaluation.modelVersion}`}
        {evaluation.promptVersion && ` · ${evaluation.promptVersion}`}
      </p>
    </div>
  );
}
