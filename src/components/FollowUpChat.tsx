import { useState } from "react";
import { Spinner } from "./Loading";
import { requestFollowUp } from "../lib/gemini";
import type { Feedback, FollowUp, Problem } from "../types";

export default function FollowUpChat({
  problem,
  diagramOutline,
  notes,
  codeText,
  feedback,
  followUps,
  onNewFollowUp,
}: {
  problem: Problem;
  diagramOutline: string;
  notes: string;
  codeText: string;
  feedback: Feedback;
  followUps: FollowUp[];
  onNewFollowUp: (f: FollowUp) => void;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setQuestion("");
    setLoading(true);
    setError(null);
    try {
      const answer = await requestFollowUp({
        problem,
        diagramOutline,
        notes,
        codeText,
        feedback,
        history: followUps.map((f) => ({ question: f.question, answer: f.answer })),
        question: q,
      });
      onNewFollowUp({
        id: crypto.randomUUID(),
        question: q,
        answer,
        timestamp: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card flex flex-col p-6">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        💬 Follow up with your interviewer
      </h3>

      <div className="mb-4 max-h-96 space-y-3 overflow-y-auto">
        {followUps.map((f) => (
          <div key={f.id} className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-indigo-600 px-3 py-2 text-xs text-white">
              {f.question}
            </div>
            <div className="w-fit max-w-[95%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {f.answer}
            </div>
          </div>
        ))}
        {followUps.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Ask anything about your attempt: “Why is my sharding strategy wrong?”, “How would the
            reference answer handle failure?”, “What follow-up questions should I expect?”
          </p>
        )}
        {loading && <Spinner label="Interviewer is thinking…" />}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask a follow-up question…"
          className="input"
        />
        <button onClick={send} disabled={loading || !question.trim()} className="btn-primary shrink-0">
          Send
        </button>
      </div>
    </div>
  );
}
