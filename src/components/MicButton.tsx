export default function MicButton({
  supported,
  listening,
  interim,
  onStart,
  onStop,
}: {
  supported: boolean;
  listening: boolean;
  interim: string;
  onStart: () => void;
  onStop: () => void;
}) {
  if (!supported) {
    return (
      <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        🎤 Voice notes need Chrome, Edge, or Safari 14.1+. Type your thoughts in Notes instead.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={listening ? onStop : onStart}
        className={`btn w-full ${
          listening ? "bg-red-600 text-white hover:bg-red-500" : "btn-secondary"
        }`}
      >
        {listening && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
        )}
        {listening ? "Stop recording" : "🎤 Start speaking"}
      </button>
      {listening && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs italic text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          {interim ? `“${interim}”` : "Listening… speak your design reasoning."}
        </div>
      )}
    </div>
  );
}
