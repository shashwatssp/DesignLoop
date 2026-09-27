import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
}

/**
 * Voice notes via the Web Speech API (built into Chrome/Edge; Safari 14.1+).
 * Produces a final accumulated transcript plus interim (in-flight) text.
 * Auto-restarts while listening to survive continuous-mode cutoffs.
 */
export function useSpeechRecognition(lang = "en-US") {
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const keepAliveRef = useRef(false);

  const start = useCallback(() => {
    if (!supported) return;
    setError(null);
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec: SpeechRecognitionLike = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event: any) => {
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const piece = result[0].transcript.trim();
          if (piece) setFinalText((prev) => (prev ? `${prev} ${piece}` : piece));
        } else {
          interimChunk += result[0].transcript;
        }
      }
      setInterim(interimChunk);
    };

    rec.onend = () => {
      if (keepAliveRef.current) {
        // Chrome ends continuous sessions periodically; restart.
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    rec.onerror = (event: any) => {
      const kind = event?.error as string | undefined;
      if (kind === "not-allowed" || kind === "service-not-allowed") {
        keepAliveRef.current = false;
        setListening(false);
        setError("Microphone permission denied.");
      } else if (kind === "audio-capture") {
        keepAliveRef.current = false;
        setListening(false);
        setError("No microphone found.");
      } else if (kind === "network") {
        setError("Speech recognition network error, retrying.");
      }
      // 'no-speech' and 'aborted' are transient; the onend restart handles them.
    };

    recognitionRef.current = rec;
    keepAliveRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [supported, lang]);

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    setListening(false);
    setInterim("");
  }, []);

  const reset = useCallback(() => {
    setFinalText("");
    setInterim("");
    setError(null);
  }, []);

  useEffect(
    () => () => {
      keepAliveRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    },
    []
  );

  return { supported, listening, interim, finalText, error, start, stop, reset, setFinalText };
}
