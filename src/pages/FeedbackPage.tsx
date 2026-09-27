import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import FeedbackView from "../components/FeedbackView";
import FollowUpChat from "../components/FollowUpChat";
import { ErrorBox, Spinner } from "../components/Loading";
import { getProblemById } from "../data/problems";
import { extractDiagramOutline, requestFeedback } from "../lib/gemini";
import { getAttempt, saveAttempt } from "../lib/storage";
import type { Attempt, FollowUp, Problem } from "../types";

export default function FeedbackPage() {
  const { attemptId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("pending")
      ? "The interviewer couldn't finish evaluating your submission. Try generating it again."
      : null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!attemptId) return;
      const a = await getAttempt(attemptId);
      if (cancelled) return;
      setAttempt(a ?? null);
      setProblem(a ? getProblemById(a.problemId) ?? null : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  const regenerate = useCallback(async () => {
    if (!attempt || !problem || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const feedback = await requestFeedback({
        problem,
        attempt: {
          sceneJson: attempt.sceneJson,
          pngBase64: attempt.pngBase64,
          diagramOutline: extractDiagramOutline(attempt.sceneJson),
          notes: attempt.notes,
          codeText: attempt.codeText,
          durationMs: attempt.durationMs,
        },
      });
      const updated: Attempt = { ...attempt, feedback };
      await saveAttempt(updated, problem.title);
      setAttempt(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate feedback");
    } finally {
      setGenerating(false);
    }
  }, [attempt, problem, generating]);

  const addFollowUp = useCallback(
    async (f: FollowUp) => {
      if (!attempt || !problem) return;
      const updated: Attempt = { ...attempt, followUps: [...(attempt.followUps ?? []), f] };
      setAttempt(updated);
      await saveAttempt(updated, problem.title);
    },
    [attempt, problem]
  );

  if (loading) return <Spinner label="Loading feedback…" />;
  if (!attempt || !problem) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-slate-500">Attempt not found.</p>
        <Link to="/" className="btn-primary">
          Back to library
        </Link>
      </div>
    );
  }

  const minutes = Math.round(attempt.durationMs / 60000);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/" className="text-sm text-slate-500 hover:text-indigo-500 dark:text-slate-400">
            ← Library
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{problem.title}</h1>
          <p className="text-xs text-slate-400">
            Attempted {new Date(attempt.startedAt).toLocaleString()} · {minutes} min ·{" "}
            {problem.type.toUpperCase()}
          </p>
        </div>
        <button onClick={() => navigate(`/problem/${problem.id}`)} className="btn-secondary">
          ↻ Retry problem
        </button>
      </div>

      {generating && <Spinner label="Generating your evaluation…" />}
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={regenerate} /></div>}

      {!attempt.feedback && !generating && !error && (
        <div className="card mb-4 p-6 text-center">
          <p className="mb-3 text-sm text-slate-500">
            Your submission is saved but hasn't been evaluated yet.
          </p>
          <button onClick={regenerate} className="btn-primary">
            Generate feedback now
          </button>
        </div>
      )}

      {attempt.feedback && (
        <FeedbackView feedback={attempt.feedback} />
      )}

      {/* submission recap */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Your diagram
          </h3>
          {attempt.pngBase64 ? (
            <img
              src={`data:image/png;base64,${attempt.pngBase64}`}
              alt="Your design diagram"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700"
            />
          ) : (
            <p className="text-sm text-slate-400">(canvas was empty)</p>
          )}
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Your response
            </h3>
            <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
              {attempt.notes?.trim() || "(no spoken or typed response)"}
            </p>
          </div>
          {attempt.codeText?.trim() && (
            <div className="card p-5">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Your code
              </h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-200">
                {attempt.codeText}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* expected components revealed */}
      <div className="card mt-4 p-5">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Expected components (checklist for this problem)
        </h3>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {problem.expectedComponents.map((c) => (
            <li key={c} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="text-indigo-500">□</span>
              {c}
            </li>
          ))}
        </ul>
      </div>

      {attempt.feedback && (
        <div className="mt-4">
          <FollowUpChat
            problem={problem}
            diagramOutline={extractDiagramOutline(attempt.sceneJson)}
            notes={attempt.notes}
            codeText={attempt.codeText}
            feedback={attempt.feedback}
            followUps={attempt.followUps ?? []}
            onNewFollowUp={addFollowUp}
          />
        </div>
      )}
    </div>
  );
}
