import { get, set, del, keys, clear } from "idb-keyval";
import type { Attempt } from "../types";

const ATTEMPT_PREFIX = "attempt:";
const INDEX_KEY = "dl:attemptIndex";
const PREFS_KEY = "dl:prefs";
const DRAFT_PREFIX = "dl:draft:";

export interface AttemptSummary {
  id: string;
  problemId: string;
  problemTitle: string;
  startedAt: number;
  durationMs: number;
  overallScore?: number;
}

export interface Prefs {
  theme: "dark" | "light";
  autoSubmit: boolean;
  transcriptLang: string;
}

const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  autoSubmit: true,
  transcriptLang: "en-US",
};

// ---------------- Attempts (IndexedDB) ----------------

export async function saveAttempt(attempt: Attempt, problemTitle: string): Promise<void> {
  await set(ATTEMPT_PREFIX + attempt.id, attempt);
  upsertIndexEntry({
    id: attempt.id,
    problemId: attempt.problemId,
    problemTitle,
    startedAt: attempt.startedAt,
    durationMs: attempt.durationMs,
    overallScore: attempt.feedback?.overallScore,
  });
}

export async function getAttempt(id: string): Promise<Attempt | undefined> {
  return (await get(ATTEMPT_PREFIX + id)) as Attempt | undefined;
}

export async function deleteAttempt(id: string): Promise<void> {
  await del(ATTEMPT_PREFIX + id);
  removeIndexEntry(id);
}

export async function getAllAttempts(): Promise<Attempt[]> {
  const allKeys = (await keys()) as string[];
  const attemptKeys = allKeys.filter((k) => k.startsWith(ATTEMPT_PREFIX));
  const results = await Promise.all(attemptKeys.map((k) => get<Attempt>(k)));
  return results.filter((a): a is Attempt => !!a);
}

export async function wipeAllData(): Promise<void> {
  await clear();
  localStorage.removeItem(INDEX_KEY);
  localStorage.removeItem(PREFS_KEY);
  removeDraftKeys();
}

// ---------------- Attempt index (localStorage, for fast history listing) ----------------

function readIndex(): AttemptSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as AttemptSummary[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: AttemptSummary[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

function upsertIndexEntry(entry: AttemptSummary) {
  const rest = readIndex().filter((e) => e.id !== entry.id);
  rest.push(entry);
  rest.sort((a, b) => b.startedAt - a.startedAt);
  writeIndex(rest);
}

function removeIndexEntry(id: string) {
  writeIndex(readIndex().filter((e) => e.id !== id));
}

export function listAttemptSummaries(): AttemptSummary[] {
  return readIndex().sort((a, b) => b.startedAt - a.startedAt);
}

export function listAttemptSummariesForProblem(problemId: string): AttemptSummary[] {
  return listAttemptSummaries().filter((s) => s.problemId === problemId);
}

// ---------------- Drafts (localStorage, crash recovery for in-progress attempts) ----------------

export function saveDraft(
  attemptId: string,
  problemId: string,
  scene: unknown,
  notes: string,
  codeText: string
): void {
  try {
    localStorage.setItem(
      DRAFT_PREFIX + attemptId,
      JSON.stringify({ attemptId, problemId, scene, notes, codeText, savedAt: Date.now() })
    );
  } catch {
    // Storage full or unavailable — drafts are best-effort.
  }
}

export function getDraft<T = unknown>(
  attemptId: string
): { scene?: T; notes?: string; codeText?: string; savedAt: number } | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + attemptId);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function findDraftForProblem(problemId: string): { attemptId: string; savedAt: number } | undefined {
  let result: { attemptId: string; savedAt: number } | undefined;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
    try {
      const draft = JSON.parse(localStorage.getItem(key) || "");
      if (draft.problemId === problemId) {
        if (!result || draft.savedAt > result.savedAt) {
          result = { attemptId: draft.attemptId, savedAt: draft.savedAt };
        }
      }
    } catch {
      // ignore malformed drafts
    }
  }
  return result;
}

export function clearDraft(attemptId: string): void {
  localStorage.removeItem(DRAFT_PREFIX + attemptId);
}

function removeDraftKeys(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(DRAFT_PREFIX)) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

// ---------------- Prefs (localStorage) ----------------

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setPrefs(partial: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}
