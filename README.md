# DesignLoop

Practice **Low-Level Design (LLD)** and **High-Level Design (HLD)** interview problems with an
Excalidraw-style canvas, voice dictation, and interviewer-grade **AI feedback** powered by Gemini.

Built for engineers with ~2 years of experience preparing for product-company interviews.

## How it works

1. **Pick a problem** from the library — 10 LLD (machine-coding classics) + 10 HLD (system design
   staples), each with requirements and a realistic time limit.
2. **Attempt it** on a full-height Excalidraw canvas, or switch to **Code mode** to write classes,
   SQL schemas, or pseudocode.
3. **Speak or type** your reasoning into the response box — the mic writes directly into it.
4. **Ask the interviewer** mid-attempt for hints (cheap, text-only — it nudges, it doesn't solve).
5. **Submit final design** → one multimodal Gemini call analyzes your diagram (image + outline),
   response, and code, and returns a detailed evaluation: overall score, dimension breakdown,
   strengths, gaps, a prioritized improvement checklist, and a reference solution outline.
6. **Follow up** — chat with the interviewer about your attempt, then retry and watch your score
   trend improve on the History page.

No login. All attempts are stored locally in your browser (IndexedDB + localStorage).

## Tech stack

- **React 18 + TypeScript + Vite** — app shell
- **@excalidraw/excalidraw** — the drawing canvas
- **Web Speech API** — browser-native speech-to-text (Chrome/Edge/Safari 14.1+)
- **Tailwind CSS** — minimal, dark-mode UI
- **idb-keyval** — IndexedDB wrapper for attempt storage
- **Vercel serverless functions** — `/api/feedback`, `/api/interviewer`, `/api/chat` proxy the
  Gemini API so the key never ships to the browser
- **Gemini** (`gemini-3.8-flash`) — structured JSON output for deterministic feedback

## Running locally

```bash
npm install
cp .env.example .env   # fill in your Gemini API key
npm run dev
```

> In dev, Vite doesn't serve the `/api` serverless functions, so the app falls back to calling
> Gemini directly using `VITE_GEMINI_API_KEY` from `.env`. To test the production path locally,
> run `npx vercel dev` instead.

## Deploying to Vercel

1. Push this repo to GitHub (it already contains `vercel.json`).
2. Import the repo in Vercel — the framework preset (Vite) and build settings are auto-detected.
3. Add environment variables in **Project Settings → Environment Variables**:
   - `GEMINI_API_KEY` — your Gemini API key (required, server-side only)
   - `GEMINI_MODEL` — optional, defaults to `gemini-3.8-flash`
4. Deploy. Every push to `main` redeploys automatically.

## Cost notes

- Mid-attempt interviewer hints: text-only request, 600-token output cap.
- Final evaluation: exactly one multimodal request per submission, 2048-token output cap.
- Follow-up chat: text-only, 700-token output cap.

## Project structure

```
├── api/                  # Vercel serverless functions (Gemini proxy, key stays here)
│   ├── feedback.js       #   final scored evaluation (multimodal)
│   ├── interviewer.js    #   mid-attempt hints (text-only)
│   └── chat.js           #   post-feedback follow-ups
├── src/
│   ├── components/       # Layout, ProblemCard, Timer, MicButton, FeedbackView, FollowUpChat…
│   ├── data/problems.ts  # 10 LLD + 10 HLD curated problems
│   ├── hooks/            # useSpeechRecognition, useTheme
│   ├── lib/              # storage (IndexedDB), gemini client
│   └── pages/            # Home, Problem, Attempt, Feedback, History, Settings
├── vercel.json           # SPA rewrites + function config
└── index.html
```

## License

[MIT](./LICENSE)
