// Phase 6: recruiter-facing view of an evaluation.v2 structured feedback
// report. Older (pre-v2) evaluations have no recommendation/strengths/
// concerns and a scorecard without evidence — every field is optional here.

const RECOMMENDATION_STYLES = {
  advance: { label: 'Advance', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  further_review: { label: 'Further review', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  do_not_advance: { label: 'Do not advance', className: 'bg-rose-50 text-rose-800 border-rose-200' },
};

export function RecommendationBadge({ recommendation }) {
  const style = RECOMMENDATION_STYLES[recommendation];
  if (!style) return null;
  return (
    <span className={`inline-block border rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}>
      {style.label}
    </span>
  );
}

function ScoreDots({ score }) {
  return (
    <span className="inline-flex gap-1" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`w-2 h-2 rounded-full ${n <= score ? 'bg-slate-800' : 'bg-slate-200'}`} />
      ))}
    </span>
  );
}

function EvidenceList({ title, items, tone }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <h3 className={`text-sm font-medium mb-2 ${tone}`}>{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="text-sm">
            <p className="text-slate-800">{item.point}</p>
            {item.evidence && <p className="text-slate-500 italic mt-0.5">&ldquo;{item.evidence}&rdquo;</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FeedbackReport({ evaluation }) {
  const scorecard = Array.isArray(evaluation.scorecard) ? evaluation.scorecard : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-3xl font-semibold text-slate-900">
          {evaluation.overallScore}
          <span className="text-base font-normal text-slate-400">/100</span>
        </p>
        <RecommendationBadge recommendation={evaluation.recommendation} />
      </div>

      <p className="text-xs text-slate-500">
        AI-assisted and advisory only — the hiring decision is made by a person.
        {evaluation.evaluatedAt && ` Generated ${new Date(evaluation.evaluatedAt).toLocaleString()}`}
        {evaluation.modelVersion && ` · ${evaluation.modelVersion}`}
        {evaluation.promptVersion && ` · ${evaluation.promptVersion}`}
      </p>

      {evaluation.summaryText && <p className="text-slate-700 text-sm">{evaluation.summaryText}</p>}

      {(evaluation.strengths?.length > 0 || evaluation.concerns?.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          <EvidenceList title="Strengths" items={evaluation.strengths} tone="text-emerald-800" />
          <EvidenceList title="Concerns" items={evaluation.concerns} tone="text-rose-800" />
        </div>
      )}

      {scorecard.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-800 mb-2">Criteria</h3>
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-md">
            {scorecard.map((row, i) => (
              <div key={i} className="px-3 py-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-800">{row.criterion}</span>
                  <span className="flex items-center gap-2 text-slate-500 shrink-0">
                    <ScoreDots score={row.score} />
                    {row.score}/5
                  </span>
                </div>
                {row.evidence && <p className="text-slate-600">{row.evidence}</p>}
                {row.notes && <p className="text-slate-500">{row.notes}</p>}
                {Array.isArray(row.questionNumbers) && row.questionNumbers.length > 0 && (
                  <p className="text-xs text-slate-400">
                    From {row.questionNumbers.length === 1 ? 'question' : 'questions'}{' '}
                    {row.questionNumbers.map((n) => `Q${n}`).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
