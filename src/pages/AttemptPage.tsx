import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { ErrorBox, Spinner } from "../components/Loading";
import MicButton from "../components/MicButton";
import Timer from "../components/Timer";
import { getProblemById } from "../data/problems";
import { useTheme } from "../hooks/useTheme";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import {
  extractDiagramOutline,
  requestFeedback,
  requestInterviewerHints,
} from "../lib/gemini";
import {
  clearDraft,
  getAttempt,
  getDraft,
  getPrefs,
  saveAttempt,
  saveDraft,
} from "../lib/storage";
import type { Attempt, Feedback, Problem } from "../types";

type Mode = "diagram" | "code";
type InterviewerTurn = { question: string; answer: string };

export default function AttemptPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialScene, setInitialScene] = useState<ExcalidrawInitialDataState | undefined>();
  const [notes, setNotes] = useState("");
  const [codeText, setCodeText] = useState("");
  const [mode, setMode] = useState<Mode>("diagram");
  const [briefOpen, setBriefOpen] = useState(true);
  const [interviewerTurns, setInterviewerTurns] = useState<InterviewerTurn[]>([]);
  const [askingInterviewer, setAskingInterviewer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const speech = useSpeechRecognition(getPrefs().transcriptLang);
  const speechRef = useRef(speech);
  speechRef.current = speech;

  // ---- load attempt + draft recovery ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!attemptId) return;
      const a = await getAttempt(attemptId);
      if (!a) {
        setLoading(false);
        return;
      }
      const p = getProblemById(a.problemId);
      const draft = getDraft(attemptId);
      if (cancelled) return;
      setAttempt(a);
      setProblem(p ?? null);
      if (draft?.notes) setNotes(draft.notes);
      if (draft?.codeText) setCodeText(draft.codeText);
      if (draft?.scene)
        setInitialScene({ elements: draft.scene as ExcalidrawInitialDataState["elements"] });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  // ---- mic dictation flows into the response box ----
  useEffect(() => {
    if (speech.finalText) {
      setNotes((prev) => (prev.trimEnd() ? `${prev.trimEnd()} ${speech.finalText}` : speech.finalText));
      speechRef.current.reset();
    }
  }, [speech.finalText]);

  // ---- debounced draft save ----
  useEffect(() => {
    if (!attempt || submitting) return;
    const t = setTimeout(() => {
      saveDraft(
        attempt.id,
        attempt.problemId,
        excalidrawRef.current?.getSceneElements() ?? [],
        notes,
        codeText
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [attempt, notes, codeText, submitting]);

  const endsAt = useMemo(
    () => (attempt && problem ? attempt.startedAt + problem.timeLimitMin * 60_000 : 0),
    [attempt, problem]
  );

  const buildPngBase64 = useCallback(async (): Promise<string | undefined> => {
    const api = excalidrawRef.current;
    if (!api) return undefined;
    const elements = api.getSceneElements();
    if (!elements || elements.length === 0) return undefined;
    const blob = await exportToBlob({
      elements,
      appState: {
        ...api.getAppState(),
        exportWithDarkMode: false,
        viewBackgroundColor: "#ffffff",
      },
      files: api.getFiles(),
      mimeType: "image/png",
      exportPadding: 24,
    });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  // ---- final submission: one multimodal Gemini call ----
  const handleSubmit = useCallback(async () => {
    if (!attempt || !problem || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      speechRef.current.stop();
      const api = excalidrawRef.current;
      const elements = api?.getSceneElements() ?? [];
      const sceneJson =
        elements.length > 0
          ? JSON.stringify({ type: "excalidraw", elements, files: api?.getFiles() ?? {} })
          : attempt.sceneJson;
      const pngBase64 = await buildPngBase64();
      const submitted: Attempt = {
        ...attempt,
        sceneJson,
        pngBase64,
        notes,
        codeText,
        endedAt: Date.now(),
        durationMs: Date.now() - attempt.startedAt,
      };
      await saveAttempt(submitted, problem.title);

      let feedback: Feedback;
      try {
        feedback = await requestFeedback({
          problem,
          attempt: {
            sceneJson,
            pngBase64,
            diagramOutline: extractDiagramOutline(sceneJson),
            notes,
            codeText,
            durationMs: submitted.durationMs,
          },
        });
      } catch (geminiErr) {
        // Keep the submission, but surface the error with a retry path on the feedback page.
        await saveAttempt(submitted, problem.title);
        clearDraft(attempt.id);
        navigate(`/feedback/${attempt.id}?pending=1`);
        throw geminiErr;
      }

      const final: Attempt = { ...submitted, feedback };
      await saveAttempt(final, problem.title);
      clearDraft(attempt.id);
      navigate(`/feedback/${attempt.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit for feedback");
      setSubmitting(false);
    }
  }, [attempt, problem, notes, codeText, submitting, navigate, buildPngBase64]);

  const handleExpire = useCallback(() => {
    if (getPrefs().autoSubmit) handleSubmit();
  }, [handleSubmit]);

  // ---- mid-attempt interviewer hints (cheap, text-only) ----
  const handleAskInterviewer = useCallback(async () => {
    if (!problem || askingInterviewer || submitting) return;
    setAskingInterviewer(true);
    setError(null);
    try {
      const api = excalidrawRef.current;
      const sceneJson = JSON.stringify({ elements: api?.getSceneElements() ?? [] });
      const answer = await requestInterviewerHints({
        problem,
        diagramOutline: extractDiagramOutline(sceneJson),
        notes,
        codeText,
        history: interviewerTurns,
      });
      setInterviewerTurns((t) => [...t, { question: "Review my progress so far", answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Interviewer is unavailable, try again");
    } finally {
      setAskingInterviewer(false);
    }
  }, [problem, notes, codeText, interviewerTurns, askingInterviewer, submitting]);

  // ---- loading / not found ----
  if (loading) return <Spinner label="Loading attempt…" />;
  if (!attempt || !problem) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-slate-500">Attempt not found.</p>
        <a href="/" className="btn-primary">
          Back to library
        </a>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 flex flex-col lg:flex-row">
      {/* ---------- Left: canvas / code ---------- */}
      <section className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
          {(
            [
              ["diagram", "✏️ Diagram"],
              ["code", "</> Code"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto pr-2 text-xs text-slate-400 dark:text-slate-500">
            {problem.type.toUpperCase()} · auto-saved
          </span>
        </div>

        <div className="min-h-0 flex-1">
          {mode === "diagram" ? (
            <div className="h-full w-full">
              <Excalidraw
                excalidrawAPI={(api) => {
                  excalidrawRef.current = api;
                }}
                initialData={initialScene}
                theme={theme}
                gridModeEnabled={false}
              />
            </div>
          ) : (
            <textarea
              value={codeText}
              onChange={(e) => setCodeText(e.target.value)}
              spellCheck={false}
              placeholder={
                "// Write your class design / SQL schema / pseudocode here.\n// e.g.\n// interface ParkingSpot { assign(v: Vehicle): Ticket; }\n// class FeeCalculator { calculate(ticket: Ticket): number {} }"
              }
              className="h-full w-full resize-none bg-white p-4 font-mono text-sm leading-relaxed text-slate-800 outline-none dark:bg-slate-950 dark:text-slate-200"
            />
          )}
        </div>
      </section>

      {/* ---------- Right: interactive panel ---------- */}
      <aside className="flex w-full shrink-0 flex-col border-l border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 lg:w-[360px]">
        {/* problem + timer */}
        <div className="border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-sm font-semibold">{problem.title}</h2>
            <Timer endsAt={endsAt} running={!submitting} onExpire={handleExpire} />
          </div>
          <button
            onClick={() => setBriefOpen((o) => !o)}
            className="mt-1 text-xs text-indigo-500 hover:underline"
          >
            {briefOpen ? "Hide problem brief" : "Read the problem brief"}
          </button>
          {briefOpen && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              <p className="mb-2">{problem.description}</p>
              <p className="mb-1 font-semibold text-slate-500 dark:text-slate-400">Requirements:</p>
              <ul className="space-y-1">
                {problem.requirements.map((r) => (
                  <li key={r} className="flex gap-1.5">
                    <span className="text-indigo-500">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* interviewer thread */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {interviewerTurns.map((turn, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-indigo-600 px-3 py-2 text-xs text-white">
                {turn.question}
              </div>
              <div className="w-fit max-w-[95%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                🎤 {turn.answer}
              </div>
            </div>
          ))}
          {askingInterviewer && <Spinner label="Interviewer is reviewing your progress…" />}
        </div>

        {/* response box + actions */}
        <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Your response — speak or type
          </label>
          <MicButton
            supported={speech.supported}
            listening={speech.listening}
            interim={speech.interim}
            onStart={speech.start}
            onStop={speech.stop}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Explain your design, assumptions and trade-offs… whatever you speak is written here. You can also type."
            className="input resize-y"
          />
          {speech.error && <p className="text-xs text-red-500">{speech.error}</p>}

          {error && <ErrorBox message={error} />}

          <div className="flex flex-col gap-2">
            <button
              onClick={handleAskInterviewer}
              disabled={askingInterviewer || submitting}
              className="btn-secondary"
            >
              💬 Ask the interviewer for hints
            </button>
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
              🏁 Submit final design
            </button>
          </div>
        </div>
      </aside>

      {/* submitting overlay */}
      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="card flex flex-col items-center gap-4 p-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <div className="text-center">
              <p className="font-semibold">Interviewer is evaluating your design…</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Analyzing your diagram, notes, and code. This usually takes a few seconds.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
