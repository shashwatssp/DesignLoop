// Vercel serverless function (CommonJS, Node runtime).
// POST /api/chat — post-feedback follow-up conversation. Text-only.
// Body: { problem, diagramOutline, notes, codeText, feedback, history, question }
// Returns: { answer: string }

const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const TEXT_ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING" } },
  required: ["answer"],
};

const CHAT_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", continuing a conversation with a candidate about their evaluated LLD/HLD design attempt. You already scored their submission. Be concise (max 200 words), specific, reference their actual design, and when relevant teach the correct approach. Respond ONLY with JSON matching the schema {"answer": string}.`;

function buildGeminiBody(input) {
  const { problem, diagramOutline, notes, codeText, feedback, history, question } = input;
  const text = [
    CHAT_SYSTEM_PROMPT,
    ``,
    `---`,
    ``,
    `PROBLEM TYPE: ${String(problem.type).toUpperCase()}`,
    `TITLE: ${problem.title} (${problem.difficulty})`,
    `DESCRIPTION: ${problem.description}`,
    `REQUIREMENTS:`,
    ...problem.requirements.map((r) => `- ${r}`),
    ``,
    `DIAGRAM OUTLINE (extracted from the candidate's Excalidraw canvas):`,
    diagramOutline || "(canvas was empty)",
    ``,
    `CANDIDATE'S RESPONSE NOTES (typed + dictated):`,
    (notes || "").trim() || "(none)",
    ``,
    `CODE SUBMISSION:`,
    (codeText || "").trim() ? String(codeText).slice(0, 8000) : "(none)",
    ``,
    `YOUR EARLIER FEEDBACK (summary): ${feedback?.summary || "(n/a)"}`,
    `MISSING COMPONENTS YOU FLAGGED: ${(feedback?.missingComponents || []).join("; ") || "(none)"}`,
    ``,
    `CANDIDATE'S QUESTION: ${question}`,
  ].join("\n");

  const contents = [];
  for (const h of history || []) {
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
    const { problem, diagramOutline, notes, codeText, feedback, history, question } = req.body || {};
    if (!problem || !question) {
      res.status(400).json({ error: "Missing problem or question in request body" });
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
      body: JSON.stringify(buildGeminiBody({ problem, diagramOutline, notes, codeText, feedback, history, question })),
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
    res.status(500).json({ error: (err && err.message) || "Chat request failed" });
  }
};
