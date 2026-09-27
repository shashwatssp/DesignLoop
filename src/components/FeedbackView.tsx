import { useState } from "react";
import type { Feedback } from "../types";

const dimensionLabels: { key: keyof Feedback["dimensionScores"]; label: string }[] = [
  { key: "requirementsCoverage", label: "Requirements coverage" },
  { key: "componentDesign", label: "Component design" },
  { key: "scalability", label: "Scalability & trade-offs" },
  { key: "communicationClarity", label: "Communication clarity" },
];

function scoreColor(score: number): string {
  return score >= 7 ? "text-emerald-500" : score >= 4 ? "text-amber-500" : "text-red-500";
}

function scoreBg(score: number): string {
  return score >= 7 ? "bg-emerald-500" : score >= 4 ? "bg-amber-500" : "bg-red-500";
}

const priorityClasses = {
  critical: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  high: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  medium: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
} as const;

export default function FeedbackView({ feedback }: { feedback: Feedback }) {
  const [showReference, setShowReference] = useState(false);

  return (
    <div className="space-y-5">
      {/* score + summary */}
      <div className="card flex flex-col items-center gap-5 p-6 sm:flex-row">
        <div className="flex flex-col items-center">
          <div
            className={`flex h-24 w-24 items-center justify-center rounded-full border-4 ${
              scoreBg(feedback.overallScore).replace("bg-", "border-")
            }`}
          >
            <span className={`text-3xl font-bold ${scoreColor(feedback.overallScore)}`}>
              {feedback.overallScore.toFixed(1)}
            </span>
          </div>
          <span className="mt-1 text-xs text-slate-400">out of 10</span>
        </div>
        <p className="flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {feedback.summary}
        </p>
      </div>

      {/* dimension bars */}
      <div className="card space-y-3 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Dimension breakdown
        </h3>
        {dimensionLabels.map(({ key, label }) => {
          const dim = feedback.dimensionScores[key];
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
                <span className={`font-semibold ${scoreColor(dim.score)}`}>
                  {dim.score.toFixed(1)}/10
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full ${scoreBg(dim.score)}`}
                  style={{ width: `${Math.max(2, Math.min(100, dim.score * 10))}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{dim.comment}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* strengths */}
        <div className="card p-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            ✅ What you did well
          </h3>
          <ul className="space-y-2">
            {feedback.strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="text-emerald-500">+</span>
                {s}
              </li>
            ))}
          </ul>
        </div>

        {/* gaps + missing components */}
        <div className="card p-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            ⚠️ Gaps & missing components
          </h3>
          <ul className="space-y-2">
            {feedback.missingComponents.map((s, i) => (
              <li key={`m${i}`} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="text-amber-500">–</span>
                {s}
              </li>
            ))}
            {feedback.gaps.map((s, i) => (
              <li key={`g${i}`} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="text-amber-500">–</span>
                {s}
              </li>
            ))}
            {feedback.missingComponents.length === 0 && feedback.gaps.length === 0 && (
              <li className="text-sm text-slate-500">Nothing major missing. Well done!</li>
            )}
          </ul>
        </div>
      </div>

      {/* improvements */}
      <div className="card p-6">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          🎯 How to improve: do this next time
        </h3>
        <ul className="space-y-2.5">
          {feedback.improvements.map((imp, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
              <span className={`badge mt-0.5 shrink-0 ${priorityClasses[imp.priority] ?? priorityClasses.medium}`}>
                {imp.priority}
              </span>
              {imp.action}
            </li>
          ))}
        </ul>
      </div>

      {/* reference outline (hidden until revealed) */}
      <div className="card p-6">
        <button
          onClick={() => setShowReference((s) => !s)}
          className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          <span>📖 Reference solution outline</span>
          <span className="text-xs font-normal text-indigo-500">
            {showReference ? "hide" : "reveal after you've reflected"}
          </span>
        </button>
        {showReference && (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {feedback.referenceOutline}
          </p>
        )}
      </div>
    </div>
  );
}
