import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getProblemById } from "../data/problems";
import { deleteAttempt, listAttemptSummaries } from "../lib/storage";

function Sparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null;
  const w = 96;
  const h = 28;
  const pts = scores
    .map((s, i) => {
      const x = (i / (scores.length - 1)) * (w - 4) + 2;
      const y = h - 2 - (Math.max(0, Math.min(10, s)) / 10) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function HistoryPage() {
  const [summaries, setSummaries] = useState(() => listAttemptSummaries());
  const [filter, setFilter] = useState<"all" | "lld" | "hld">("all");

  const rows = useMemo(
    () =>
      summaries
        .map((s) => ({ summary: s, problem: getProblemById(s.problemId) }))
        .filter((r) => r.problem && (filter === "all" || r.problem.type === filter)),
    [summaries, filter]
  );

  const trendsByProblem = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const s of [...summaries].sort((a, b) => a.startedAt - b.startedAt)) {
      if (s.overallScore === undefined) continue;
      const arr = map.get(s.problemId) ?? [];
      arr.push(s.overallScore);
      map.set(s.problemId, arr);
    }
    return map;
  }, [summaries]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this attempt? This cannot be undone.")) return;
    await deleteAttempt(id);
    setSummaries(listAttemptSummaries());
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Your progress</h1>
        <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800/80">
          {(["all", "lld", "hld"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-white text-slate-900 shadow dark:bg-slate-950 dark:text-white"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* trends */}
      {trendsByProblem.size > 0 && (
        <div className="card mb-5 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Score trends per problem
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {[...trendsByProblem.entries()].map(([pid, scores]) => (
              <div key={pid} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Sparkline scores={scores} />
                <span>{getProblemById(pid)?.title ?? pid}</span>
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {scores[0].toFixed(1)} → {scores[scores.length - 1].toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* attempt list */}
      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(({ summary, problem }) => (
          <div key={summary.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <Link
                to={`/feedback/${summary.id}`}
                className="truncate text-sm font-medium hover:text-indigo-500"
              >
                {problem?.title ?? summary.problemTitle}
              </Link>
              <p className="text-xs text-slate-400">
                {new Date(summary.startedAt).toLocaleString()} · {Math.round(summary.durationMs / 60000)} min
              </p>
            </div>
            <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {problem?.type.toUpperCase()}
            </span>
            {summary.overallScore !== undefined ? (
              <span
                className={`text-sm font-semibold ${
                  summary.overallScore >= 7
                    ? "text-emerald-500"
                    : summary.overallScore >= 4
                    ? "text-amber-500"
                    : "text-red-500"
                }`}
              >
                ★ {summary.overallScore.toFixed(1)}
              </span>
            ) : (
              <span className="text-xs text-slate-400">not evaluated</span>
            )}
            <Link to={`/feedback/${summary.id}`} className="text-xs text-indigo-500 hover:underline">
              View
            </Link>
            <button
              onClick={() => handleDelete(summary.id)}
              className="text-xs text-slate-400 hover:text-red-500"
            >
              Delete
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">
            No attempts yet.{" "}
            <Link to="/" className="text-indigo-500 hover:underline">
              Pick a problem
            </Link>{" "}
            and start the loop.
          </p>
        )}
      </div>
    </div>
  );
}
