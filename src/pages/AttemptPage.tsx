import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { ErrorBox, Spinner } from "../components/Loading";
import Timer from "../components/Timer";
import { getProblemById } from "../data/problems";
import { useTheme } from "../hooks/useTheme";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import {
  extractDiagramOutline,
  requestFeedback,
  requestInterviewerTurn,
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
type ChatTurn = { question: string; answer: string; readyToEvaluate?: boolean };

const GREETING =
  "Hi, I am your DesignLoop interviewer. Build your design on the canvas (switch to Code mode for schemas and classes), then walk me through it. Speak with the mic or type: I reply right here with hints and probing questions. When we both feel it is complete, end the interview and I will score the full attempt.";

export default function AttemptPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialScene, setInitialScene] = useState<ExcalidrawInitialDataState | undefined>();
  const [codeText, setCodeText] = useState("");
  const [mode, setMode] = useState<Mode>("diagram");
  const [briefOpen, setBriefOpen] = useState(true);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [draftMessage, setDraftMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const speech = useSpeechRecognition(getPrefs().transcriptLang);
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  // Refs mirroring latest state for savers that must not go stale.
  const attemptRef = useRef<Attempt | null>(null);
  attemptRef.current = attempt;
  const codeRef = useRef("");
  codeRef.current = codeText;
  const turnsRef = useRef<ChatTurn[]>([]);
  turnsRef.current = chatTurns;

  // ---- load attempt + draft recovery (canvas, code, chat) ----
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
      if (draft?.codeText) setCodeText(draft.codeText);
      else if (a.codeText) setCodeText(a.codeText);
      if (draft?.chatTurns?.length) setChatTurns(draft.chatTurns);
      else if (a.chatTurns?.length) setChatTurns(a.chatTurns);
      const scene = draft?.scene ?? (a.sceneJson ? safeParseScene(a.sceneJson) : undefined);
      if (scene) setInitialScene({ elements: scene as ExcalidrawInitialDataState["elements"] });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  function safeParseScene(sceneJson: string): unknown {
    try {
      const parsed = JSON.parse(sceneJson);
      return Array.isArray(parsed) ? parsed : parsed?.elements;
    } catch {
      return undefined;
    }
  }

  // ---- persistence: draft save (canvas + code + chat), debounced or immediate ----
  const draftTimerRef = useRef<number | null>(null);
  const scheduleDraftSave = useCallback((immediate = false) => {
    const run = () => {
      const a = attemptRef.current;
      if (!a) return;
      saveDraft(
        a.id,
        a.problemId,
        excalidrawRef.current?.getSceneElements() ?? [],
        codeRef.current,
        turnsRef.current
      );
    };
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
    if (immediate) run();
    else draftTimerRef.current = window.setTimeout(run, 800);
  }, []);

  const handleCanvasChange = useCallback(() => scheduleDraftSave(), []);

  // Save immediately when leaving the page or hiding the tab.
  useEffect(() => {
    const onLeave = () => scheduleDraftSave(true);
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("visibilitychange", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
    };
  }, [scheduleDraftSave]);

  // Keep drafts fresh when code text changes.
  useEffect(() => {
    if (!attempt || submitting) return;
    scheduleDraftSave();
  }, [codeText, attempt, submitting, scheduleDraftSave]);

  // ---- mic dictation flows into the chat input ----
  useEffect(() => {
    if (speech.finalText) {
      setDraftMessage((prev) =>
        prev.trimEnd() ? `${prev.trimEnd()} ${speech.finalText}` : speech.finalText
      );
      speechRef.current.reset();
    }
  }, [speech.finalText]);

  // ---- auto-scroll the chat ----
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatTurns, sending]);

  // ---- toast auto-dismiss ----
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

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

  /** Everything the candidate said in the conversation, as the graded response. */
  const responseTranscript = useMemo(
    () =>
      chatTurns
        .map((t) => t.question.trim())
        .filter(Boolean)
        .map((q) => `Me: ${q}`)
        .join("\n\n"),
    [chatTurns]
  );

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
    if (responseTranscript)
      lines.push(``, `## My interview conversation (what I said while designing)`, responseTranscript);
    if (codeText.trim()) lines.push(``, `## My code`, "```", codeText.trim(), "```");
    lines.push(
      ``,
      `My diagram is attached as an image (exported from my canvas). If you cannot see the image, ask me for it.`,
      ``,
      `Evaluate like a real interviewer: give an overall score out of 10, what I did well, what is missing or wrong, how well I communicated, and a prioritized list of improvements. Do not use em dashes.`
    );
    return lines.join("\n");
  }, [problem, responseTranscript, codeText]);

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

  // ---------- ending the interview: one multimodal Gemini call ----------

  const handleSubmit = useCallback(async () => {
    if (!attempt || !problem || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      speechRef.current.stop();
      scheduleDraftSave(true);
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
        notes: responseTranscript,
        codeText,
        chatTurns: chatTurns.map(({ question, answer }) => ({ question, answer })),
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
            notes: responseTranscript,
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
  }, [attempt, problem, codeText, chatTurns, responseTranscript, submitting, navigate, buildPngBase64, scheduleDraftSave]);

  // ---------- interviewer chat ----------

  const handleSend = useCallback(async () => {
    if (!problem || sending || submitting) return;
    const message = draftMessage.trim();
    if (!message) return;
    setDraftMessage("");
    setSending(true);
    setError(null);

    const history: { question: string; answer: string }[] = chatTurns.map(({ question, answer }) => ({
      question,
      answer,
    }));

    // Show the candidate's message immediately.
    setChatTurns((t) => [...t, { question: message, answer: "" }]);
    try {
      const api = excalidrawRef.current;
      const sceneJson = JSON.stringify({ elements: api?.getSceneElements() ?? [] });
      const { answer, readyToEvaluate } = await requestInterviewerTurn({
        problem,
        diagramOutline: extractDiagramOutline(sceneJson),
        notes: history.map((h) => `Me: ${h.question}`).join("\n"),
        codeText,
        question: message,
        history,
      });
      setChatTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { question: message, answer, readyToEvaluate };
        return next;
      });
      // Persist the conversation to IndexedDB immediately (crash/refresh safe).
      const a = attemptRef.current;
      if (a) {
        const updated: Attempt = {
          ...a,
          chatTurns: [...turnsRef.current].map(({ question, answer }) => ({ question, answer })),
        };
        setAttempt(updated);
        await saveAttempt(updated, problem.title);
      }
      scheduleDraftSave(true);
    } catch (err) {
      // Remove the optimistic bubble and restore the input.
      setChatTurns((t) => t.slice(0, -1));
      setDraftMessage(message);
      setError(err instanceof Error ? err.message : "Interviewer is unavailable, try again");
    } finally {
      setSending(false);
    }
  }, [problem, draftMessage, chatTurns, codeText, submitting, scheduleDraftSave]);

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

  const lastTurn = chatTurns[chatTurns.length - 1];
  const readyToEvaluate = !!lastTurn?.readyToEvaluate;

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-14 flex flex-col lg:flex-row"
      style={{ height: "calc(100dvh - 3.5rem)" }}
    >
      {/* ---------- Left: canvas / code (Excalidraw stays mounted, so nothing is ever lost) ---------- */}
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
          <span className="ml-auto pr-2 text-xs text-slate-400 dark:text-slate-500">
            {problem.type.toUpperCase()} · saved automatically
          </span>
          <div className="relative">
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
          <div className={mode === "diagram" ? "h-full w-full" : "hidden"}>
            <Excalidraw
              excalidrawAPI={(api) => {
                excalidrawRef.current = api;
              }}
              initialData={initialScene}
              onChange={handleCanvasChange}
              theme={theme}
              gridModeEnabled={false}
            />
          </div>
          <textarea
            value={codeText}
            onChange={(e) => setCodeText(e.target.value)}
            spellCheck={false}
            placeholder={
              "// Write your class design / SQL schema / pseudocode here.\n// e.g.\n// interface ParkingSpot { assign(v: Vehicle): Ticket; }\n// class FeeCalculator { calculate(ticket: Ticket): number {} }"
            }
            className={`h-full w-full resize-none bg-white p-4 font-mono text-sm leading-relaxed text-slate-800 outline-none dark:bg-slate-950 dark:text-slate-200 ${
              mode === "code" ? "" : "hidden"
            }`}
          />
        </div>
      </section>

      {/* ---------- Right: THE interview (one continuous conversation) ---------- */}
      <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-900 lg:w-[400px] lg:flex-none lg:border-l lg:border-slate-200 lg:dark:border-slate-800">
        {/* header */}
        <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-sm font-semibold">{problem.title}</h2>
            <div className="flex shrink-0 items-center gap-2">
              <Timer endsAt={endsAt} running={!submitting} onExpire={() => handleSubmit()} />
              <button
                onClick={handleSubmit}
                disabled={submitting || sending || chatTurns.length === 0}
                title="End the interview and get your full evaluation"
                className="text-xs font-medium text-amber-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-amber-400"
              >
                ⏱ End &amp; evaluate
              </button>
            </div>
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

        {/* conversation thread */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div className="w-fit max-w-[95%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
            🧑‍💼 {GREETING}
          </div>

          {chatTurns.map((turn, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-indigo-600 px-3 py-2 text-xs text-white">
                {turn.question}
              </div>
              {turn.answer && (
                <div className="w-fit max-w-[95%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                  🧑‍💼 {turn.answer}
                </div>
              )}
              {i === chatTurns.length - 1 && readyToEvaluate && !sending && (
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn-primary w-full text-xs"
                >
                  🏁 Your interviewer says this design is ready. End the interview &amp; get evaluated
                </button>
              )}
            </div>
          ))}

          {sending && <Spinner label="Interviewer is thinking…" />}
          {error && <ErrorBox message={error} />}
          <div ref={threadEndRef} />
        </div>

        {/* pinned chat input (mic + text + send) */}
        <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          {speech.listening && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs italic text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              {speech.interim ? `“${speech.interim}”` : "Listening… speak your design reasoning."}
            </div>
          )}
          {speech.error && <p className="text-xs text-red-500">{speech.error}</p>}
          <div className="flex items-center gap-2">
            {speech.supported && (
              <button
                onClick={speech.listening ? speech.stop : speech.start}
                title={speech.listening ? "Stop dictation" : "Dictate with your voice"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition-colors ${
                  speech.listening
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {speech.listening ? "⏹" : "🎤"}
              </button>
            )}
            <input
              value={draftMessage}
              onChange={(e) => setDraftMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={
                sending
                  ? "Interviewer is replying…"
                  : "Walk me through your design, or ask me anything…"
              }
              className="input flex-1"
              disabled={sending || submitting}
            />
            <button
              onClick={handleSend}
              disabled={sending || submitting || !draftMessage.trim()}
              className="btn-primary shrink-0"
            >
              Send
            </button>
          </div>
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
              <p className="font-semibold">Interviewer is evaluating your full attempt…</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Your diagram, code, and the entire conversation are being reviewed.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
