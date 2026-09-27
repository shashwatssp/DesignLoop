import { Link } from "react-router-dom";
import type { Difficulty, Problem } from "../types";

const difficultyClasses: Record<Difficulty, string> = {
  easy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  hard: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

export default function ProblemCard({
  problem,
  bestScore,
  attemptCount,
}: {
  problem: Problem;
  bestScore?: number;
  attemptCount: number;
}) {
  return (
    <Link
      to={`/problem/${problem.id}`}
      className="card group flex h-full flex-col p-5 transition-all hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md dark:hover:border-indigo-500"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`badge ${difficultyClasses[problem.difficulty]}`}>{problem.difficulty}</span>
        <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          ⏱ {problem.timeLimitMin} min
        </span>
        {attemptCount > 0 && (
          <span className="badge bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            {attemptCount} attempt{attemptCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <h3 className="mb-1 text-base font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-100 dark:group-hover:text-indigo-300">
        {problem.title}
      </h3>
      <p className="mb-3 line-clamp-3 flex-1 text-sm text-slate-600 dark:text-slate-400">
        {problem.description}
      </p>
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {problem.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs text-slate-400 dark:text-slate-500">
              #{tag}
            </span>
          ))}
        </div>
        {bestScore !== undefined && (
          <span
            className={`text-sm font-semibold ${
              bestScore >= 7 ? "text-emerald-500" : bestScore >= 4 ? "text-amber-500" : "text-red-500"
            }`}
          >
            ★ {bestScore.toFixed(1)}/10
          </span>
        )}
      </div>
    </Link>
  );
}
