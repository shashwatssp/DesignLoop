import { Link, useNavigate, useParams } from "react-router-dom";
import { getProblemById } from "../data/problems";
import {
  clearDraft,
  findDraftForProblem,
  listAttemptSummariesForProblem,
  saveAttempt,
} from "../lib/storage";
import type { Attempt } from "../types";

export default function ProblemPage() {
  const { problemId } = useParams();
  const navigate = useNavigate();
  const problem = getProblemById(problemId);

  if (!problem) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-slate-500">Problem not found.</p>
        <Link to="/" className="btn-primary">
          Back to library
        </Link>
      </div>
    );
  }

  const pastAttempts = listAttemptSummariesForProblem(problem.id);
  const draft = findDraftForProblem(problem.id);

  const startAttempt = async () => {
    const attempt: Attempt = {
      id: crypto.randomUUID(),
      problemId: problem.id,
      startedAt: Date.now(),
      durationMs: 0,
      sceneJson: "",
      notes: "",
      codeText: "",
    };
    await saveAttempt(attempt, problem.title);
    clearDraft(attempt.id);
    navigate(`/attempt/${attempt.id}`);
  };

  const bestScore = pastAttempts.reduce<number | undefined>(
    (best, a) => (a.overallScore !== undefined && (best === undefined || a.overallScore > best) ? a.overallScore : best),
    undefined
  );

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/" className="mb-4 inline-block text-sm text-slate-500 hover:text-indigo-500 dark:text-slate-400">
        ← Library
      </Link>

      <div className="card p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="badge bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            {problem.type.toUpperCase()}
          </span>
          <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {problem.difficulty}
          </span>
          <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            ⏱ {problem.timeLimitMin} min
          </span>
          {bestScore !== undefined && (
            <span
              className={`badge ${
                bestScore >= 7
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : bestScore >= 4
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
              }`}
            >
              Your best: ★ {bestScore.toFixed(1)}/10
            </span>
          )}
        </div>

        <h1 className="mb-3 text-2xl font-bold">{problem.title}</h1>
        <p className="mb-6 text-slate-600 dark:text-slate-300">{problem.description}</p>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Requirements
        </h2>
        <ul className="mb-6 space-y-1.5">
          {problem.requirements.map((req) => (
            <li key={req} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="mt-0.5 text-indigo-500">•</span>
              {req}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={startAttempt} className="btn-primary">
            ▶ Start attempt
          </button>
          {draft && (
            <button onClick={() => navigate(`/attempt/${draft.attemptId}`)} className="btn-secondary">
              ⏵ Resume last draft
              <span className="text-xs opacity-60">
                ({new Date(draft.savedAt).toLocaleString()})
              </span>
            </button>
          )}
        </div>

        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Expected components are revealed after you submit, so you can practice honestly.
        </p>
      </div>

      {pastAttempts.length > 0 && (
        <div className="card mt-4 p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Your past attempts
          </h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {pastAttempts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-slate-600 dark:text-slate-300">
                  {new Date(a.startedAt).toLocaleString()}
                </span>
                <span className="flex items-center gap-3">
                  {a.overallScore !== undefined ? (
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      ★ {a.overallScore.toFixed(1)}/10
                    </span>
                  ) : (
                    <span className="text-slate-400">no score</span>
                  )}
                  <Link to={`/feedback/${a.id}`} className="text-indigo-500 hover:underline">
                    View
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
