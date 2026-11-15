/**
 * A Facebook link as an owner pastes it ("facebook.com/kacchihouse", "m.facebook.com/…", with or without
 * https) → one https link, or null when it is not a Facebook link (ADR 0059). Shown to the operator as a
 * link, so anything else (javascript:, other sites, a bare facebook.com) is refused.
 */
export function normalizeFacebookLink(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw.replace(/^http:/i, 'https:')
    : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const ok = ['facebook.com', 'fb.com', 'fb.me'].some((d) => host === d || host.endsWith(`.${d}`));
  if (!ok || url.protocol !== 'https:' || url.pathname === '/' || url.username || url.password)
    return null;
  const clean = `https://${host}${url.pathname}${url.search}`;
  return clean.length <= 300 ? clean : null;
}
