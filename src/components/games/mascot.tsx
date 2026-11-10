import { cn } from '@/lib/utils';

export type Mood = 'happy' | 'wow' | 'sad' | 'cheer' | 'think';

/**
 * The games' host character (ADR 0046): a round golden bun in a chef's hat, original to Xedine. The owner
 * can give it the restaurant's own name. Drawn as SVG in the brand colour tokens, so it follows the theme.
 */
export function Mascot({
  mood = 'happy',
  className,
  bob = true,
}: {
  mood?: Mood;
  className?: string;
  bob?: boolean;
}) {
  const armsUp = mood === 'cheer' || mood === 'wow';
  return (
    <svg viewBox="0 0 120 130" aria-hidden className={cn('overflow-visible', className)}>
      <g className={bob ? 'game-bob' : undefined} style={{ transformOrigin: '60px 120px' }}>
        {/* shadow */}
        <ellipse cx="60" cy="124" rx="30" ry="4" className="fill-foreground opacity-10" />
        {/* arms */}
        <path
          d={armsUp ? 'M22 78 Q8 60 14 44' : 'M22 82 Q8 92 14 104'}
          className="fill-none stroke-warning stroke-[7]"
          strokeLinecap="round"
        />
        <path
          d={armsUp ? 'M98 78 Q112 60 106 44' : 'M98 82 Q112 92 106 104'}
          className="fill-none stroke-warning stroke-[7]"
          strokeLinecap="round"
        />
        {/* body: a golden bun */}
        <path
          d="M60 38 C92 38 104 62 102 86 C100 110 84 120 60 120 C36 120 20 110 18 86 C16 62 28 38 60 38 Z"
          className="fill-warning-bright stroke-warning stroke-[3]"
        />
        <path
          d="M34 64 Q40 56 48 58"
          className="fill-none stroke-white stroke-[4] opacity-60"
          strokeLinecap="round"
        />
        {/* chef's hat */}
        <path
          d="M38 42 C26 40 26 20 40 20 C42 8 58 4 64 14 C72 4 92 10 86 24 C98 26 96 44 82 42 Z"
          className="fill-white stroke-line-strong stroke-[2.5]"
        />
        <rect
          x="38"
          y="36"
          width="44"
          height="10"
          rx="4"
          className="fill-white stroke-line-strong stroke-[2.5]"
        />
        {/* cheeks */}
        <ellipse cx="36" cy="92" rx="7" ry="4.5" className="fill-pink-bright opacity-50" />
        <ellipse cx="84" cy="92" rx="7" ry="4.5" className="fill-pink-bright opacity-50" />
        {/* eyes */}
        {mood === 'cheer' ? (
          <>
            <path
              d="M38 78 Q45 70 52 78"
              className="fill-none stroke-foreground stroke-[4]"
              strokeLinecap="round"
            />
            <path
              d="M68 78 Q75 70 82 78"
              className="fill-none stroke-foreground stroke-[4]"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <ellipse
              cx="45"
              cy={mood === 'think' ? 74 : 77}
              rx="5.5"
              ry={mood === 'wow' ? 8 : 6.5}
              className="fill-foreground"
            />
            <ellipse
              cx="75"
              cy={mood === 'think' ? 74 : 77}
              rx="5.5"
              ry={mood === 'wow' ? 8 : 6.5}
              className="fill-foreground"
            />
            <circle cx={mood === 'think' ? 47 : 47} cy="74" r="1.8" className="fill-white" />
            <circle cx={mood === 'think' ? 77 : 77} cy="74" r="1.8" className="fill-white" />
          </>
        )}
        {/* brows for sad and think */}
        {mood === 'sad' ? (
          <>
            <path
              d="M37 70 L51 65"
              className="stroke-foreground stroke-[3]"
              strokeLinecap="round"
            />
            <path
              d="M83 70 L69 65"
              className="stroke-foreground stroke-[3]"
              strokeLinecap="round"
            />
          </>
        ) : null}
        {mood === 'think' ? (
          <path
            d="M68 64 Q76 60 84 64"
            className="fill-none stroke-foreground stroke-[3]"
            strokeLinecap="round"
          />
        ) : null}
        {/* mouth */}
        {mood === 'wow' ? (
          <ellipse cx="60" cy="100" rx="6" ry="7.5" className="fill-foreground" />
        ) : mood === 'sad' ? (
          <path
            d="M50 104 Q60 96 70 104"
            className="fill-none stroke-foreground stroke-[4]"
            strokeLinecap="round"
          />
        ) : mood === 'think' ? (
          <path d="M53 101 L68 99" className="stroke-foreground stroke-[4]" strokeLinecap="round" />
        ) : (
          <path
            d="M48 96 Q60 110 72 96 Z"
            className="fill-danger stroke-foreground stroke-[3]"
            strokeLinejoin="round"
          />
        )}
      </g>
    </svg>
  );
}

/** The character with a speech bubble. */
export function HostSays({
  mood = 'happy',
  name,
  children,
  className,
}: {
  mood?: Mood;
  name: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end gap-3', className)}>
      <Mascot mood={mood} className="size-20 shrink-0" />
      <div className="relative mb-4 min-w-0 rounded-card border border-line bg-surface px-4 py-3 shadow-soft">
        <p className="text-xs font-semibold text-purple">{name}</p>
        <div className="text-sm font-medium">{children}</div>
      </div>
    </div>
  );
}
