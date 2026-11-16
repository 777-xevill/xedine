'use client';

import { Check, Clapperboard, Shuffle, Sparkles, Wand2 } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Hint, Input, Label, Select, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/segmented';
import { formatBDT } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { draftSocialVideoWordsAction, requestSocialVideoAction } from '@/modules/social/actions';
import { seedOf, type SocialTone } from '@/modules/social/look';
import type { StudioDish } from '@/components/social-studio';
import {
  type VideoContent,
  type VideoLabels,
  videoHtml,
  type VideoWords,
  VIDEO_SIZE,
} from '@/modules/social/video';
import { resolveVideoLook, VIDEO_KINDS, type VideoKind } from '@/modules/social/video-look';
import { type AiVideoWords, type Occasion } from '@/modules/social/video-words';
import { occasionLook } from '@/modules/social/culture';

type Lang = 'bn' | 'en';

export interface VideoStudioText {
  labels: VideoLabels;
  defaults: Omit<VideoWords, 'cta'>;
  cta: string;
  greetings: Record<Exclude<Occasion, 'custom'>, string>;
}

const NEED: Record<VideoKind, (n: number) => boolean> = {
  showcase: (n) => n === 1,
  offer: (n) => n === 1,
  versus: (n) => n === 2,
  combo: (n) => n === 2,
  carousel: (n) => n === 3,
  ring: (n) => n === 3,
  search: (n) => n >= 2,
};
const AUTO_KIND = (n: number): VideoKind => (n <= 1 ? 'showcase' : n === 2 ? 'versus' : 'carousel');

/** Special days only Bangladesh keeps: named with the country when a restaurant elsewhere sees them. */
const BD_ONLY: readonly Occasion[] = ['boishakh', 'victory_day', 'independence_day'];

/** A numbered step heading, so the page reads top to bottom: pick, choose, words, post. */
function Step({ n, title }: { n: number; title: string }) {
  return (
    <p className="mb-2 flex items-center gap-2 font-semibold">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-purple text-xs font-bold text-white tabular-nums">
        {n}
      </span>
      {title}
    </p>
  );
}

/** The video page drawn by the same code as the real one, playing in a box `width` pixels wide. */
function VideoFrame({ html, width, title }: { html: string; width: number; title: string }) {
  const scale = width / VIDEO_SIZE.width;
  return (
    <div
      className="relative overflow-hidden rounded-input bg-surface-elevated"
      style={{ width, height: Math.round(VIDEO_SIZE.height * scale) }}
    >
      <iframe
        title={title}
        srcDoc={html}
        // Its own script only fits the words and plays the animations; it can never reach this page.
        sandbox="allow-scripts"
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{ width: VIDEO_SIZE.width, height: VIDEO_SIZE.height, transform: `scale(${scale})` }}
      />
    </div>
  );
}

/**
 * Growth → Video (ADR 0061): pick one to three dishes, the kind of video, a special day (or write your own),
 * let the AI write the words or type them, see the video play, then make it now or later. The job adds
 * music, sounds and (on some videos) the AI voice, and posts it.
 */
