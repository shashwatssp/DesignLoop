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
type PanelTab = "interviewer" | "response";
type InterviewerTurn = { question: string; answer: string };

const CHAT_SUGGESTIONS = [
  "What am I missing so far?",
  "Is my approach on the right track?",
  "What would you probe next?",
];

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
  const [panelTab, setPanelTab] = useState<PanelTab>("response");
  const [briefOpen, setBriefOpen] = useState(true);
  const [interviewerTurns, setInterviewerTurns] = useState<InterviewerTurn[]>([]);
  const [interviewerQuestion, setInterviewerQuestion] = useState("");
  const [askingInterviewer, setAskingInterviewer] = useState(false);
  const [unreadInterviewer, setUnreadInterviewer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const speech = useSpeechRecognition(getPrefs().transcriptLang);
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const threadEndRef = useRef<HTMLDivElement | null>(null);

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

  // ---- auto-scroll the interviewer thread ----
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [interviewerTurns, askingInterviewer]);

  // ---- toast auto-dismiss ----
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

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

  // ---------- diagram export helpers ----------

  const buildPngBlob = useCallback(async (): Promise<Blob | undefined> => {
    const api = excalidrawRef.current;
    if (!api) return undefined;
    const elements = api.getSceneElements();
    if (!elements || elements.length === 0) return undefined;
    return exportToBlob({
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
  }, []);

  const buildPngBase64 = useCallback(async (): Promise<string | undefined> => {
    const blob = await buildPngBlob();
    if (!blob) return undefined;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, [buildPngBlob]);

  /** Full review prompt for pasting into ChatGPT / Claude. */
  const buildReviewPrompt = useCallback((): string => {
    if (!problem) return "";
    const lines = [
      `You are a senior engineering interviewer at a top product company. Evaluate my ${problem.type.toUpperCase()} interview attempt below.`,
      ``,
      `## Problem: ${problem.title} (${problem.difficulty})`,
      problem.description,
      ``,
      `## Requirements`,
      ...problem.requirements.map((r) => `- ${r}`),
    ];
    if (notes.trim()) lines.push(``, `## My explanation (typed + spoken)`, notes.trim());
    if (codeText.trim())
      lines.push(``, `## My code`, "```", codeText.trim(), "```");
    lines.push(
      ``,
      `My diagram is attached as an image (exported from my canvas). If you cannot see the image, ask me for it.`,
      ``,
      `Evaluate like a real interviewer: give an overall score out of 10, what I did well, what is missing or wrong, how well I communicated, and a prioritized list of improvements. Do not use em dashes.`
    );
    return lines.join("\n");
  }, [problem, notes, codeText]);

  const handleExport = useCallback(
    async (kind: "prompt" | "png" | "md") => {
      setExportOpen(false);
      try {
        if (kind === "prompt") {
          await navigator.clipboard.writeText(buildReviewPrompt());
          setToast("Review prompt copied. Paste it into ChatGPT or Claude and attach the PNG.");
          return;
        }
        if (kind === "png") {
          const blob = await buildPngBlob();
          if (!blob) {
            setToast("Canvas is empty, nothing to export.");
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${problem?.id ?? "design"}-diagram.png`;
          link.click();
          URL.revokeObjectURL(url);
          setToast("Diagram downloaded.");
          return;
        }
        if (kind === "md") {
          const md = `${buildReviewPrompt()}\n\n---\n\nAttach the diagram PNG you download alongside this file.`;
          const blob = new Blob([md], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${problem?.id ?? "design"}-attempt.md`;
          link.click();
          URL.revokeObjectURL(url);
          setToast("Attempt exported as Markdown.");
        }
      } catch {
        setToast("Export failed, try again.");
      }
    },
    [buildReviewPrompt, buildPngBlob, problem]
  );

  // ---------- final submission ----------

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

  // ---------- interviewer chat ----------

  const handleAskInterviewer = useCallback(
    async (override?: string) => {
      if (!problem || askingInterviewer || submitting) return;
      const question = (override ?? interviewerQuestion).trim() ||
        "Review my progress so far and give me hints.";
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
          question,
          history: interviewerTurns,
        });
        setInterviewerTurns((t) => [...t, { question, answer }]);
        setInterviewerQuestion("");
        if (panelTab !== "interviewer") setUnreadInterviewer(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Interviewer is unavailable, try again");
      } finally {
        setAskingInterviewer(false);
      }
    },
    [problem, notes, codeText, interviewerQuestion, interviewerTurns, askingInterviewer, submitting, panelTab]
  );

  const switchTab = (tab: PanelTab) => {
    setPanelTab(tab);
    if (tab === "interviewer") setUnreadInterviewer(false);
  };

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
    <div
      className="fixed inset-x-0 bottom-0 top-14 flex flex-col lg:flex-row"
      style={{ height: "calc(100dvh - 3.5rem)" }}
    >
      {/* ---------- Left: canvas / code ---------- */}
      <section className="flex h-[42vh] shrink-0 flex-col border-b border-slate-200 dark:border-slate-800 lg:h-auto lg:min-h-0 lg:flex-1 lg:border-b-0">
        <div className="flex shrink-0 items-center gap-1 bg-white px-3 py-1.5 dark:bg-slate-900">
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
          <div className="relative ml-auto">
            <button
              onClick={() => setExportOpen((o) => !o)}
              className="btn-secondary px-3 py-1 text-xs"
            >
              ⤓ Export
            </button>
            {exportOpen && (
              <>
                <button
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setExportOpen(false)}
                  aria-label="Close export menu"
                />
                <div className="card absolute right-0 z-50 mt-1 w-72 p-1.5 text-sm shadow-lg">
                  <button
                    onClick={() => handleExport("prompt")}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    📋 Copy AI review prompt
                    <span className="mt-0.5 block text-[10px] text-slate-400">
                      Paste into ChatGPT or Claude, then attach the PNG
                    </span>
                  </button>
                  <button
                    onClick={() => handleExport("png")}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    🖼 Download diagram (PNG)
                  </button>
                  <button
                    onClick={() => handleExport("md")}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    📄 Download attempt (.md)
                  </button>
                </div>
              </>
            )}
          </div>
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

      {/* ---------- Right: focused interactive panel ---------- */}
      <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-900 lg:w-[400px] lg:flex-none lg:border-l lg:border-slate-200 lg:dark:border-slate-800">
        {/* header: title, timer, brief */}
        <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-sm font-semibold">{problem.title}</h2>
            <Timer endsAt={endsAt} running={!submitting} onExpire={handleExpire} />
          </div>
          <button
            onClick={() => setBriefOpen((o) => !o)}
            className="mt-0.5 text-xs text-indigo-500 hover:underline"
          >
            {briefOpen ? "Hide problem brief" : "Read the problem brief"}
          </button>
          {briefOpen && (
            <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-300">
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

        {/* tabs */}
        <div className="flex shrink-0 gap-1 border-b border-slate-200 px-3 pt-2 dark:border-slate-800">
          {(
            [
              ["interviewer", "💬 Interviewer"],
              ["response", "📝 Response"],
            ] as [PanelTab, string][]
          ).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className={`relative rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                panelTab === tab
                  ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-300"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {label}
              {tab === "interviewer" && unreadInterviewer && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
              )}
            </button>
          ))}
        </div>

        {/* Interviewer tab: chat thread */}
        {panelTab === "interviewer" && (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {interviewerTurns.map((turn, i) => (
                <div key={i} className="space-y-2">
                  <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-indigo-600 px-3 py-2 text-xs text-white">
                    {turn.question}
                  </div>
                  <div className="w-fit max-w-[95%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                    {turn.answer}
                  </div>
                </div>
              ))}
              {interviewerTurns.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Your interviewer is watching the canvas. Ask anything, or tap a shortcut:
                  </p>
                  <div className="flex flex-col items-stretch gap-2">
                    {CHAT_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleAskInterviewer(s)}
                        disabled={askingInterviewer}
                        className="rounded-full border border-slate-300 px-4 py-1.5 text-xs text-slate-600 transition-colors hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {askingInterviewer && <Spinner label="Interviewer is reviewing your canvas…" />}
              <div ref={threadEndRef} />
            </div>

            {/* chat input (pinned) */}
            <div className="shrink-0 space-y-2 border-t border-slate-200 p-3 dark:border-slate-800">
              {error && <ErrorBox message={error} />}
              <div className="flex gap-2">
                <input
                  value={interviewerQuestion}
                  onChange={(e) => setInterviewerQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAskInterviewer()}
                  placeholder="Ask the interviewer…"
                  className="input flex-1"
                />
                <button
                  onClick={() => handleAskInterviewer()}
                  disabled={askingInterviewer || submitting}
                  className="btn-primary shrink-0"
                >
                  Ask
                </button>
              </div>
            </div>
          </>
        )}

        {/* Response tab: capture studio */}
        {panelTab === "response" && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {error && <ErrorBox message={error} />}
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
              placeholder="Explain your design, assumptions and trade-offs. Whatever you speak is written here."
              className="input min-h-[220px] resize-none"
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              {speech.supported
                ? "Tap the mic and speak. Everything in this box is sent to the interviewer when you submit."
                : "This box is sent to the interviewer when you submit."}
            </p>
          </div>
        )}

        {/* pinned submit bar (visible from both tabs) */}
        <div className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <button onClick={handleSubmit} disabled={submitting} className="btn-primary w-full">
            🏁 Submit final design
          </button>
        </div>
      </aside>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-2.5 text-xs text-white shadow-xl dark:bg-slate-100 dark:text-slate-900">
          {toast}
        </div>
      )}

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
