import type { Feedback, Problem } from "../types";

/**
 * How Gemini is called, in priority order:
 *
 * 1. DIRECT: if VITE_GEMINI_API_KEY is present (set in .env locally, or in
 *    Vercel env vars before building), the browser calls the Gemini REST API
 *    directly. This is the default path on Vercel and in dev.
 * 2. PROXY: otherwise, requests go to the Vercel serverless functions
 *    (/api/feedback, /api/interviewer, /api/chat) which use a server-side
 *    GEMINI_API_KEY. The key then never reaches the browser.
 *
 * Cost discipline:
 * - "Ask Interviewer" (mid-attempt): text-only, 600-token output cap.
 * - Final submit: ONE multimodal call, 2048-token output cap.
 * - Follow-up chat: text-only, 700-token output cap.
 */

const GEMINI_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const DIRECT_KEY: string | undefined = import.meta.env.VITE_GEMINI_API_KEY;

const NO_EM_DASH_RULE = `Never use em dashes (the long dash character) anywhere in your output. Use commas, colons or periods instead.`;

const FEEDBACK_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    overallScore: { type: "NUMBER" },
    dimensionScores: {
      type: "OBJECT",
      properties: {
        requirementsCoverage: {
          type: "OBJECT",
          properties: { score: { type: "NUMBER" }, comment: { type: "STRING" } },
          required: ["score", "comment"],
        },
        componentDesign: {
          type: "OBJECT",
          properties: { score: { type: "NUMBER" }, comment: { type: "STRING" } },
          required: ["score", "comment"],
        },
        scalability: {
          type: "OBJECT",
          properties: { score: { type: "NUMBER" }, comment: { type: "STRING" } },
          required: ["score", "comment"],
        },
        communicationClarity: {
          type: "OBJECT",
          properties: { score: { type: "NUMBER" }, comment: { type: "STRING" } },
          required: ["score", "comment"],
        },
      },
      required: ["requirementsCoverage", "componentDesign", "scalability", "communicationClarity"],
    },
    strengths: { type: "ARRAY", items: { type: "STRING" } },
    missingComponents: { type: "ARRAY", items: { type: "STRING" } },
    gaps: { type: "ARRAY", items: { type: "STRING" } },
    improvements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { priority: { type: "STRING", enum: ["critical", "high", "medium"] }, action: { type: "STRING" } },
        required: ["priority", "action"],
      },
    },
    referenceOutline: { type: "STRING" },
  },
  required: [
    "summary",
    "overallScore",
    "dimensionScores",
    "strengths",
    "missingComponents",
    "gaps",
    "improvements",
    "referenceOutline",
  ],
} as const;

const TEXT_ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING" }, readyToEvaluate: { type: "BOOLEAN" } },
  required: ["answer"],
} as const;

export interface FeedbackRequest {
  problem: Problem;
  attempt: {
    sceneJson: string;
    pngBase64?: string;
    diagramOutline: string;
    notes: string;
    codeText: string;
    durationMs: number;
  };
}

export interface InterviewerRequest {
  problem: Problem;
  diagramOutline: string;
  notes: string;
  codeText: string;
  question: string;
  history: { question: string; answer: string }[];
}

export interface ChatRequest {
  problem: Problem;
  diagramOutline: string;
  notes: string;
  codeText: string;
  feedback: Feedback;
  history: { question: string; answer: string }[];
  question: string;
}

/** Mid-attempt: one conversational turn with the interviewer (cheap, text-only). */
export async function requestInterviewerTurn(
  input: InterviewerRequest
): Promise<{ answer: string; readyToEvaluate: boolean }> {
  const res = await callGemini<{ answer: string; readyToEvaluate?: boolean }>(
    "/api/interviewer",
    input,
    buildInterviewerBody(input)
  );
  return { answer: res.answer, readyToEvaluate: !!res.readyToEvaluate };
}

/** Final submission: full multimodal scored evaluation. */
export async function requestFeedback(input: FeedbackRequest): Promise<Feedback> {
  return callGemini<Feedback>("/api/feedback", input, buildFeedbackBody(input));
}

/** Post-feedback follow-up chat. */
export async function requestFollowUp(input: ChatRequest): Promise<string> {
  const res = await callGemini<{ answer: string }>("/api/chat", input, buildChatBody(input));
  return res.answer;
}

// ---------------- transport ----------------

/**
 * Try the serverless proxy first when no direct key exists; if a direct key
 * exists, skip the proxy entirely and call Gemini straight from the browser.
 * If the proxy fails (e.g. server key missing) but a direct key is available,
 * fall back to the direct call.
 */
