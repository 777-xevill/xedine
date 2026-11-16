'use client';

import {
  Ban,
  ChevronRight,
  Dumbbell,
  EyeOff,
  Feather,
  Flame,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { formatMoney, formatNumber, type Locale } from '@/lib/i18n/format';
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

const stillMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A dish photo in its rounded frame that fades in once it has arrived (ADR 0063). */
export function DishPhoto({ src, sizes }: { src: string; sizes: string }) {
  const [loaded, setLoaded] = React.useState(false);
  return (
    <Image
      src={src}
      alt=""
      fill
      unoptimized
      sizes={sizes}
      onLoad={() => setLoaded(true)}
      data-loaded={loaded ? '' : undefined}
      className="cust-photo-img object-cover"
    />
  );
}

/**
 * The menu's categories as a row of pills that sticks under the customer page's top bar (ADR 0063). The
 * one being read lights up yellow, and the yellow glides along as the page scrolls; a tap scrolls to that
 * category. Plain in-page links underneath, so it works before the script arrives.
 */
export function MenuCategoryBar({
  label,
  items,
}: {
  label: string;
  items: { id: string; title: string }[];
}) {
  const [active, setActive] = React.useState(items[0]?.id ?? '');
  const track = React.useRef<HTMLDivElement>(null);
  const hold = React.useRef(0);
  const ids = items.map((i) => i.id).join('\n');

  // The category under the bars is the last one whose top has passed them.
  React.useEffect(() => {
    const list = ids.split('\n').filter(Boolean);
    if (list.length < 2) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (performance.now() < hold.current) return;
      const line = (track.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let current = list[0]!;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  // The yellow pill moves under the active word, and the row scrolls to keep it in view.
  React.useEffect(() => {
    const el = track.current;
    if (!el) return;
    const place = (smooth: boolean) => {
      const pill = el.querySelector<HTMLElement>('[aria-current="true"]');
      if (!pill) return;
      el.style.setProperty('--cust-x', `${pill.offsetLeft}px`);
      el.style.setProperty('--cust-w', `${pill.offsetWidth}px`);
      el.dataset.glide = '';
      el.scrollTo({
        left: pill.offsetLeft - (el.clientWidth - pill.offsetWidth) / 2,
        behavior: smooth ? 'smooth' : 'auto',
      });
    };
    place(!stillMotion());
    // Words change width when the font arrives or the phone turns: measure again.
    const ro = new ResizeObserver(() => place(false));
    ro.observe(el);
    el.querySelectorAll('a').forEach((a) => ro.observe(a));
    return () => ro.disconnect();
  }, [active, ids]);

  const go = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    // The event's time is on the same clock as performance.now().
    hold.current = e.timeStamp + 900;
    setActive(id);
    target.scrollIntoView({ behavior: stillMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  if (items.length < 2) return null;
  return (
    <nav aria-label={label} className="cust-cats">
      <div ref={track} className="cust-cats-track">
        <span aria-hidden className="cust-cats-glide" />
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={(e) => go(e, it.id)}
            aria-current={active === it.id ? 'true' : undefined}
            className="cust-cat-pill"
          >
            {it.title}
          </a>
        ))}
      </div>
    </nav>
  );
}

/**
 * The table page's menu (ADR 0049): each dish with its approved calories and protein (tap for carbs,
 * fat and allergens), an "I don't eat" filter, quick picks (high protein, light, budget) and, when AI is
 * set up, a box to ask about the food in Bangla or English. Every figure shown is the restaurant's own
 * approved value; the AI only chooses dishes and words. ADR 0063: a sticky category bar, photos in
 * rounded frames, and a dish's facts in a sheet that rises from the bottom.
 */
export function TableMenu({
  currency,
  dishes,
  token,
  aiOn,
  otherLabel,
}: {
  currency: string;
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
  // The dish in the sheet stays while the sheet slides away.
  const [sheetDish, setSheetDish] = React.useState<TableDish | null>(null);
  const sheet = React.useRef<HTMLDialogElement>(null);

  const anyFacts = dishes.some(hasFacts);
  const shown = dishes.filter((d) => isSafe(d, avoid));
  const hidden = dishes.length - shown.length;
  const categories = [...new Set(shown.map((d) => d.cat))];
  // Stable anchors: a category keeps its id while the filter hides others.
  const allCategories = [...new Set(dishes.map((d) => d.cat))];
  const catId = (cat: string) => `menu-cat-${allCategories.indexOf(cat)}`;
  const catTitle = (cat: string) => {
    const first = shown.find((m) => m.cat === cat)!;
    return loc === 'bn' && first.cat_bn ? first.cat_bn : cat || otherLabel;
  };

  React.useEffect(() => {
    const d = sheet.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

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
      label: t('pickBudget', {
        price: formatMoney(BUDGET_POISHA, loc, currency, { poisha: 'never' }),
      }),
      needsFacts: false,
    },
  ];

  const sheetFacts = sheetDish ? factsText(sheetDish) : null;
  const sheetAllergens = sheetDish?.allergens ?? [];

  return (
    <>
      <div className="cust-card cust-helper p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="cust-icon cust-icon--sm">
            <Sparkles aria-hidden className="size-[1.125rem]" />
          </span>
          <h3 className="min-w-0 text-lg leading-tight font-bold tracking-tight">
            {t('helperTitle')}
          </h3>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          {aiOn ? t('helperBody') : t('helperBodyNoAi')}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
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
                className="cust-pill"
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </button>
            ))}
        </div>

        {aiOn ? (
          <form onSubmit={ask} className="cust-ask mt-3.5">
            <label htmlFor="menu-ask" className="sr-only">
              {t('askLabel')}
            </label>
            <input
              id="menu-ask"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              placeholder={t('askPlaceholder')}
              className="cust-ask-input"
            />
            <button
              type="submit"
              disabled={asking || question.trim().length < 2}
              aria-label={t('askButton')}
              className="cust-ask-send"
            >
              <Send aria-hidden className="size-4" />
            </button>
          </form>
        ) : null}

        {anyFacts ? (
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-semibold">{t('avoidTitle')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {ALLERGENS.map((a) => {
                const on = avoid.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(a)}
                    className="cust-chip"
                  >
                    {on ? <Ban aria-hidden className="size-3.5" /> : null}
                    {ta(a)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div aria-live="polite">
          {asking ? (
            <p className="cust-thinking mt-3.5 text-sm text-secondary">
              <span aria-hidden />
              <span aria-hidden />
              <span aria-hidden />
              {t('asking')}
            </p>
          ) : null}
          {answer && !asking ? (
            <div className="cust-answer mt-3.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm leading-relaxed">
                  {answer.kind === 'error' ? (
                    <p>{answer.text}</p>
                  ) : answer.kind === 'ask' ? (
                    <>
                      <p className="text-xs text-muted">{answer.question}</p>
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
                  className="cust-round cust-round--sm -me-1.5 -mt-1.5"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              {answer.kind !== 'error' && answer.dishes.length ? (
                <ul className="mt-2.5 space-y-1.5">
                  {answer.dishes.map((d, i) => (
                    <li
                      key={d.name}
                      className="cust-rise flex items-center gap-3 rounded-2xl bg-surface-elevated px-2.5 py-2"
                      style={{ '--i': i } as React.CSSProperties}
                    >
                      <span className="cust-photo cust-photo--sm">
                        {d.photoUrl ? (
                          <DishPhoto src={d.photoUrl} sizes="44px" />
                        ) : (
                          <UtensilsCrossed aria-hidden className="size-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{name(d)}</span>
                        {factsText(d) ? (
                          <span className="block text-xs text-secondary tabular-nums">
                            {factsText(d)}
                          </span>
                        ) : null}
                      </span>
                      <span className="cust-price text-sm">
                        {formatMoney(d.price_poisha, loc, currency)}
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
        <p className="flex items-start gap-2 px-1 text-sm leading-snug text-secondary">
          <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-yellow" />
          {t('hiddenByFilter', { n: formatNumber(hidden, loc) })}
        </p>
      ) : null}

      <MenuCategoryBar
        label={t('menuTitle')}
        items={categories.map((cat) => ({ id: catId(cat), title: catTitle(cat) }))}
      />

      {categories.map((cat) => {
        const items = shown.filter((m) => m.cat === cat);
        return (
          <section key={cat} id={catId(cat)} className="cust-cat">
            <h3 className="cust-cat-title">{catTitle(cat)}</h3>
            <ul className="cust-card cust-list">
              {items.map((m) => {
                const id = `${m.name}-${m.price_poisha}`;
                const facts = factsText(m);
                const expanded = open === id && hasFacts(m);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSheetDish(m);
                        setOpen(expanded ? null : id);
                      }}
                      aria-expanded={hasFacts(m) ? expanded : undefined}
                      aria-haspopup={hasFacts(m) ? 'dialog' : undefined}
                      disabled={!hasFacts(m)}
                      className="cust-dish"
                    >
                      <span className="cust-photo">
                        {m.photoUrl ? (
                          <DishPhoto src={m.photoUrl} sizes="72px" />
                        ) : (
                          <UtensilsCrossed aria-hidden className="size-6" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block leading-snug font-semibold">{name(m)}</span>
                        {m.description ? (
                          <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] leading-snug text-muted">
                            {m.description}
                          </span>
                        ) : null}
                        {facts ? (
                          <span className="cust-facts mt-1.5">
                            <Flame aria-hidden />
                            {facts}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        <span className="cust-price">
                          {formatMoney(m.price_poisha, loc, currency)}
                        </span>
                        {hasFacts(m) ? (
                          <ChevronRight aria-hidden className="size-4 text-muted" />
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <dialog
        ref={sheet}
        className="cust-sheet"
        aria-labelledby="dish-sheet-name"
        onClose={() => setOpen(null)}
        onClick={(e) => {
          // A tap on the dimmed page above the sheet closes it.
          if (e.target === e.currentTarget) setOpen(null);
        }}
      >
        {sheetDish ? (
          <div className="cust-sheet-body">
            <div aria-hidden className="cust-grabber" />
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label={t('closeAnswer')}
              className="cust-sheet-close"
            >
              <X aria-hidden className="size-4" />
            </button>
            {sheetDish.photoUrl ? (
              <span className="cust-sheet-photo mt-3">
                <DishPhoto
                  key={sheetDish.photoUrl}
                  src={sheetDish.photoUrl}
                  sizes="(max-width: 36rem) 100vw, 36rem"
                />
              </span>
            ) : null}
            <div
              className={cn(
                'mt-4 flex items-start justify-between gap-4',
                !sheetDish.photoUrl && 'pe-11',
              )}
            >
              <h3 id="dish-sheet-name" className="cust-h2 min-w-0">
                {name(sheetDish)}
              </h3>
              <p className="cust-price pt-0.5 text-lg">
                {formatMoney(sheetDish.price_poisha, loc, currency)}
              </p>
            </div>
            {sheetDish.description ? (
              <p className="mt-1.5 text-sm leading-relaxed text-secondary">
                {sheetDish.description}
              </p>
            ) : null}
            {sheetFacts ? (
              <p className="cust-facts mt-3">
                <Flame aria-hidden />
                {sheetFacts}
              </p>
            ) : null}
            <dl className="mt-4 grid grid-cols-3 gap-2">
              <div className="cust-stat">
                <dt className="text-xs text-muted">{t('carbs')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {t('grams', { n: grams(Number(sheetDish.carbs_g ?? 0)) })}
                </dd>
              </div>
              <div className="cust-stat">
                <dt className="text-xs text-muted">{t('fat')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {t('grams', { n: grams(Number(sheetDish.fat_g ?? 0)) })}
                </dd>
              </div>
              <div className="cust-stat">
                <dt className="text-xs text-muted">{t('protein')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {t('grams', { n: grams(Number(sheetDish.protein_g)) })}
                </dd>
              </div>
            </dl>
            <p
              className={cn(
                'cust-note mt-3',
                sheetAllergens.length ? 'cust-note--warn' : 'cust-note--calm',
              )}
            >
              {sheetAllergens.length ? <TriangleAlert aria-hidden /> : <ShieldCheck aria-hidden />}
              {sheetAllergens.length
                ? t('contains', {
                    list: sheetAllergens
                      .filter((a): a is Allergen => (ALLERGENS as readonly string[]).includes(a))
                      .map((a) => ta(a))
                      .join(', '),
                  })
                : t('containsNone')}
            </p>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
