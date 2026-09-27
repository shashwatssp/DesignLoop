import type { Feedback, Problem } from "../types";

/**
 * Minimal-cost Gemini usage:
 * - "Ask Interviewer" (mid-attempt hints): TEXT-ONLY, tiny output (600 tokens). No image sent.
 * - Final submit: ONE multimodal call (diagram PNG + everything). Output capped at 2048 tokens.
 * - Follow-up chat: text-only, small output (700 tokens).
 *
 * In production the browser talks only to our Vercel serverless functions —
 * the Gemini API key never reaches the client. In dev (`vite dev`), /api routes
 * don't exist, so we fall back to direct Gemini REST calls using
 * VITE_GEMINI_API_KEY from .env. This mirrors api/*.js.
 */

const GEMINI_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

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
  properties: { answer: { type: "STRING" } },
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

/** Mid-attempt: cheap text-only interviewer hints. */
export async function requestInterviewerHints(input: InterviewerRequest): Promise<string> {
  if (!import.meta.env.DEV) {
    const res = await postJson<{ answer: string }>("/api/interviewer", input);
    return res.answer;
  }
  try {
    const res = await postJson<{ answer: string }>("/api/interviewer", input);
    return res.answer;
  } catch (err) {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) throw err;
    const data = await callGeminiDirect(buildInterviewerBody(input), key);
    return (data as { answer?: string })?.answer ?? "";
  }
}

/** Final submission: full multimodal scored evaluation. */
export async function requestFeedback(input: FeedbackRequest): Promise<Feedback> {
  if (!import.meta.env.DEV) {
    return postJson<Feedback>("/api/feedback", input);
  }
  try {
    return await postJson<Feedback>("/api/feedback", input);
  } catch (err) {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) throw err;
    return (await callGeminiDirect(buildFeedbackBody(input), key)) as Feedback;
  }
}

/** Post-feedback follow-up chat. */
export async function requestFollowUp(input: ChatRequest): Promise<string> {
  if (!import.meta.env.DEV) {
    const res = await postJson<{ answer: string }>("/api/chat", input);
    return res.answer;
  }
  try {
    const res = await postJson<{ answer: string }>("/api/chat", input);
    return res.answer;
  } catch (err) {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) throw err;
    const data = await callGeminiDirect(buildChatBody(input), key);
    return (data as { answer?: string })?.answer ?? "";
  }
}

// ---------------- payload builders ----------------

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
- Be specific: quote the component names they drew. "You drew an API Gateway but no cache — reads will hammer the DB" is better than "improve scalability".
- overallScore must be consistent with the dimension scores.

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
      maxOutputTokens: 2048,
    },
  };
}

const INTERVIEWER_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", a senior engineering interviewer conducting a LIVE LLD/HLD interview. The candidate shares their progress so far (diagram outline, notes, code).

Respond as an interviewer would mid-interview:
- Briefly acknowledge what they have done well so far (1-2 sentences, reference their actual components).
- Give AT MOST 2 gentle hints — nudges toward gaps or risks, never the full answer (e.g., "What happens if two requests claim the same resource at once?").
- Ask 1-2 probing questions a real interviewer would ask next.
- Do NOT score. Do NOT give the complete solution. Keep the whole response under 150 words.

Respond ONLY with JSON matching the schema {"answer": string}.`;

function buildInterviewerBody(req: InterviewerRequest) {
  const text = [
    INTERVIEWER_SYSTEM_PROMPT,
    ``,
    `---`,
    ``,
    ...problemBlock(req.problem),
    ...candidateBlock(req.diagramOutline, req.notes, req.codeText),
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
      maxOutputTokens: 600,
    },
  };
}

const CHAT_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", continuing a conversation with a candidate about their evaluated LLD/HLD design attempt. You already scored their submission. Be concise (max 200 words), specific, reference their actual design, and when relevant teach the correct approach. Respond ONLY with JSON matching the schema {"answer": string}.`;

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
      maxOutputTokens: 700,
    },
  };
}

async function callGeminiDirect(body: unknown, apiKey: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  return JSON.parse(text);
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
