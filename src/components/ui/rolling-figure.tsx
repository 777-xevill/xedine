import type * as React from 'react';
import { cn } from '@/lib/utils';

const graphemes = (text: string): string[] =>
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        (s) => s.segment,
      )
    : Array.from(text);

/**
 * A figure whose characters slide up into place one after another, like Apple's numeric text
 * (ADR 0063). Every character is the real one from the first frame — only its position animates — so
 * no number the metric did not produce ever appears (CLAUDE.md #1). Split by grapheme, so Bangla
 * letters keep their vowel signs. Screen readers read the plain text once.
 */
export function RollingFigure({
  value,
  className,
  testId,
}: {
  value: string;
  className?: string;
  /** Goes on the plain (screen-reader) copy, whose text is exactly the value. */
  testId?: string;
}) {
  return (
    <span className={cn('inline-block', className)}>
      <span className="sr-only" data-testid={testId}>
        {value}
      </span>
      <span aria-hidden className="roll-chars">
        {graphemes(value).map((c, i) => (
          <span key={i} className="roll-char" style={{ '--i': i } as React.CSSProperties}>
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}
