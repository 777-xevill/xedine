import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Menu photos for AI recipe drafts are up to 5 MB (src/modules/recipes/actions.ts).
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  // The social autopilot (ADR 0040) renders posters and reels with a headless Chromium and ffmpeg in the
  // job route. They load their own binaries at run time, so they are not bundled, and their files are
  // copied next to that route.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core', 'ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/jobs/*': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/ffmpeg-static/ffmpeg',
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HTTPS only for two years once the browser has seen the site (Vercel serves HTTPS).
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // The microphone is used for voice entry (purchases, waste); nothing else needs device access.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
          },
          // A narrow CSP that cannot break Next's inline scripts: no framing, no plugins, no base hijack,
          // forms post only to this site. A full script-src policy needs nonces (Run by hand, SECURITY.md).
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
