'use client';

import { useEffect, useRef, useState } from 'react';

// The Web Speech API is not in TypeScript's DOM lib everywhere; only what we use is typed here.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

/**
 * Dictation with the browser's own speech recognition (free; Chrome on Android understands Bangla,
 * bn-BD). Nothing is recorded or uploaded by us. `supported` is undefined until the browser has been
 * asked, so "not supported" never flashes on load.
 */
export function useSpeech(lang: 'bn-BD' | 'en-US', onText: (text: string) => void) {
  const [ctor, setCtor] = useState<RecognitionCtor | null | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const handler = useRef(onText);
  useEffect(() => {
    handler.current = onText;
  });

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    const id = window.setTimeout(() =>
      setCtor(() => w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null),
    );
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => () => rec.current?.stop(), []);

  const start = () => {
    if (!ctor) return;
    const r = new ctor();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) text += res[0]!.transcript;
      }
      if (text.trim()) handler.current(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return {
    supported: ctor === undefined ? undefined : ctor !== null,
    listening,
    toggle: () => (listening ? rec.current?.stop() : start()),
  };
}
