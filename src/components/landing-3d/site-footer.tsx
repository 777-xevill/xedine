import { ArrowUpRight, Mail } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LEGAL_CONTACT } from '@/lib/contact';
import { now } from '@/lib/time/clock';
import { TRIAL_DAYS, type PlanRowId } from './pricing';

/** Xedine's Facebook Page (made 2026-11-19). */
const FACEBOOK_PAGE = 'https://www.facebook.com/profile.php?id=61596738838757';

/** The big features the footer lists; the words are the pricing rows'. */
const FEATURE_ROWS: readonly PlanRowId[] = [
  'till',
  'stock',
  'leaks',
  'dishProfit',
  'posters',
  'videos',
  'tableQr',
  'memberCard',
  'forecast',
  'foodSafety',
  'branches',
];

/**
 * The end of the home page, after the founder's reference (2026-11-19): a quiet "still deciding?" ask, a "next
 * step" with two buttons, then a footer in four columns (Xedine, the site's links, what it does, where else to
 * find it), a huge faint wordmark and a last line. The privacy and terms links stay: Google and Meta check them.
 */
export async function SiteFooter() {
  const [t, tc, tl, tp, tlegal] = await Promise.all([
    getTranslations('landing.end'),
    getTranslations('common'),
    getTranslations('landing'),
    getTranslations('landing3d.day.pricing'),
    getTranslations('legal'),
  ]);
  const days = TRIAL_DAYS;
  const mail = `mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent(t('mailSubject'))}`;

  return (
    <footer className="relative overflow-hidden bg-background px-4 sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Still deciding? */}
        <section data-reveal className="pt-20 pb-24 text-center sm:pt-28 sm:pb-32">
          <h2 className="mx-auto max-w-xl text-3xl leading-[1.05] font-bold tracking-[-0.03em] text-balance sm:text-5xl">
            {t('decideTitle')}
          </h2>
          <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-[color:var(--text-muted)]">
            {t('decideBody', { days })}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Cta href="/sign-up" solid>
              {tp('cta', { days })}
            </Cta>
            <Cta href="#pricing">{t('seePlans')}</Cta>
          </div>
        </section>

        {/* Next step */}
        <section
          data-reveal
          className="flex flex-col gap-8 pb-14 sm:flex-row sm:items-end sm:justify-between"
        >
          <div className="max-w-md">
            <p className="text-[10px] font-semibold tracking-[0.25em] text-[color:var(--text-muted)] uppercase">
              {t('nextEyebrow')}
            </p>
            <h2 className="mt-3 text-3xl leading-[1.05] font-bold tracking-[-0.03em] text-balance sm:text-5xl">
              {t('nextTitle')}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[color:var(--text-muted)]">
              {t('nextBody')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Cta href="/sign-up" solid>
              {t('start')}
            </Cta>
            <Cta href={mail} external>
              {t('talk')}
            </Cta>
          </div>
        </section>

        {/* Four columns */}
        <div className="grid gap-10 border-t border-[color-mix(in_srgb,var(--brand-silver)_12%,transparent)] pt-12 pb-16 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="inline-flex items-center gap-2.5">
              <Image
                src="/brand/logo-chef-192.png"
                alt=""
                width={28}
                height={28}
                className="rounded-[21%]"
              />
              <span className="text-base font-bold tracking-tight text-[var(--brand-silver)]">
                {tc('appName')}
              </span>
            </span>
            <p className="mt-4 max-w-[16rem] text-xs leading-relaxed text-[color:var(--text-muted)]">
              {t('tagline')} {tl('footer')}
            </p>
          </div>
          <Column title={tc('appName')}>
            <FootLink href="#everything">{t('links.features')}</FootLink>
            <FootLink href="#pricing">{t('links.pricing')}</FootLink>
            <FootLink href="/sign-in">{tc('signIn')}</FootLink>
            <FootLink href="/sign-up">{tc('signUp')}</FootLink>
            <FootLink href="/privacy">{tlegal('privacyLink')}</FootLink>
            <FootLink href="/terms">{tlegal('termsLink')}</FootLink>
          </Column>
          <Column title={t('whatTitle')}>
            {FEATURE_ROWS.map((id) => (
              <FootLink key={id} href="#everything">
                {tp(`rows.${id}`)}
              </FootLink>
            ))}
          </Column>
          <Column title={t('elsewhere')}>
            <div className="flex gap-2">
              <Social href={mail} label={t('email')}>
                <Mail className="size-4" />
              </Social>
              <Social href={FACEBOOK_PAGE} label={t('facebook')}>
                <FacebookMark />
              </Social>
            </div>
            <p className="mt-3 text-xs text-[color:var(--text-muted)]">{LEGAL_CONTACT}</p>
          </Column>
        </div>
      </div>

      {/* The huge faint wordmark, and the last line */}
      <p
        aria-hidden
        className="pointer-events-none text-center text-[26vw] leading-[0.8] font-bold tracking-[-0.06em] text-[color-mix(in_srgb,var(--brand-silver)_9%,transparent)] select-none lg:text-[18rem]"
      >
        {tc('appName')}
      </p>
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--brand-silver)_8%,transparent)] py-6 text-[10px] font-semibold tracking-[0.2em] text-[color:var(--text-muted)] uppercase sm:flex-row">
        <span>{t('rights', { year: String(now().getFullYear()), name: tc('appName') })}</span>
        <span>{t('promise')}</span>
      </div>
    </footer>
  );
}

function Cta({
  href,
  solid,
  external,
  children,
}: {
  href: string;
  solid?: boolean;
  external?: boolean;
  children: ReactNode;
}) {
  const className = solid
    ? 'btn-shine relative inline-flex items-center gap-1.5 overflow-hidden rounded-full bg-[var(--brand-yellow)] px-5 py-2.5 text-xs font-semibold text-[var(--brand-grey)] transition-transform active:scale-[0.98]'
    : 'inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_25%,transparent)] px-5 py-2.5 text-xs font-semibold transition-colors hover:border-[var(--brand-yellow)] hover:text-[var(--brand-yellow)] active:scale-[0.98]';
  const body = (
    <>
      {children}
      <ArrowUpRight aria-hidden className="size-3.5" />
    </>
  );
  return external || href.startsWith('#') ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.25em] text-[color:var(--text-muted)] uppercase">
        {title}
      </p>
      <div className="mt-4 flex flex-col items-start gap-2.5">{children}</div>
    </div>
  );
}

function FootLink({ href, children }: { href: string; children: ReactNode }) {
  const className =
    'text-xs text-[color:var(--text-secondary)] transition-colors hover:text-[var(--brand-yellow)]';
  return href.startsWith('#') ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function Social({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="grid size-9 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--brand-silver)_16%,transparent)] text-[color:var(--text-secondary)] transition-colors hover:border-[var(--brand-yellow)] hover:text-[var(--brand-yellow)]"
    >
      {children}
    </a>
  );
}

/** Facebook's "f" in a circle, drawn in the current colour (lucide no longer ships brand icons). */
function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-1.56 19.88v-7H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v7A10 10 0 0 0 12 2Z" />
    </svg>
  );
}
