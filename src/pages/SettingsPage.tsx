import { useState } from "react";
import { getPrefs, getAllAttempts, setPrefs, wipeAllData } from "../lib/storage";

export default function SettingsPage() {
  const [prefs, updatePrefs] = useState(() => getPrefs());
  const [status, setStatus] = useState<string | null>(null);

  const exportData = async () => {
    const attempts = await getAllAttempts();
    const blob = new Blob([JSON.stringify(attempts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `designloop-attempts-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Exported all attempts as JSON.");
  };

  const wipe = async () => {
    if (!confirm("Delete ALL attempts, drafts and settings? This cannot be undone.")) return;
    await wipeAllData();
    setStatus("All local data cleared. Reload to start fresh.");
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-5 text-2xl font-bold">Settings</h1>

      <div className="card space-y-5 p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Voice recognition language</label>
          <select
            value={prefs.transcriptLang}
            onChange={(e) => updatePrefs(setPrefs({ transcriptLang: e.target.value }))}
            className="input"
          >
            <option value="en-US">English (US)</option>
            <option value="en-IN">English (India)</option>
            <option value="en-GB">English (UK)</option>
            <option value="hi-IN">Hindi</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            Used by your browser's speech recognition when dictating into the response box.
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={prefs.autoSubmit}
              onChange={(e) => updatePrefs(setPrefs({ autoSubmit: e.target.checked }))}
              className="h-4 w-4 accent-indigo-600"
            />
            Auto-submit when the timer expires
          </label>
          <p className="mt-1 text-xs text-slate-400">
            Off = the timer turns red at zero but waits for you to submit manually.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Your data</h2>
          <p className="mb-3 text-xs text-slate-400">
            Everything is stored locally in your browser (IndexedDB + localStorage). No account, no
            server-side storage. Export a backup before clearing your browser data.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportData} className="btn-secondary">
              ⬇ Export all attempts (JSON)
            </button>
            <button onClick={wipe} className="btn-danger">
              Clear all data
            </button>
          </div>
        </div>

        {status && <p className="text-xs text-emerald-500">{status}</p>}
      </div>
    </div>
  );
}
