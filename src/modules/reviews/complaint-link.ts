/** The customer complaint link (ADR 0043): pure helpers for the owner's page, the form and its route. */
export const COMPLAINT_TOKEN = /^[0-9a-f]{32}$/;
export const COMPLAINT_TOPICS = ['food', 'clean', 'service', 'sick', 'other'] as const;

export function complaintUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/c/${token}`;
}