export function SocialVideoStudio({
  orgId,
  orgSlug,
  dishes,
  brand,
  language,
  text,
  aiOn,
  tone,
  place,
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
  text: Record<Lang, VideoStudioText>;
  aiOn: boolean;
  tone: SocialTone;
  /**
   * The restaurant's country (ADR 0061): its own special days listed first, its national day by name, its
   * flag on that day, and no prices or offer videos where the menu has no taka.
   */
  place: {
    country: string;
    countryName: string;
    nationalDay: string | null;
    own: Occasion[];
    other: Occasion[];
    pricesOn: boolean;
  };
}) {
  const t = useTranslations('social.video');
  const tg = useTranslations('social.growth');
  const [picked, setPicked] = useState<string[]>(dishes[0] ? [dishes[0].id] : []);
  const [kind, setKind] = useState<VideoKind | ''>('');
  const [occasion, setOccasion] = useState<Occasion | ''>('');
  const [occasionText, setOccasionText] = useState('');
  const [lang, setLang] = useState<Lang>(language === 'en' ? 'en' : 'bn');
  const [idea, setIdea] = useState('');
  const [offer, setOffer] = useState('');
  const [seed, setSeed] = useState(0);
  const [ai, setAi] = useState<AiVideoWords | null>(null);
  const [own, setOwn] = useState<
    Partial<Record<'hook' | 'tagline' | 'punch' | 'question', string>>
  >({});
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const chosen = picked
    .map((id) => dishes.find((d) => d.id === id))
    .filter((d): d is StudioDish => !!d);
  const n = chosen.length;
  const fits = VIDEO_KINDS.filter((k) => NEED[k](n) && (k !== 'offer' || place.pricesOn));
  const realKind: VideoKind = kind && NEED[kind](n) ? kind : AUTO_KIND(n);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));

  const look = resolveVideoLook(
    seedOf(`${orgId}:${seed}:${realKind}`),
    { tone, dishes: Math.max(1, n), offer: realKind === 'offer', hot: true },
    realKind,
  );
  const line = (k: 'hook' | 'tagline' | 'punch' | 'question') =>
    own[k]?.trim() || ai?.[`${k}_${lang}`]?.trim() || text[lang].defaults[k];
  const greeting =
    occasion === 'custom' ? occasionText.trim() : occasion ? text[lang].greetings[occasion] : '';
  const offerPoisha = /^\d{1,7}(\.\d{1,2})?$/.test(offer) ? Math.round(Number(offer) * 100) : null;

  // Building the page is a few milliseconds of string work; the iframe reloads only when it changes.
  const html = (() => {
    if (n === 0) return '';
    const content: VideoContent = {
      look,
      words: {
        hook: line('hook'),
        tagline: line('tagline'),
        punch: line('punch'),
        question: line('question'),
        cta: text[lang].cta,
      },
      labels: text[lang].labels,
      ...brand,
      dishes: chosen.map((d, i) => {
        const name = lang === 'bn' && d.nameBn?.trim() ? d.nameBn.trim() : d.name;
        const menuPrice = place.pricesOn ? d.price[lang] : null;
        const isOffer = realKind === 'offer' && i === 0 && offerPoisha;
        return {
          name,
          cutUrl: d.cutUrl,
          photoUrl: d.photoUrl,
          price: isOffer ? formatBDT(offerPoisha, lang, { poisha: 'never' }) : menuPrice,
          was: isOffer ? menuPrice : null,
          note: d.note,
        };
      }),
      occasion:
        occasion && greeting ? { greeting, ...occasionLook(occasion, place.country) } : null,
      preview: true,
    };
    return videoHtml(content);
  })();

  const write = async () => {
    setBusy(true);
    setAiError(null);
    const res = await draftSocialVideoWordsAction({
      orgId,
      orgSlug,
      itemIds: picked,
      kind: realKind,
      occasion: greeting || null,
      occasionKey: occasion || null,
      idea,
    });
    setBusy(false);
    if (res.ok) {
      setAi(res.words);
      setOwn({});
    } else setAiError(res.error);
  };

  if (dishes.length === 0) return <Alert tone="info">{t('make.noDishes')}</Alert>;
  const approved = JSON.stringify({
    ...Object.fromEntries(
      (['hook', 'tagline', 'punch', 'question'] as const)
        .map((k) => [k, own[k]?.trim() || ai?.[`${k}_${lang}`]?.trim() || ''])
        .filter(([, v]) => v),
    ),
    ...(ai?.caption_bn ? { caption_bn: ai.caption_bn } : {}),
    ...(ai?.caption_en ? { caption_en: ai.caption_en } : {}),
    lang,
  });

  return (
    <div className="space-y-6">
      <section>
        <Step n={1} title={t('make.pickDishes')} />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
          {dishes.map((d) => {
            const at = picked.indexOf(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                aria-pressed={at >= 0}
                className={cn(
                  'relative overflow-hidden rounded-input border text-left transition',
                  at >= 0
                    ? 'border-purple ring-2 ring-purple'
                    : 'border-line hover:border-secondary',
                )}
              >
                <span className="relative block aspect-square bg-surface-elevated">
                  <Image
                    src={d.cutUrl ?? d.photoUrl}
                    alt=""
                    fill
                    unoptimized
                    sizes="120px"
                    className="object-cover"
                  />
                </span>
                <span className="block truncate px-2 py-1 text-xs font-medium">{d.name}</span>
                {at >= 0 ? (
                  <span className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-purple text-xs font-bold text-white">
                    {at + 1}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <Hint className="mt-2">{t('make.pickHint')}</Hint>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div ref={box} className="min-w-0">
          {width > 0 && html ? (
            <VideoFrame html={html} width={Math.min(width, 340)} title={t('make.preview')} />
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSeed((x) => x + 1)}
            >
              <Shuffle aria-hidden className="size-4" />
              {t('make.anotherLook')}
            </Button>
            {language === 'both' ? (
              <Segmented
                label={t('make.language')}
                size="sm"
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'bn', label: t('make.bangla') },
                  { value: 'en', label: t('make.english') },
                ]}
              />
            ) : null}
          </div>
          <Hint className="mt-2">{t('make.previewHint')}</Hint>
        </div>

        <div className="min-w-0 space-y-4">
          <Step n={2} title={t('make.stepChoose')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sv-kind">{t('make.kind')}</Label>
              <Select
                id="sv-kind"
                value={kind && fits.includes(kind) ? kind : ''}
                onChange={(e) => setKind(e.target.value as VideoKind | '')}
              >
                <option value="">{t('make.kindAuto')}</option>
                {fits.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="sv-occasion">{t('make.occasion')}</Label>
              <Select
                id="sv-occasion"
                value={occasion}
                onChange={(e) => setOccasion(e.target.value as Occasion | '')}
              >
                <option value="">{t('make.occasionNone')}</option>
                <optgroup label={t('settings.ownDays', { country: place.countryName })}>
                  {place.own.map((o) => (
                    <option key={o} value={o}>
                      {o === 'national_day' && place.nationalDay
                        ? place.nationalDay
                        : t(`occasionNames.${o}`)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('settings.otherDays')}>
                  {place.other.map((o) => (
                    <option key={o} value={o}>
                      {place.country !== 'BD' && BD_ONLY.includes(o)
                        ? t('make.bdDay', { name: t(`occasionNames.${o}`) })
                        : t(`occasionNames.${o}`)}
                    </option>
                  ))}
                  <option value="custom">{t('occasionNames.custom')}</option>
                </optgroup>
              </Select>
            </div>
            {occasion === 'custom' ? (
              <div className="sm:col-span-2">
                <Label htmlFor="sv-occasion-text">{t('make.occasionText')}</Label>
                <Input
                  id="sv-occasion-text"
                  maxLength={80}
                  value={occasionText}
                  onChange={(e) => setOccasionText(e.target.value)}
                  placeholder={t('make.occasionTextExample')}
                />
              </div>
            ) : null}
            {realKind === 'offer' ? (
              <div className="sm:col-span-2">
                <Label htmlFor="sv-offer">{t('make.offerPrice')}</Label>
                <Input
                  id="sv-offer"
                  inputMode="decimal"
                  value={offer}
                  onChange={(e) => setOffer(e.target.value)}
                  placeholder={chosen[0]?.price[lang] ?? ''}
                />
                <Hint className="mt-1">{t('make.offerHint')}</Hint>
              </div>
            ) : null}
          </div>

          {place.pricesOn ? null : <Hint>{t('settings.priceNote')}</Hint>}

          <Step n={3} title={t('make.stepWords')} />
          <div>
            <Label htmlFor="sv-idea">{t('make.idea')}</Label>
            <Textarea
              id="sv-idea"
              rows={2}
              maxLength={300}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder={t('make.ideaExample')}
            />
          </div>
          {aiOn ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={write} disabled={busy || n === 0}>
                <Wand2 aria-hidden className="size-4" />
                {busy ? t('make.writing') : ai ? t('make.rewrite') : t('make.write')}
              </Button>
              {ai ? (
                <Badge tone="accent" icon={<Sparkles />}>
                  {t('make.aiWrote')}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {aiError ? <Alert tone="danger">{t(`make.errors.${aiError}`)}</Alert> : null}

          <div className="grid gap-3">
            {(
              [
                ['hook', 120],
                ['tagline', 120],
                ...(realKind === 'combo' ? [['punch', 60] as const] : []),
                ...(realKind === 'versus' || realKind === 'ring'
                  ? [['question', 80] as const]
                  : []),
              ] as const
            ).map(([k, max]) => (
              <div key={k}>
                <Label htmlFor={`sv-${k}`}>{t(`make.lines.${k}`)}</Label>
                <Input
                  id={`sv-${k}`}
                  maxLength={max}
                  value={own[k] ?? ai?.[`${k}_${lang}`] ?? ''}
                  placeholder={text[lang].defaults[k]}
                  onChange={(e) => setOwn((o) => ({ ...o, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <ActionForm
            action={requestSocialVideoAction}
            successKey="social.video.make.requested"
            className="space-y-3 border-t border-line pt-4"
          >
            <Step n={4} title={t('make.stepPost')} />
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="orgSlug" value={orgSlug} />
            {picked.map((id) => (
              <input key={id} type="hidden" name="dish" value={id} />
            ))}
            <input type="hidden" name="kind" value={kind && fits.includes(kind) ? kind : ''} />
            <input type="hidden" name="occasion" value={occasion} />
            <input type="hidden" name="occasionText" value={occasionText} />
            <input type="hidden" name="offer" value={realKind === 'offer' ? offer : ''} />
            <input type="hidden" name="ownText" value={idea} />
            <input type="hidden" name="spec" value={JSON.stringify(look)} />
            <input type="hidden" name="words" value={approved} />
            <input type="hidden" name="when" value={when} />
            <Segmented
              label={tg('when')}
              value={when}
              onChange={setWhen}
              options={[
                { value: 'now', label: tg('whenNow') },
                { value: 'later', label: tg('whenLater') },
              ]}
            />
            {when === 'later' ? (
              <div className="grid grid-cols-2 gap-2">
                <Input name="date" type="date" aria-label={tg('date')} required />
                <Input name="time" type="time" aria-label={tg('time')} required />
              </div>
            ) : null}
            <Button type="submit" disabled={n === 0}>
              <Clapperboard aria-hidden className="size-4" />
              {t('make.submit')}
            </Button>
            <Hint>
              <Check aria-hidden className="mr-1 inline size-4" />
              {t('make.submitHint')}
            </Hint>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
