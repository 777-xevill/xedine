'use server';

import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { readOrder } from './helper';
import { HELPER_MAX_ITEMS, type HelperResult } from './helper-lines';

const entry = z.object({
  id: z.uuid(),
  name: z.string().max(200),
  nameBn: z.string().max(200).nullable(),
});

const Input = z.object({
  orgId: z.uuid(),
  text: z.string().trim().min(1).max(500),
  menu: z
    .array(
      entry.extend({
        variants: z.array(entry).max(30),
        groups: z
          .array(
            z.object({
              min: z.number().int().min(0).max(20),
              max: z.number().int().min(0).max(20),
              modifiers: z.array(entry).max(60),
            }),
          )
          .max(20),
      }),
    )
    .min(1)
    .max(HELPER_MAX_ITEMS),
});

export type HelperActionResult = ({ ok: true } & HelperResult) | { ok: false; error: string };

/**
 * Called from the till (ADR 0031). Only a signed-in member of the organisation may spend its AI
 * allowance; the till's own menu is sent along because the till is the one that prices and sells it
 * (and may be showing a branch's availability). A forged menu can only change what the forger sees.
 */
export async function cashierHelperAction(input: unknown): Promise<HelperActionResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalidInput' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'notAllowed' };
  const { data: member } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', parsed.data.orgId)
    .maybeSingle();
  if (!member) return { ok: false, error: 'notAllowed' };
  try {
    const { lines, unmatched } = await readOrder({
      orgId: parsed.data.orgId,
      text: parsed.data.text,
      menu: parsed.data.menu,
    });
    return { ok: true, lines, unmatched };
  } catch (e) {
    return { ok: false, error: aiErrorKey(e) };
  }
}
