/** Sending the bazar list without a server: a WhatsApp link that opens with the words already typed. */

/** A Bangladesh number as WhatsApp wants it (country code, digits only), or null when it is not one. */
export function waPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (/^8801\d{9}$/.test(digits)) return digits;
  if (/^01\d{9}$/.test(digits)) return `88${digits}`;
  if (/^1\d{9}$/.test(digits)) return `880${digits}`;
  return null;
}

/** https://wa.me link: with a phone it opens that chat, without one WhatsApp asks who to send to. */
export function waLink(text: string, phone?: string | null): string {
  const to = waPhone(phone);
  return `https://wa.me/${to ?? ''}?text=${encodeURIComponent(text)}`;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
