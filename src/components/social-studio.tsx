'use client';

import { Check, Sparkles, Wand2 } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Hint, Input, Label, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { draftSocialWordsAction, requestSocialPostAction } from '@/modules/social/actions';
import { DESIGN_EXTRAS, POSTER_DESIGNS, type PosterDesign } from '@/modules/social/schedule';
import {
  type DishArt,
  type PosterLabels,
  type PosterLang,
  type PostContent,
  posterHtml,
  POSTER_SIZE,
} from '@/modules/social/templates';
import { type DefaultLines, posterWords, type SocialWords } from '@/modules/social/words';

export interface StudioDish {
  id: string;
  name: string;
  nameBn: string | null;
  photoUrl: string;
  /** The dish lifted off its photo (AI studio plate first), or null when only the photo can be shown. */
  cutUrl: string | null;
  /** True when the job has not cut this photo out yet. */
  pending: boolean;
  price: { bn: string | null; en: string | null };
  note: string | null;
}

export interface StudioPosterText {
  cta: string;
  labels: PosterLabels;
  defaults: DefaultLines;
}

/** The lines the owner can change, per poster language (the MOOD lines are English only). */
const LINES: { key: string; label: string; en?: boolean; long?: boolean }[] = [
  { key: 'kicker', label: 'kicker' },
  { key: 'status_q', label: 'statusQ' },
  { key: 'status_a', label: 'statusA' },
  { key: 'status_b', label: 'statusB' },
  { key: 'status_c', label: 'statusC' },
  { key: 'mood_top', label: 'moodTop', en: true },
  { key: 'mood_bottom', label: 'moodBottom', en: true },
  { key: 'hook', label: 'hook' },
  { key: 'caption', label: 'caption', long: true },
];

