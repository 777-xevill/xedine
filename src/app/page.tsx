import {
  ArrowRight,
  Building2,
  Camera,
  Check,
  ChefHat,
  CircleAlert,
  Flame,
  Languages,
  Megaphone,
  Music2,
  Package,
  Receipt,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  WifiOff,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties, ReactNode } from 'react';
import { ParticleGlobe } from '@/components/landing/particle-globe';
import { Layer, Stage3D } from '@/components/landing/stage-3d';
import { TiltCard } from '@/components/landing/tilt-card';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { buttonVariants } from '@/components/ui/button';
import { createClient } from '@/lib/db/supabase-server';
import { cn } from '@/lib/utils';

/*
 * The landing page wears the founder's own palette (ADR 0056): grey, silver, and yellow only for buttons
 * and small marks. The colours come from the .landing tokens in globals.css; the app inside is unchanged.
 */

const FEATURES: { key: string; icon: ReactNode }[] = [
  { key: 'pos', icon: <Receipt /> },
  { key: 'kds', icon: <ChefHat /> },
  { key: 'leaks', icon: <ShieldCheck /> },
  { key: 'menuProfit', icon: <Flame /> },
  { key: 'stock', icon: <Package /> },
  { key: 'plan', icon: <TrendingUp /> },
  { key: 'social', icon: <Megaphone /> },
  { key: 'assistant', icon: <Sparkles /> },
  { key: 'customers', icon: <Users /> },
  { key: 'branches', icon: <Building2 /> },
];

// Sample bars for the hero's mock sales chart (illustration only).
const BARS = [38, 52, 44, 68, 58, 84, 74];

