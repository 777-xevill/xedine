'use client';

import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Hint, Textarea } from '@/components/ui/form';

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
 * A textarea the purchaser can also dictate into (Chrome on Android understands Bangla, bn-BD). The
 * browser turns speech into text; nothing is recorded or uploaded, and the text goes through the same
 * review as a typed list. Marks the form `spoken=1` so the draft is labelled a voice entry.
 */
export function VoiceTextarea({
  id,
  name,
  label,
  placeholder,
  lang,
  labels,
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  lang: 'bn-BD' | 'en-US';
  labels: { speak: string; stop: string; unsupported: string; listening: string };
}) {
  // undefined until the browser has been asked, so 'not supported' never flashes on load.
  const [ctor, setCtor] = useState<RecognitionCtor | null | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const [spoken, setSpoken] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    // Deferred a tick: the browser capability is external state read once after mount.
    const id = window.setTimeout(() =>
      setCtor(() => w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null),
    );
    return () => window.clearTimeout(id);
  }, []);

  const start = () => {
    if (!ctor) return;
    const r = new ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) text += res[0]!.transcript;
      }
      if (text && area.current) {
        area.current.value = `${area.current.value}${area.current.value ? '\n' : ''}${text.trim()}`;
        setSpoken(true);
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {ctor ? (
          <Button
            type="button"
            size="sm"
            variant={listening ? 'danger' : 'secondary'}
            onClick={() => (listening ? rec.current?.stop() : start())}
            aria-pressed={listening}
          >
            {listening ? (
              <Square aria-hidden className="size-4" />
            ) : (
              <Mic aria-hidden className="size-4" />
            )}
            {listening ? labels.stop : labels.speak}
          </Button>
        ) : null}
      </div>
      <Textarea
        ref={area}
        id={id}
        name={name}
        rows={4}
        maxLength={4000}
        placeholder={placeholder}
      />
      <input type="hidden" name="spoken" value={spoken ? '1' : '0'} />
      {listening ? <Hint aria-live="polite">{labels.listening}</Hint> : null}
      {ctor === null ? <Hint>{labels.unsupported}</Hint> : null}
    </div>
  );
}