/** A poster drawn by the same code as the real one, scaled down into a box of `width` pixels. */
function PosterFrame({ html, width, title }: { html: string; width: number; title: string }) {
  const scale = width / POSTER_SIZE.width;
  return (
    <div
      className="relative overflow-hidden rounded-input bg-surface-elevated"
      style={{ width, height: Math.round(POSTER_SIZE.height * scale) }}
    >
      <iframe
        title={title}
        srcDoc={html}
        // Its own script only shrinks long headlines to fit; it can never reach this page.
        sandbox="allow-scripts"
        loading="lazy"
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{
          width: POSTER_SIZE.width,
          height: POSTER_SIZE.height,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Growth → make a post (ADR 0057): pick a dish (and more for the menu styles), pick a style from live
 * previews of that dish, say what the post is about and let the AI write the words, change any line,
 * then post now or later. The preview is the real poster: the same templates the job renders.
 */
export function SocialStudio({
  orgId,
  orgSlug,
  dishes,
  brand,
  language,
  poster,
  aiOn,
}: {
  orgId: string;
  orgSlug: string;
  dishes: StudioDish[];
  brand: {
    restaurant: string;
    area: string | null;
    phone: string | null;
    colorMain: string;
    colorAccent: string;
    logoUrl: string | null;
  };
  language: 'bn' | 'en' | 'both';
  poster: Record<PosterLang, StudioPosterText>;
  aiOn: boolean;
}) {
  const t = useTranslations('social');
  const [mainId, setMainId] = useState(dishes[0]?.id ?? '');
  const [alsoIds, setAlsoIds] = useState<string[]>([]);
  const [design, setDesign] = useState<PosterDesign>('status');
  const [lang, setLang] = useState<PosterLang>(language === 'en' ? 'en' : 'bn');
  const [words, setWords] = useState<Partial<SocialWords>>({});
  const [aiWords, setAiWords] = useState<Partial<SocialWords>>({});
  const [touched, setTouched] = useState(false);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [format, setFormat] = useState<'image' | 'video'>('image');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [previewRef, previewWidth] = useWidth<HTMLDivElement>();

  const byId = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes]);
  const main = byId.get(mainId) ?? dishes[0];
  if (!main) return null;
  const want = DESIGN_EXTRAS[design];
  const others = dishes.filter((d) => d.id !== main.id);
  // The other dishes the owner picked for this style, else the next ones on the menu.
  const picked = alsoIds
    .filter((id) => id !== main.id)
    .map((id) => byId.get(id))
    .filter((d): d is StudioDish => Boolean(d))
    .slice(0, want?.count ?? 0);
  const shown = picked.length ? picked : others.slice(0, want?.count ?? 0);
  const english = lang === 'en';
  const designs = POSTER_DESIGNS.filter((d) => d !== 'mood' || english);

  const art = (d: StudioDish): DishArt => ({
    name: lang === 'bn' && d.nameBn ? d.nameBn : d.name,
    cutUrl: d.cutUrl,
    photoUrl: d.photoUrl,
    price: d.price[lang],
    note: d.note,
  });
  const content = (w: Partial<SocialWords>, d: PosterDesign): PostContent => ({
    design: d,
    lang,
    words: posterWords(w, lang, art(main).name, poster[lang].defaults),
    cta: poster[lang].cta,
    badge: null,
    restaurant: brand.restaurant,
    area: brand.area,
    phone: brand.phone,
    colorMain: brand.colorMain,
    colorAccent: brand.colorAccent,
    dish: art(main),
    more: shown.map(art),
    logoUrl: brand.logoUrl,
    labels: poster[lang].labels,
  });
  const big = posterHtml(content(words, design));
  // The small previews follow the dish, the language and the AI's words, not every key press.
  const minis = designs.map((d) => ({ design: d, html: posterHtml(content(aiWords, d)) }));

  const toggleAlso = (id: string) =>
    setAlsoIds((c) =>
      c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-(want?.count ?? 1)),
    );
  const dishName = (d: StudioDish) => (lang === 'bn' && d.nameBn ? d.nameBn : d.name);
  const chip = (d: StudioDish, on: boolean, onClick: () => void, size: 'lg' | 'sm') => (
    <button
      key={d.id}
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'relative flex shrink-0 flex-col items-center gap-1 rounded-input border p-1.5 text-xs transition',
        size === 'lg' ? 'w-24' : 'w-20',
        on ? 'border-purple bg-purple/8' : 'border-line hover:border-purple/40',
      )}
    >
      <span
        className={cn(
          'relative overflow-hidden rounded-input bg-surface-elevated',
          size === 'lg' ? 'size-16' : 'size-12',
        )}
      >
        <Image
          src={d.cutUrl ?? d.photoUrl}
          alt=""
          fill
          unoptimized
          sizes="64px"
          className={d.cutUrl ? 'object-contain' : 'object-cover'}
        />
      </span>
      <span className="line-clamp-2 text-center leading-tight">{dishName(d)}</span>
      {on ? <Check aria-hidden className="absolute top-1 right-1 size-4 text-purple" /> : null}
    </button>
  );

  const write = async () => {
    setBusy(true);
    setAiError(null);
    const res = await draftSocialWordsAction({ orgId, orgSlug, itemId: main.id, idea });
    setBusy(false);
    if (!res.ok) {
      setAiError(res.error);
      return;
    }
    setWords(res.words);
    setAiWords(res.words);
    setTouched(true);
  };
  const field = (key: string) => `${key}_${lang}` as keyof SocialWords;
  const value = (key: string, en?: boolean) =>
    (words[(en ? `${key}_en` : field(key)) as keyof SocialWords] as string | undefined) ?? '';
  const change = (key: string, v: string, en?: boolean) => {
    setWords((w) => ({ ...w, [en ? `${key}_en` : field(key)]: v }));
    setTouched(true);
  };
  // Only the lines that were written or typed travel with the post, plus the previewed language.
  const approved = JSON.stringify({
    ...(touched
      ? Object.fromEntries(
          Object.entries(words).filter(([, v]) => typeof v === 'string' && v.trim()),
        )
      : {}),
    poster_lang: lang,
  });
  const extras = want?.need === 'cut' ? shown.slice(0, 3).map((d) => d.id) : [];

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('studio.dish')}</h3>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {dishes.map((d) => chip(d, d.id === main.id, () => setMainId(d.id), 'lg'))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('studio.style')}</h3>
          {language === 'both' ? (
            <Segmented
              size="sm"
              label={t('studio.posterLanguage')}
              value={lang}
              onChange={(v) => {
                setLang(v);
                if (v === 'bn' && design === 'mood') setDesign('status');
              }}
              options={[
                { value: 'bn', label: 'বাংলা' },
                { value: 'en', label: 'English' },
              ]}
            />
          ) : null}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {minis.map((m) => (
            <button
              key={m.design}
              type="button"
              onClick={() => setDesign(m.design)}
              aria-pressed={design === m.design}
              className={cn(
                'shrink-0 rounded-input border-2 p-1 text-left transition',
                design === m.design ? 'border-purple' : 'border-transparent hover:border-line',
              )}
            >
              <PosterFrame html={m.html} width={112} title={t(`designs.${m.design}.name`)} />
              <span className="mt-1 block w-28 text-xs font-semibold">
                {t(`designs.${m.design}.name`)}
              </span>
            </button>
          ))}
        </div>
        <Hint>{t(`designs.${design}.hint`)}</Hint>
        {want?.need === 'cut' && others.length ? (
          <div className="mt-3">
            <h4 className="mb-1 text-xs font-semibold text-secondary">
              {t('studio.also', { count: want.count })}
            </h4>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {others.map((d) =>
                chip(
                  d,
                  shown.some((s) => s.id === d.id),
                  () => toggleAlso(d.id),
                  'sm',
                ),
              )}
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div ref={previewRef} className="min-w-0">
          {previewWidth > 0 ? (
            <PosterFrame
              html={big}
              width={Math.min(previewWidth, 460)}
              title={t('studio.preview')}
            />
          ) : null}
          {!main.cutUrl ? (
            <Hint className="mt-2">{main.pending ? t('studio.pending') : t('studio.noCut')}</Hint>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <Label htmlFor="ss-idea">{t('studio.idea')}</Label>
            <Textarea
              id="ss-idea"
              rows={2}
              maxLength={300}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder={t('studio.ideaExample')}
            />
          </div>
          {aiOn ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={write} disabled={busy}>
                <Wand2 aria-hidden className="size-4" />
                {busy
                  ? t('studio.writing')
                  : Object.keys(aiWords).length
                    ? t('studio.rewrite')
                    : t('studio.write')}
              </Button>
              {Object.keys(aiWords).length ? (
                <Badge tone="accent" icon={<Sparkles />}>
                  {t('studio.aiWrote')}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {aiError ? <Alert tone="danger">{t(`studio.errors.${aiError}`)}</Alert> : null}
          {!touched ? <Hint>{t('studio.autoWords')}</Hint> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ss-headline">{t('studio.headline')}</Label>
              <Input
                id="ss-headline"
                maxLength={80}
                value={value('headline')}
                placeholder={art(main).name}
                onChange={(e) => change('headline', e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ss-tagline">{t('studio.tagline')}</Label>
              <Input
                id="ss-tagline"
                maxLength={140}
                value={value('tagline')}
                placeholder={poster[lang].defaults.tagline}
                onChange={(e) => change('tagline', e.target.value)}
              />
            </div>
          </div>
          <details className="rounded-input border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">{t('studio.more')}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {LINES.filter((l) => !l.en || english).map((l) => (
                <div key={l.key} className={l.long ? 'sm:col-span-2' : undefined}>
                  <Label htmlFor={`ss-${l.key}`}>{t(`studio.lines.${l.label}`)}</Label>
                  {l.long ? (
                    <Textarea
                      id={`ss-${l.key}`}
                      rows={4}
                      maxLength={1500}
                      value={value(l.key, l.en)}
                      onChange={(e) => change(l.key, e.target.value, l.en)}
                    />
                  ) : (
                    <Input
                      id={`ss-${l.key}`}
                      maxLength={l.key.startsWith('status_') && l.key !== 'status_q' ? 30 : 60}
                      value={value(l.key, l.en)}
                      onChange={(e) => change(l.key, e.target.value, l.en)}
                    />
                  )}
                </div>
              ))}
            </div>
          </details>

          <ActionForm
            action={requestSocialPostAction}
            successKey="social.growth.requested"
            className="space-y-3 border-t border-line pt-4"
          >
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="itemId" value={main.id} />
            <input type="hidden" name="design" value={design} />
            <input type="hidden" name="words" value={approved} />
            <input type="hidden" name="ownText" value={idea} />
            <input type="hidden" name="format" value={format} />
            <input type="hidden" name="when" value={when} />
            {extras.map((id) => (
              <input key={id} type="hidden" name="extra" value={id} />
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label={t('growth.format')}
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'image', label: t('growth.formats.image') },
                  { value: 'video', label: t('growth.formats.video') },
                ]}
              />
              <Segmented
                label={t('growth.when')}
                value={when}
                onChange={setWhen}
                options={[
                  { value: 'now', label: t('growth.whenNow') },
                  { value: 'later', label: t('growth.whenLater') },
                ]}
              />
            </div>
            {when === 'later' ? (
              <div className="grid grid-cols-2 gap-2">
                <Input name="date" type="date" aria-label={t('growth.date')} required />
                <Input name="time" type="time" aria-label={t('growth.time')} required />
              </div>
            ) : null}
            <Button type="submit">
              <Sparkles aria-hidden className="size-4" />
              {t('studio.post')}
            </Button>
            <Hint>{t('growth.makeHint')}</Hint>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
