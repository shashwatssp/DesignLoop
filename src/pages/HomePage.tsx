import { useMemo, useState } from "react";
import ProblemCard from "../components/ProblemCard";
import { getProblemsByType } from "../data/problems";
import { listAttemptSummaries } from "../lib/storage";

type Tab = "lld" | "hld";

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("lld");
  const [query, setQuery] = useState("");

  const summaries = useMemo(() => listAttemptSummaries(), []);

  const statsByProblem = useMemo(() => {
    const map = new Map<string, { best: number; count: number }>();
    for (const s of summaries) {
      const entry = map.get(s.problemId) ?? { best: 0, count: 0 };
      entry.count += 1;
      if (s.overallScore !== undefined && s.overallScore > entry.best) entry.best = s.overallScore;
      map.set(s.problemId, entry);
    }
    return map;
  }, [summaries]);

  const problems = getProblemsByType(tab).filter((p) =>
    (p.title + " " + p.tags.join(" ")).toLowerCase().includes(query.toLowerCase())
  );

  const totalAttempts = summaries.length;

  return (
    <div>
      <section className="mb-8">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">
          Practice design interviews.<br />
          Get <span className="text-indigo-500">real feedback</span>.
        </h1>
        <p className="max-w-2xl text-slate-600 dark:text-slate-400">
          Pick a problem, draw your LLD/HLD on the canvas (or write code), speak your reasoning,
          and get interviewer-grade AI feedback with a score, gaps, and a reference outline.
        </p>
        {totalAttempts > 0 && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-500">
            {totalAttempts} attempt{totalAttempts > 1 ? "s" : ""} so far, keep the loop going.
          </p>
        )}
      </section>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800/80">
          {(["lld", "hld"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-white text-slate-900 shadow dark:bg-slate-950 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {t === "lld" ? "Low-Level Design" : "High-Level Design"}
              <span className="ml-1.5 text-xs opacity-60">
                {getProblemsByType(t).length}
              </span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search problems or tags…"
          className="input max-w-xs"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {problems.map((problem) => {
          const stat = statsByProblem.get(problem.id);
          return (
            <ProblemCard
              key={problem.id}
              problem={problem}
              bestScore={stat?.count ? stat.best : undefined}
              attemptCount={stat?.count ?? 0}
            />
          );
        })}
      </div>
      {problems.length === 0 && (
        <p className="py-12 text-center text-slate-500">No problems match “{query}”.</p>
      )}
    </div>
  );
}