async function callGemini<T>(apiPath: string, proxyBody: unknown, directBody: unknown): Promise<T> {
  if (DIRECT_KEY) {
    return callGeminiDirectResilient<T>(directBody, DIRECT_KEY);
  }
  try {
    return await postJson<T>(apiPath, proxyBody);
  } catch (err) {
    if (DIRECT_KEY) return callGeminiDirectResilient<T>(directBody, DIRECT_KEY);
    throw err;
  }
}

/** Models tried in order when the primary is overloaded. */
const MODEL_CHAIN = [GEMINI_MODEL, "gemini-3.7-flash", "gemini-3.5-flash"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NON_RETRYABLE_STATUSES = [400, 401, 403, 404];

function isRetryable(status: number | undefined): boolean {
  if (status && NON_RETRYABLE_STATUSES.includes(status)) return false;
  // Everything else retries: 5xx, 429, network hiccups, and malformed/truncated
  // JSON (no HTTP status, e.g. "Unterminated string in JSON").
  return true;
}

/**
 * Direct call that survives high-demand periods: retries the primary model
 * with backoff, then falls through the MODEL_CHAIN before giving up.
 */
async function callGeminiDirectResilient<T>(body: unknown, apiKey: string): Promise<T> {
  let lastError: unknown;
  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGeminiDirect<T>(body, apiKey, model);
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number })?.status;
        if (!isRetryable(status)) throw err;
        await sleep(1200 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function callGeminiDirect<T>(body: unknown, apiKey: string, model: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Gemini API error (${res.status}): ${text.slice(0, 300)}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new Error("Gemini returned an empty response");
  return parseGeminiJson<T>(text);
}

/** Tolerant JSON extraction: strips code fences and wraps, then parses. */
function parseGeminiJson<T>(raw: string): T {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start > 0 || (end !== -1 && end < text.length - 1)) {
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
  }
  return JSON.parse(text) as T;
}

// ---------------- payload builders (used by the direct path; mirrored in api/*.js) ----------------

function problemBlock(problem: Problem): string[] {
  return [
    `PROBLEM TYPE: ${problem.type.toUpperCase()}`,
    `TITLE: ${problem.title} (${problem.difficulty})`,
    `DESCRIPTION: ${problem.description}`,
    `REQUIREMENTS:`,
    ...problem.requirements.map((r) => `- ${r}`),
  ];
}

function candidateBlock(diagramOutline: string, notes: string, codeText: string): string[] {
  return [
    ``,
    `DIAGRAM OUTLINE (extracted from the candidate's Excalidraw canvas):`,
    diagramOutline || "(canvas was empty)",
    ``,
    `CANDIDATE'S RESPONSE NOTES (typed + dictated):`,
    notes?.trim() || "(none)",
    ``,
    `CODE SUBMISSION:`,
    codeText?.trim() ? codeText.slice(0, 8000) : "(none)",
  ];
}

const FEEDBACK_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", a senior engineering interviewer at a top product company evaluating LLD (low-level design / machine coding) and HLD (high-level system design) interview attempts.

You receive: the problem statement with requirements, an image of the candidate's diagram, their diagram outline, their response notes (typed and dictated), and optional code.

Evaluate like a real interviewer:
- Reference ONLY what is actually visible in the diagram/outline, notes, or code. Never invent components that are not there.
- If the canvas is empty or nearly empty, say so plainly and score low (2-4). A solid complete attempt scores 7-9.
- For LLD problems, judge: class modeling, OOP principles, design patterns (strategy, state, observer, factory), relationships, extensibility, and requirement coverage.
- For HLD problems, judge: component architecture, data flow, storage choices, caching, scaling approach, bottlenecks, trade-offs, and requirement coverage.
- Communication score reflects how well the notes explain the design, assumptions, and trade-offs (spoken or typed).
- Be specific: quote the component names they drew. "You drew an API Gateway but no cache, so reads will hammer the DB" is better than "improve scalability".
- overallScore must be consistent with the dimension scores.