// The globe behind the hero: grey dots with one yellow band.
const GLOBE = ['--landing-grey', '--landing-yellow', '--landing-grey', '--landing-grey'] as const;

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('slug')
      .order('name')
      .limit(1);
    const first = orgs?.[0];
    redirect(first ? `/${first.slug}` : '/onboarding');
  }

  const [t, tl, tlegal] = await Promise.all([
    getTranslations('common'),
    getTranslations('landing'),
    getTranslations('legal'),
  ]);

  const platforms = [
    { name: 'Facebook', icon: <span className="text-2xl font-black">{'f'}</span> },
    { name: 'Instagram', icon: <Camera /> },
    { name: 'TikTok', icon: <Music2 /> },
  ];

  return (
    <div className="landing relative isolate min-h-dvh overflow-x-clip">
      {/* Soft white light behind the hero's 3D stage. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[52rem]">
        <div className="absolute top-16 right-[2%] size-[30rem] rounded-full bg-surface opacity-90 blur-3xl" />
      </div>

      <header className="sticky top-0 z-30 border-b border-line bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Logo name={t('appName')} eager />
          <nav className="hidden items-center gap-6 text-sm font-medium text-secondary md:flex">
            {[
              { href: '#features', label: tl('navFeatures') },
              { href: '#social', label: tl('navSocial') },
              { href: '#how', label: tl('navHow') },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="decoration-landing-yellow decoration-[3px] underline-offset-8 hover:text-foreground hover:underline"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Link href="/sign-in" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              {t('signIn')}
            </Link>
            {/* On a phone the hero's own button is right below; the header keeps room for the logo. */}
            <Link
              href="/sign-up"
              className={cn(
                buttonVariants({ variant: 'primary', size: 'sm' }),
                'hidden sm:inline-flex',
              )}
            >
              {t('signUp')}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero: the pitch on the left, a 3D stage of the product on the right. */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div className="text-center lg:text-left">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-foreground shadow-soft">
              <span className="size-2 animate-pulse rounded-full bg-landing-yellow ring-2 ring-landing-yellow/30" />
              {tl('eyebrow')}
            </p>
            <h1 className="mt-5 text-4xl font-bold tracking-[-0.04em] text-balance sm:text-6xl">
              {tl('headline')} <span className="landing-mark">{tl('headlineAccent')}</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-balance text-secondary lg:mx-0">
              {tl('heroBody')}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
              <Link
                href="/sign-up"
                className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'gap-2')}
              >
                {t('signUp')}
                <ArrowRight className="size-4" />
              </Link>
              <a href="#features" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                {tl('seeFeatures')}
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-secondary lg:justify-start">
              {[
                { icon: <WifiOff />, label: tl('chipOffline') },
                { icon: <Languages />, label: tl('chipLanguage') },
                { icon: <ShieldCheck />, label: tl('chipBdt') },
              ].map((chip) => (
                <li key={chip.label} className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex size-6 items-center justify-center rounded-full bg-landing-yellow text-landing-grey [&>svg]:size-3.5"
                  >
                    {chip.icon}
                  </span>
                  {chip.label}
                </li>
              ))}
            </ul>
          </div>

          <div aria-hidden className="relative mx-auto h-[380px] w-full max-w-[540px] sm:h-[460px]">
            <ParticleGlobe colors={GLOBE} className="absolute -inset-[12%] size-[124%]" />
            <Stage3D className="absolute inset-0">
              <Layer depth={0} className="top-[18%] left-[9%] w-[82%]">
                <div className="rounded-card border border-line bg-surface p-5 shadow-lift">
                  <p className="text-xs font-medium text-muted">{tl('mockSales')}</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight">{tl('mockSalesValue')}</p>
                  <p className="mt-1 inline-flex rounded-full bg-landing-grey px-2 py-0.5 text-xs font-semibold text-landing-yellow">
                    {tl('mockSalesDelta')}
                  </p>
                  <div className="mt-4 flex h-24 items-end gap-2 sm:h-28">
                    {BARS.map((height, i) => (
                      <span
                        key={i}
                        className={cn(
                          'flex-1 rounded-t-lg',
                          i === 5 ? 'bg-landing-yellow' : 'bg-landing-silver',
                        )}
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>
              </Layer>

              <Layer depth={110} delay={-1.5} className="top-[2%] right-[-3%] w-52 sm:w-56">
                <MockCard
                  icon={<CircleAlert />}
                  tone="bg-landing-yellow text-landing-grey"
                  title={tl('mockLeakTitle')}
                  body={tl('mockLeakBody')}
                />
              </Layer>

              <Layer depth={70} delay={-3} className="top-[54%] left-[-5%] w-48 sm:w-52">
                <MockCard
                  icon={<Receipt />}
                  tone="bg-landing-grey text-landing-yellow"
                  title={tl('mockOrderTitle')}
                  body={tl('mockOrderBody')}
                />
              </Layer>

              <Layer depth={50} delay={-4.5} className="top-[0%] left-[2%] w-44">
                <MockCard
                  icon={<Package />}
                  tone="bg-landing-silver text-landing-grey"
                  title={tl('mockStockTitle')}
                  body={tl('mockStockBody')}
                />
              </Layer>

              <Layer depth={150} delay={-2.2} className="right-[2%] bottom-[0%] w-60">
                <div className="rounded-card border border-line bg-surface p-3.5 shadow-lift">
                  <div className="flex items-center gap-2">
                    <span className="flex -space-x-1.5">
                      {platforms.map((p) => (
                        <span
                          key={p.name}
                          className="inline-flex size-7 items-center justify-center rounded-full border-2 border-surface bg-landing-grey text-landing-silver [&>span]:text-sm [&>svg]:size-3.5"
                        >
                          {p.icon}
                        </span>
                      ))}
                    </span>
                    <span className="text-sm font-semibold">{tl('mockSocialTitle')}</span>
                    <span className="ml-auto inline-flex size-5 items-center justify-center rounded-full bg-landing-yellow text-landing-grey">
                      <Check className="size-3.5" />
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{tl('mockSocialBody')}</p>
                </div>
              </Layer>

              <Layer depth={190} delay={-0.8} className="top-[30%] right-[-5%]">
                <span className="inline-flex size-14 items-center justify-center rounded-full bg-landing-yellow text-2xl font-black text-landing-grey shadow-lift ring-4 ring-surface">
                  {'৳'}
                </span>
              </Layer>
            </Stage3D>
          </div>
        </section>

        {/* Features: every module, each card tilting in 3D under the mouse. */}
        <section id="features" className="scroll-mt-20 border-y border-line bg-surface py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead
              eyebrow={tl('featuresEyebrow')}
              title={tl('featuresTitle')}
              body={tl('featuresBody')}
            />
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {FEATURES.map((f) => (
                <li key={f.key}>
                  <TiltCard className="group h-full rounded-card border border-line bg-background p-5">
                    <span
                      aria-hidden
                      className="inline-flex size-11 items-center justify-center rounded-xl bg-landing-grey text-landing-yellow transition-colors group-hover:bg-landing-yellow group-hover:text-landing-grey [&>svg]:size-5"
                    >
                      {f.icon}
                    </span>
                    <h3 className="mt-4 font-semibold">{tl(`features.${f.key}.title`)}</h3>
                    <p className="mt-1 text-sm text-secondary">{tl(`features.${f.key}.body`)}</p>
                  </TiltCard>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Social autopilot, on a grey band: a phone with the day's poster, the platforms orbiting it in 3D. */}
        <section id="social" className="landing-dark scroll-mt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-24 sm:px-6 lg:grid-cols-2">
            <div
              aria-hidden
              className="relative mx-auto flex h-[420px] w-full max-w-[460px] items-center justify-center [perspective:1100px]"
            >
              <div className="absolute size-72 rounded-full bg-landing-silver/10 blur-3xl" />
              <div className="relative h-[300px] w-[160px] [transform-style:preserve-3d]">
                <div className="landing-rock absolute inset-0 overflow-hidden rounded-[1.75rem] border-[6px] border-landing-silver bg-white">
                  <div className="h-[62%] bg-landing-yellow p-3">
                    <span className="inline-flex rounded-full bg-landing-grey px-2 py-0.5 text-[10px] font-bold text-landing-yellow">
                      {tl('mockPosterTag')}
                    </span>
                    <p className="mt-16 text-lg leading-tight font-black text-landing-grey">
                      {tl('mockPosterDish')}
                    </p>
                  </div>
                  <div className="flex items-center justify-between p-3 text-landing-grey">
                    <span className="text-xl font-black">{tl('mockPosterPrice')}</span>
                    <Send className="size-4" />
                  </div>
                </div>
                <div className="landing-orbit absolute inset-0 [--orbit-r:135px] sm:[--orbit-r:190px]">
                  {platforms.map((p, i) => (
                    <div
                      key={p.name}
                      className="absolute top-1/2 left-1/2 -mt-8 -ml-8 [transform-style:preserve-3d]"
                      style={{ transform: `rotateY(${i * 120}deg) translateZ(var(--orbit-r))` }}
                    >
                      <div
                        className="landing-face inline-flex size-16 items-center justify-center rounded-2xl bg-landing-silver text-landing-grey [&>svg]:size-7"
                        style={{ '--a': `${i * 120}deg` } as CSSProperties}
                      >
                        {p.icon}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <SectionHead
                align="left"
                eyebrow={tl('socialEyebrow')}
                title={tl('socialTitle')}
                body={tl('socialBody')}
              />
              <ol className="mt-8 space-y-4">
                {[tl('socialStep1'), tl('socialStep2'), tl('socialStep3')].map((step, i) => (
                  <li
                    key={step}
                    className="flex gap-4 rounded-card border border-line bg-surface p-4"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-landing-yellow font-bold text-landing-grey">
                      {i + 1}
                    </span>
                    <p className="self-center text-secondary">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* How it works: three raised 3D keys. */}
        <section id="how" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead eyebrow={tl('stepsEyebrow')} title={tl('stepsTitle')} />
            <ol className="mt-14 grid gap-10 sm:grid-cols-3">
              {(['1', '2', '3'] as const).map((n) => (
                <li key={n} className="text-center">
                  <span className="landing-block mx-auto inline-flex size-20 items-center justify-center rounded-2xl text-3xl font-black">
                    {n}
                  </span>
                  <h3 className="mt-6 text-lg font-semibold">{tl(`step${n}Title`)}</h3>
                  <p className="mt-1 text-secondary">{tl(`step${n}Body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="landing-dark relative overflow-hidden rounded-sheet px-6 py-14 text-center sm:px-12">
            <Image
              src="/brand/logo-chef-192.png"
              alt=""
              width={72}
              height={72}
              className="mx-auto rounded-[21%]"
            />
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              {tl('ctaTitle')}
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-balance text-secondary">{tl('ctaBody')}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/sign-up"
                className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'gap-2')}
              >
                {t('signUp')}
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex min-h-14 items-center rounded-full px-7 font-semibold text-foreground ring-1 ring-line-strong hover:bg-surface"
              >
                {t('signIn')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
          <Logo name={t('appName')} size="sm" />
          <p>{tl('footer')}</p>
          <nav className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground hover:underline">
              {tlegal('privacyLink')}
            </Link>
            <Link href="/terms" className="hover:text-foreground hover:underline">
              {tlegal('termsLink')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** The new chef logo tile and the name (landing page only for now). */
function Logo({ name, size = 'md', eager }: { name: string; size?: 'sm' | 'md'; eager?: boolean }) {
  const px = size === 'sm' ? 30 : 38;
  return (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src="/brand/logo-chef-192.png"
        alt=""
        width={px}
        height={px}
        loading={eager ? 'eager' : 'lazy'}
        className="rounded-[21%] shadow-soft ring-1 ring-line"
      />
      <span
        className={cn(
          'font-bold tracking-tight text-foreground',
          size === 'sm' ? 'text-base' : 'text-xl',
        )}
      >
        {name}
      </span>
    </span>
  );
}

function SectionHead({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' ? 'mx-auto text-center' : 'text-left')}>
      <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-secondary uppercase">
        <span aria-hidden className="h-1 w-6 rounded-full bg-landing-yellow" />
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">
        {title}
      </h2>
      {body ? <p className="mt-3 text-lg text-balance text-secondary">{body}</p> : null}
    </div>
  );
}

function MockCard({
  icon,
  tone,
  title,
  body,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-line bg-surface p-3.5 shadow-lift">
      <span
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-xl [&>svg]:size-4.5',
          tone,
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{body}</span>
      </span>
    </div>
  );
}
