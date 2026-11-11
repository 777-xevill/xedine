'use client';

import { Dumbbell, Feather, Send, Sparkles, Wallet, X } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import {
  ALLERGENS,
  BUDGET_POISHA,
  hasFacts,
  isSafe,
  LIGHT_KCAL,
  quickPick,
  type Allergen,
  type FactsDish,
  type QuickPick,
} from '@/modules/menu/food-facts';

export interface TableDish extends FactsDish {
  description: string | null;
  photoUrl: string | null;
  cat: string;
  cat_bn: string | null;
}

type Answer =
  | { kind: 'pick'; pick: QuickPick; dishes: TableDish[] }
  | { kind: 'ask'; question: string; text: string | null; dishes: TableDish[] }
  | { kind: 'error'; text: string };

/**
 * The table page's menu (ADR 0049): each dish with its approved calories and protein (tap for carbs,
 * fat and allergens), an "I don't eat" filter, quick picks (high protein, light, budget) and, when AI is
 * set up, a box to ask about the food in Bangla or English. Every figure shown is the restaurant's own
 * approved value; the AI only chooses dishes and words.
 */
export function TableMenu({
  dishes,
  token,
  aiOn,
  otherLabel,
}: {
  dishes: TableDish[];
  token: string;
  aiOn: boolean;
  otherLabel: string;
}) {
  const t = useTranslations('tablePage');
  const ta = useTranslations('allergens');
  const loc = useLocale() as Locale;
  const [avoid, setAvoid] = React.useState<Allergen[]>([]);
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [question, setQuestion] = React.useState('');
  const [asking, setAsking] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);

  const anyFacts = dishes.some(hasFacts);
  const shown = dishes.filter((d) => isSafe(d, avoid));
  const hidden = dishes.length - shown.length;
  const categories = [...new Set(shown.map((d) => d.cat))];

  const toggle = (a: Allergen) => {
    const next = avoid.includes(a) ? avoid.filter((x) => x !== a) : [...avoid, a];
    setAvoid(next);
    if (answer?.kind === 'pick')
      setAnswer({ ...answer, dishes: quickPick(dishes, answer.pick, next) });
  };

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 2 || asking) return;
    setAsking(true);
    try {
      const res = await fetch('/api/webhooks/menu-helper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, question: q, locale: loc, avoid }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        answer?: string | null;
        dishes?: string[];
        error?: string;
      };
      if (!res.ok) {
        setAnswer({ kind: 'error', text: t(json.error === 'busy' ? 'askBusy' : 'askFailed') });
      } else {
        const picked = (json.dishes ?? [])
          .map((name) => dishes.find((d) => d.name === name))
          .filter((d): d is TableDish => d !== undefined);
        setAnswer({ kind: 'ask', question: q, text: json.answer ?? null, dishes: picked });
        setQuestion('');
      }
    } catch {
      setAnswer({ kind: 'error', text: t('askFailed') });
    }
    setAsking(false);
  }

  const name = (d: TableDish) => (loc === 'bn' && d.name_bn ? d.name_bn : d.name);
  const grams = (v: number) => formatNumber(v, loc, { fractionDigits: v % 1 ? 1 : 0 });
  const factsText = (d: TableDish) =>
    hasFacts(d)
      ? t('facts', { kcal: formatNumber(d.kcal, loc), protein: grams(Number(d.protein_g)) })
      : null;

  const picks: { key: QuickPick; icon: typeof Dumbbell; label: string; needsFacts: boolean }[] = [
    { key: 'protein', icon: Dumbbell, label: t('pickProtein'), needsFacts: true },
    {
      key: 'light',
      icon: Feather,
      label: t('pickLight', { kcal: formatNumber(LIGHT_KCAL, loc) }),
      needsFacts: true,
    },
    {
      key: 'budget',
      icon: Wallet,
      label: t('pickBudget', { price: formatBDT(BUDGET_POISHA, loc, { poisha: 'never' }) }),
      needsFacts: false,
    },
  ];

  return (
    <>
      <div className="glass rounded-sheet p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Sparkles aria-hidden className="size-5 text-purple" />
          {t('helperTitle')}
        </h3>
        <p className="mt-0.5 text-sm text-secondary">
          {aiOn ? t('helperBody') : t('helperBodyNoAi')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {picks
            .filter((p) => anyFacts || !p.needsFacts)
            .map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setAnswer({ kind: 'pick', pick: key, dishes: quickPick(dishes, key, avoid) })
                }
                aria-pressed={answer?.kind === 'pick' && answer.pick === key}
                className={cn(
                  'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold',
                  answer?.kind === 'pick' && answer.pick === key
                    ? 'border-purple/40 bg-purple/10 text-purple'
                    : 'border-line bg-surface',
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </button>
            ))}
        </div>

        {aiOn ? (
          <form onSubmit={ask} className="mt-3 flex gap-2">
            <label htmlFor="menu-ask" className="sr-only">
              {t('askLabel')}
            </label>
            <input
              id="menu-ask"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              placeholder={t('askPlaceholder')}
              className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm"
            />
            <button
              type="submit"
              disabled={asking || question.trim().length < 2}
              aria-label={t('askButton')}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-action text-on-action disabled:opacity-45"
            >
              <Send aria-hidden className="size-4" />
            </button>
          </form>
        ) : null}

        {anyFacts ? (
          <fieldset className="mt-3">
            <legend className="mb-1.5 text-sm font-medium">{t('avoidTitle')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {ALLERGENS.map((a) => {
                const on = avoid.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(a)}
                    className={cn(
                      'min-h-9 rounded-full border px-3 text-xs font-medium',
                      on
                        ? 'border-danger/40 bg-danger/10 text-danger line-through'
                        : 'border-line bg-surface text-secondary',
                    )}
                  >
                    {ta(a)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div aria-live="polite">
          {asking ? <p className="mt-3 text-sm text-secondary">{t('asking')}</p> : null}
          {answer && !asking ? (
            <div className="mt-3 rounded-input border border-purple/25 bg-purple/5 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  {answer.kind === 'error' ? (
                    <p>{answer.text}</p>
                  ) : answer.kind === 'ask' ? (
                    <>
                      <p className="text-xs text-secondary">{answer.question}</p>
                      <p className="mt-1">
                        {answer.text ?? (answer.dishes.length ? t('ourPicks') : t('noPicks'))}
                      </p>
                    </>
                  ) : (
                    <p className="font-semibold">
                      {answer.dishes.length ? t('ourPicks') : t('noPicks')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAnswer(null)}
                  aria-label={t('closeAnswer')}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-secondary"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              {answer.kind !== 'error' && answer.dishes.length ? (
                <ul className="mt-2 space-y-1.5">
                  {answer.dishes.map((d) => (
                    <li
                      key={d.name}
                      className="flex items-center justify-between gap-2 rounded-input bg-surface px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{name(d)}</span>
                        {factsText(d) ? (
                          <span className="block text-xs text-secondary tabular-nums">
                            {factsText(d)}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatBDT(d.price_poisha, loc)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {hidden > 0 ? (
        <p className="px-1 text-sm text-secondary">
          {t('hiddenByFilter', { n: formatNumber(hidden, loc) })}
        </p>
      ) : null}

      {categories.map((cat) => {
        const items = shown.filter((m) => m.cat === cat);
        const first = items[0]!;
        const title = loc === 'bn' && first.cat_bn ? first.cat_bn : cat || otherLabel;
        return (
          <div key={cat} className="glass rounded-sheet p-4 sm:p-5">
            <h3 className="mb-2 text-lg font-bold">{title}</h3>
            <ul className="divide-y divide-line">
              {items.map((m) => {
                const id = `${m.name}-${m.price_poisha}`;
                const facts = factsText(m);
                const expanded = open === id && hasFacts(m);
                return (
                  <li key={id} className="py-2.5">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : id)}
                      aria-expanded={hasFacts(m) ? expanded : undefined}
                      disabled={!hasFacts(m)}
                      className="flex w-full items-center gap-3 text-left disabled:cursor-default"
                    >
                      {m.photoUrl ? (
                        <span className="relative size-14 shrink-0 overflow-hidden rounded-input">
                          <Image
                            src={m.photoUrl}
                            alt=""
                            fill
                            unoptimized
                            sizes="56px"
                            className="object-cover"
                          />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{name(m)}</span>
                        {m.description ? (
                          <span className="block truncate text-xs text-secondary">
                            {m.description}
                          </span>
                        ) : null}
                        {facts ? (
                          <span className="block text-xs font-medium text-success tabular-nums">
                            {facts}
                          </span>
                        ) : null}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {formatBDT(m.price_poisha, loc)}
                      </span>
                    </button>
                    {expanded ? (
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-input bg-surface-elevated px-2 py-1.5">
                          <dt className="text-secondary">{t('carbs')}</dt>
                          <dd className="font-semibold tabular-nums">
                            {t('grams', { n: grams(Number(m.carbs_g ?? 0)) })}
                          </dd>
                        </div>
                        <div className="rounded-input bg-surface-elevated px-2 py-1.5">
                          <dt className="text-secondary">{t('fat')}</dt>
                          <dd className="font-semibold tabular-nums">
                            {t('grams', { n: grams(Number(m.fat_g ?? 0)) })}
                          </dd>
                        </div>
                        <div className="rounded-input bg-surface-elevated px-2 py-1.5">
                          <dt className="text-secondary">{t('protein')}</dt>
                          <dd className="font-semibold tabular-nums">
                            {t('grams', { n: grams(Number(m.protein_g)) })}
                          </dd>
                        </div>
                        <div className="col-span-3 rounded-input bg-surface-elevated px-2 py-1.5 text-left">
                          {(m.allergens ?? []).length
                            ? t('contains', {
                                list: (m.allergens ?? [])
                                  .filter((a): a is Allergen =>
                                    (ALLERGENS as readonly string[]).includes(a),
                                  )
                                  .map((a) => ta(a))
                                  .join(', '),
                              })
                            : t('containsNone')}
                        </div>
                      </dl>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}
