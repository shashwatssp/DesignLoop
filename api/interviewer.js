// Vercel serverless function (CommonJS, Node runtime).
// POST /api/interviewer, mid-attempt interviewer hints. Text-only and cheap.
// Body: { problem, diagramOutline, notes, codeText, history: [{question, answer}] }
// Returns: { answer: string }

const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const TEXT_ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING" }, readyToEvaluate: { type: "BOOLEAN" } },
  required: ["answer"],
};

const INTERVIEWER_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", a senior engineering interviewer conducting a LIVE LLD/HLD interview. You and the candidate are chatting in real time while they build their design on a shared canvas.

How to behave:
- Sound like a friendly, sharp interviewer. Keep every reply under 120 words.
- Reference their actual canvas contents and the conversation so far. Never invent components that are not there.
- When they share progress: acknowledge specifics first, then give AT MOST 2 gentle hints (nudges toward gaps or risks, never the full answer) and/or ask 1-2 probing questions a real interviewer would ask next.
- When they ask a question: answer it the way a helpful interviewer would in a real interview: short, honest, without giving away the solution.
- Set readyToEvaluate to true ONLY when their design clearly covers the requirements and further chatting would add little. Never set it true before they have shared a meaningful design.
- Do NOT score. Do NOT give the complete solution.

Never use em dashes (the long dash character) anywhere in your output. Use commas, colons or periods instead.
Respond ONLY with JSON matching the schema {"answer": string, "readyToEvaluate": boolean}.`;

function buildGeminiBody(input) {
  const { problem, diagramOutline, notes, codeText, question, history } = input;
  const text = [
    INTERVIEWER_SYSTEM_PROMPT,
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
    `CANDIDATE'S MESSAGE: ${(question || "").trim() || "Review my progress so far and give me hints."}`,
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
      maxOutputTokens: 600,
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
    const { problem, diagramOutline, notes, codeText, question, history } = req.body || {};
    if (!problem) {
      res.status(400).json({ error: "Missing problem in request body" });
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
      body: JSON.stringify(buildGeminiBody({ problem, diagramOutline, notes, codeText, question, history })),
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
    res.status(500).json({ error: (err && err.message) || "Interviewer request failed" });
  }
};
