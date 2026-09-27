// Vercel serverless function (CommonJS, Node runtime).
// POST /api/interviewer, mid-attempt interviewer hints. Text-only and cheap.
// Body: { problem, diagramOutline, notes, codeText, history: [{question, answer}] }
// Returns: { answer: string }

const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const TEXT_ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING" } },
  required: ["answer"],
};

const INTERVIEWER_SYSTEM_PROMPT = `You are "DesignLoop Interviewer", a senior engineering interviewer conducting a LIVE LLD/HLD interview. The candidate shares their progress so far (diagram outline, notes, code) and often asks you a question or requests hints.

Respond as an interviewer would mid-interview:
- Briefly acknowledge what they have done well so far (1-2 sentences, reference their actual components).
- Answer their question if they asked one.
- Give AT MOST 2 gentle hints, nudges toward gaps or risks, never the full answer (e.g., "What happens if two requests claim the same resource at once?").
- Ask 1-2 probing questions a real interviewer would ask next.
- Do NOT score. Do NOT give the complete solution. Keep the whole response under 150 words.

Never use em dashes (the long dash character) anywhere in your output. Use commas, colons or periods instead.
Respond ONLY with JSON matching the schema {"answer": string}.`;

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
