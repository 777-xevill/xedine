# ADR 0031 — Till photos and the cashier's AI helper

- Date: 2026-10-08
- Status: accepted

## Context
Cashiers tap dishes by reading names. Some prefer to tap by sight, and a rush is faster with a picture. Separately, a cashier hearing "2 biryani, 1 borhani, no onion" has to find and tap each item.

## Decision
**Photos**
- `menu_items.photo_path` (there since Phase 0, unused) now points at a file in a **public** Storage bucket `menu-photos`, path `<org_id>/<random>.webp`. A dish photo is what any QR menu shows publicly, so reading is public; **writing is owner-only and only in the org's own folder** (storage policies via `private.has_role`), and a check constraint forbids a dish pointing outside its org's folder. Listing is closed (no select policy).
- The owner adds a photo on the Menu page. The browser shrinks it to ≤640 px WebP (JPEG where WebP cannot be written), ~30–60 KB, uploads it, then `setItemPhotoAction` points the dish at it. A replaced photo is a new URL, so the long browser cache never serves a stale one.
- **Each till chooses** between *Words* and *Photos* (a toggle by the category bar, remembered in that device's localStorage). Default is Words. A dish with no photo, or a photo that fails to load (offline), shows a plain placeholder and stays sellable.

**Cashier helper ("Quick order")**
- The cashier types (or uses the phone keyboard's dictation) what the customer said. The server sends the till's menu **ids and names only — never prices** — to the fast-tier model, which returns menu ids, quantity, size id, add-on ids and a short note. Phrases it cannot match go in `unmatched`; it is told not to guess.
- `resolveHelperLines` checks everything against the menu: unknown ids dropped, quantity floored and capped at 99, sizes and add-ons must belong to the dish, group maximums respected, repeats merged. A missing size or required add-on sets `needsChoice`, and the cashier finishes it in the normal item picker.
- **Draft → approve** (CLAUDE.md #4): nothing enters the cart until the cashier taps *Add to cart*. Prices come from the till's own menu through `itemUnitPrice`; the model never calculates (#1). Cost goes through the LLM gateway (per-org daily cap, `cashier_helper` feature).
- Authorisation: a signed-in member of the org (the device's manager/owner session, ADR 0013). Needs internet; offline the button explains and the cashier taps items as usual.

## Alternatives considered
- Photos as base64 in a table: bloats the menu query and the offline snapshot. Rejected.
- Private bucket with signed URLs: expiring URLs break the cached till. Rejected for non-sensitive dish photos.
- An org-wide setting for photo mode: rejected by the owner's choice — per-till is more flexible.
- Voice recording in the helper: not built; the keyboard's dictation covers it. Revisit with real use.
- Server fetching the menu itself: the till's client module cannot be called from the server, and the till is the authority on what it sells (branch availability). A forged menu only changes what the forger sees.

## Consequences
- Migration `20261019000001_menu_photos.sql`; the embedded test stub gained a minimal `storage` schema (CI's real Supabase is the authority). `tests/db/menu-photos.test.ts` covers the folder constraint and owner-only upload.
- Orphaned files are deleted best-effort when a photo is replaced or removed.
- `TODO(verify)`: helper accuracy on real Bangla/Banglish orders — add cases to `tests/ai-evals` once an AI key is on the live site.