${NO_EM_DASH_RULE}
Respond ONLY with JSON matching the provided schema.`;

function buildFeedbackBody(req: FeedbackRequest) {
  const minutes = Math.round(req.attempt.durationMs / 60000);
  const text = [
    FEEDBACK_SYSTEM_PROMPT,
    ``,
    `---`,
    ``,
    ...problemBlock(req.problem),
    ``,
    `TIME SPENT BY CANDIDATE: ${minutes} minute(s)`,
    ...candidateBlock(req.attempt.diagramOutline, req.attempt.notes, req.attempt.codeText),
  ].join("\n");

  const parts: unknown[] = [{ text }];
  if (req.attempt.pngBase64) {
    parts.push({ inlineData: { mimeType: "image/png", data: req.attempt.pngBase64 } });
  }
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: FEEDBACK_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 4096,
    },
  };
}

const INTERVIEWER_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", a senior engineering interviewer conducting a LIVE LLD/HLD interview. You and the candidate are chatting in real time while they build their design on a shared canvas.

How to behave:
- Sound like a friendly, sharp interviewer. Keep every reply under 120 words.
- Reference their actual canvas contents and the conversation so far. Never invent components that are not there.
- When they share progress: acknowledge specifics first, then give AT MOST 2 gentle hints (nudges toward gaps or risks, never the full answer) and/or ask 1-2 probing questions a real interviewer would ask next.
- When they ask a question: answer it the way a helpful interviewer would in a real interview: short, honest, without giving away the solution.
- Set readyToEvaluate to true ONLY when their design clearly covers the requirements and further chatting would add little. Never set it true before they have shared a meaningful design.
- Do NOT score. Do NOT give the complete solution.

${NO_EM_DASH_RULE}
Respond ONLY with JSON matching the schema {"answer": string, "readyToEvaluate": boolean}.`;

function buildInterviewerBody(req: InterviewerRequest) {
  const text = [
    INTERVIEWER_SYSTEM_PROMPT,
    ``,
    `---`,
    ``,
    ...problemBlock(req.problem),
    ...candidateBlock(req.diagramOutline, req.notes, req.codeText),
    ``,
    `CANDIDATE'S MESSAGE: ${req.question?.trim() || "Review my progress so far and give me hints."}`,
  ].join("\n");

  const contents: unknown[] = [];
  for (const h of req.history) {
    contents.push({ role: "user", parts: [{ text: h.question }] });
    contents.push({ role: "model", parts: [{ text: h.answer }] });
  }
  contents.push({ role: "user", parts: [{ text }] });

  return {
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: TEXT_ANSWER_SCHEMA,
      temperature: 0.6,
      maxOutputTokens: 900,
    },
  };
}

const CHAT_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", continuing a conversation with a candidate about their evaluated LLD/HLD design attempt. You already scored their submission. Be concise (max 200 words), specific, reference their actual design, and when relevant teach the correct approach.

${NO_EM_DASH_RULE}
Respond ONLY with JSON matching the schema {"answer": string}.`;

function buildChatBody(req: ChatRequest) {
  const text = [
    CHAT_SYSTEM_PROMPT,
    ``,
    `---`,
    ``,
    ...problemBlock(req.problem),
    ...candidateBlock(req.diagramOutline, req.notes, req.codeText),
    ``,
    `YOUR EARLIER FEEDBACK (summary): ${req.feedback.summary}`,
    `MISSING COMPONENTS YOU FLAGGED: ${req.feedback.missingComponents.join("; ") || "(none)"}`,
    ``,
    `CANDIDATE'S QUESTION: ${req.question}`,
  ].join("\n");

  const contents: unknown[] = [];
  for (const h of req.history) {
    contents.push({ role: "user", parts: [{ text: h.question }] });
    contents.push({ role: "model", parts: [{ text: h.answer }] });
  }
  contents.push({ role: "user", parts: [{ text }] });

  return {
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: TEXT_ANSWER_SCHEMA,
      temperature: 0.6,
      maxOutputTokens: 1200,
    },
  };
}

/** Extract a human-readable outline (labels + shape counts) from an Excalidraw scene JSON. */
export function extractDiagramOutline(sceneJson: string): string {
  try {
    const parsed = JSON.parse(sceneJson);
    const elements = Array.isArray(parsed) ? parsed : parsed?.elements;
    if (!Array.isArray(elements) || elements.length === 0) return "(canvas was empty)";
    const counts = new Map<string, number>();
    const labels: string[] = [];
    for (const el of elements) {
      if (!el || el.isDeleted) continue;
      counts.set(el.type, (counts.get(el.type) ?? 0) + 1);
      if (el.type === "text" && typeof el.text === "string" && el.text.trim()) {
        labels.push(el.text.trim().replace(/\s+/g, " ").slice(0, 80));
      }
      if (el.type === "arrow" && el?.label?.text) labels.push(`[arrow label] ${el.label.text}`);
      if ((el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") && el?.label?.text) {
        labels.push(`[${el.type} label] ${el.label.text}`);
      }
    }
    const shapeSummary = [...counts.entries()].map(([t, c]) => `${c} ${t}(s)`).join(", ");
    return `Shapes: ${shapeSummary}. Labels/text found: ${labels.slice(0, 60).join(" | ") || "(none)"}`;
  } catch {
    return "(could not parse canvas)";
  }
}
