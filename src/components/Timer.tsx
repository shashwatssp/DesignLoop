import { useEffect, useRef, useState } from "react";

export default function Timer({
  endsAt,
  running,
  onExpire,
}: {
  endsAt: number;
  running: boolean;
  onExpire?: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, endsAt - Date.now()));
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const remaining = Math.max(0, endsAt - Date.now());
      setRemainingMs(remaining);
      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt, running, onExpire]);

  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds <= 60;
  const warning = !urgent && totalSeconds <= 5 * 60;

  return (
    <span
      className={`font-mono text-lg font-semibold tabular-nums ${
        urgent ? "text-red-500" : warning ? "text-amber-500" : "text-slate-700 dark:text-slate-200"
      }`}
    >
      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </span>
  );
}
