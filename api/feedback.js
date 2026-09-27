// Vercel serverless function (CommonJS, Node runtime).
// Keeps GEMINI_API_KEY server-side. POST /api/feedback
// Body: { problem, attempt: { sceneJson, pngBase64?, diagramOutline, notes, codeText, durationMs } }
// Returns the structured Feedback JSON.

const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
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
        properties: {
          priority: { type: "STRING", enum: ["critical", "high", "medium"] },
          action: { type: "STRING" },
        },
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
};

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

function buildGeminiBody(input) {
  const { problem, attempt } = input;
  const minutes = Math.round((attempt.durationMs || 0) / 60000);
  const text = [
    FEEDBACK_SYSTEM_PROMPT,
    ``,
    `---`,
    ``,
    `PROBLEM TYPE: ${String(problem.type).toUpperCase()}`,
    `TITLE: ${problem.title} (${problem.difficulty})`,
    `DESCRIPTION: ${problem.description}`,
    `REQUIREMENTS:`,
    ...problem.requirements.map((r) => `- ${r}`),
    ``,
    `TIME SPENT BY CANDIDATE: ${minutes} minute(s)`,
    ``,
    `DIAGRAM OUTLINE (extracted from the candidate's Excalidraw canvas):`,
    attempt.diagramOutline || "(canvas was empty)",
    ``,
    `CANDIDATE'S RESPONSE NOTES (typed + dictated):`,
    (attempt.notes || "").trim() || "(none)",
    ``,
    `CODE SUBMISSION:`,
    (attempt.codeText || "").trim() ? String(attempt.codeText).slice(0, 8000) : "(none)",
  ].join("\n");

  const parts = [{ text }];
  const png = (attempt.pngBase64 || "").replace(/^data:image\/\w+;base64,/, "");
  if (png) {
    parts.push({ inlineData: { mimeType: "image/png", data: png } });
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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { problem, attempt } = req.body || {};
    if (!problem || !attempt) {
      res.status(400).json({ error: "Missing problem or attempt in request body" });
      return;
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
      return;
    }
    const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;

    const r = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiBody({ problem, attempt })),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini error ${r.status}`;
      res.status(502).json({ error: msg });
      return;
    }
    const text = ((data?.candidates?.[0]?.content?.parts ?? []) || [])
      .map((p) => p.text || "")
      .join("");
    if (!text) {
      res.status(502).json({ error: "Gemini returned an empty response" });
      return;
    }
    res.status(200).json(JSON.parse(text));
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || "Failed to generate feedback" });
  }
};
