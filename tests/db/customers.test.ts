/**
 * Phase 8 customers, retention and reviews (METRICS.md "Customers", "Reviews & service"; ADR 0021).
 * Sends must respect consent, caps and opt-outs; lift is claimed only with ≥ 30 per group.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asService,
  asUser,
  closePool,
  createOrg,
  type TestOrg,
  type TestUser,
} from './harness';

afterAll(closePool);

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const dhaka = (date: string, time = '13:00') => new Date(`${date}T${time}:00+06:00`).toISOString();
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const TODAY = '2026-07-06';
const NOW = dhaka(TODAY, '12:00');

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

interface Fx {
  org: TestOrg;
  channel: string;
}

async function fixture(branches: string[]): Promise<Fx> {
  const org = await createOrg({ branches });
  const channel = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  return { org, channel };
}

let phoneSeq = 1_000_000;
async function customer(fx: Fx, consent: boolean | null = true) {
  const c = await id(`insert into public.customers (org_id, phone) values ($1, $2) returning id`, [
    fx.org.id,
    `+88017${phoneSeq++}0`,
  ]);
  if (consent !== null)
    await admin(
      `insert into public.consents (org_id, customer_id, channel, purpose, granted, source, recorded_at)
       values ($1, $2, 'whatsapp', 'marketing', $3, 'pos', '2026-01-01')`,
      [fx.org.id, c, consent],
    );
  return c;
}

async function order(
  fx: Fx,
  branch: string,
  date: string,
  opts: { customer?: string | null; time?: string; net?: number; ticketMin?: number } = {},
) {
  const orderId = randomUUID();
  const net = opts.net ?? 50000;
  const placed = dhaka(date, opts.time ?? '13:00');
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, customer_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,$5,'completed','paid',$6,$7,$7,$7,$7,false,0)`,
    [orderId, fx.org.id, branch, fx.channel, opts.customer ?? null, placed, net],
  );
  if (opts.ticketMin) {
    const sent = new Date(Date.parse(placed) + 60_000);
    const ready = new Date(sent.getTime() + opts.ticketMin * 60_000);
    await admin(
      `insert into public.order_events (org_id, branch_id, order_id, event_type, occurred_at)
       values ($1,$2,$3,'sent_to_kitchen',$4), ($1,$2,$3,'ready',$5)`,
      [fx.org.id, branch, orderId, sent.toISOString(), ready.toISOString()],
    );
  }
  return orderId;
}

// ---------------------------------------------------------------------------------------------
describe('customer segments and the summary', () => {
  let fx: Fx;
  let manager: TestUser;
  let accountant: TestUser;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    fx = await fixture(['Main']);
    const b = fx.org.branchIds[0]!;
    manager = await addMember(fx.org, 'manager', [b]);
    accountant = await addMember(fx.org, 'accountant');
    ids.lost = await customer(fx);
    await order(fx, b, addDays(TODAY, -100), { customer: ids.lost });
    ids.regular = await customer(fx);
    for (let d = 55; d >= 5; d -= 10)
      await order(fx, b, addDays(TODAY, -d), { customer: ids.regular });
    ids.atRisk = await customer(fx);
    for (const d of [80, 70, 60, 50, 40])
      await order(fx, b, addDays(TODAY, -d), { customer: ids.atRisk });
    ids.fresh = await customer(fx);
    await order(fx, b, addDays(TODAY, -1), { customer: ids.fresh });
    ids.returning = await customer(fx);
    for (const d of [20, 10]) await order(fx, b, addDays(TODAY, -d), { customer: ids.returning });
    await order(fx, b, addDays(TODAY, -2)); // an anonymous walk-in
  });

  it('lost (> 90 days), at risk (> 2 × their interval and > 30), regular, new, returning', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_customers($1, null, $2)', [fx.org.id, NOW]),
    );
    const seg = Object.fromEntries(rows.map((r) => [r.customer_id as string, r.segment]));
    expect(seg).toEqual({
      [ids.lost!]: 'lost',
      [ids.regular!]: 'regular',
      [ids.atRisk!]: 'at_risk',
      [ids.fresh!]: 'new',
      [ids.returning!]: 'returning',
    });
    expect(rows.find((r) => r.customer_id === ids.regular)!.phone).toMatch(/^\+88017/);
  });

  it('the list is PII (owner/manager); the summary is counts (accountant too)', async () => {
    expect(
      (
        await asUser(accountant, (s) =>
          s.attempt('select * from public.metric_customers($1, null, $2)', [fx.org.id, NOW]),
        )
      ).ok,
    ).toBe(false);
    const [sum] = await asUser(accountant, (s) =>
      s.q<Row>('select * from public.metric_customer_summary($1, null, $2)', [fx.org.id, NOW]),
    );
    // Last 30 days: regular ×3 (−25, −15, −5), fresh, returning ×2, walk-in = 7 orders, 6 identified.
    expect({ n: n(sum!.orders_30d), ident: n(sum!.identified_30d) }).toEqual({ n: 7, ident: 6 });
    expect(sum!.segments).toMatchObject({ lost: 1, regular: 1, at_risk: 1, new: 1, returning: 1 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('service.slow_slot: a weekday × two-hour slot twice as slow as the branch', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture(['Dhanmondi']);
    const b = fx.org.branchIds[0]!;
    // Friday 2026-07-03, 20:00–22:00: 12 orders at 30 minutes; Saturday lunch: 30 orders at 12 minutes.
    const slow: string[] = [];
    for (let i = 0; i < 12; i++)
      slow.push(
        await order(fx, b, '2026-07-03', {
          time: `20:${String(i * 4).padStart(2, '0')}`,
          ticketMin: 30,
        }),
      );
    for (let i = 0; i < 30; i++) await order(fx, b, '2026-07-04', { time: '12:30', ticketMin: 12 });
    await admin(
      `insert into public.feedback (org_id, branch_id, order_id, rating, comment, submitted_at) values
         ($1, $2, $3, 4, 'Food took too long to come', now()), ($1, $2, $4, 5, 'খাবার আসতে অনেক দেরি', now()),
         ($1, $2, $5, 9, 'Great kacchi', now())`,
      [fx.org.id, b, slow[0], slow[1], slow[2]],
    );
  });

  it('flags Friday 20–22 with the complaints behind it; impact = the slot’s sales', async () => {
    const found = await admin<Row>(
      `select type, subject, impact_poisha, confidence, evidence from private.detect_all($1, '2026-06-29', '2026-07-05', array['service'])`,
      [fx.org.id],
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      type: 'service.slow_slot',
      subject: { weekday: 5, from_hour: 20, to_hour: 22 },
    });
    expect(n(found[0]!.impact_poisha)).toBe(12 * 50000);
    expect(found[0]!.evidence).toMatchObject({
      orders: 12,
      median_seconds: 1800,
      branch_median_seconds: 720,
      feedback_slow: 2,
      feedback_low: 2,
    });
  });

  it('tags themes on feedback in English and Bangla', async () => {
    const rows = await admin<{ themes: string[] }>(
      `select themes from public.feedback where org_id = $1 order by rating`,
      [fx.org.id],
    );
    expect(rows.map((r) => r.themes)).toEqual([['slow_service'], ['slow_service'], ['praise']]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('customers.lapse: regulars who stopped coming, with the price change before it', () => {
  let fx: Fx;
  const FROM = '2026-06-01';
  const TO = '2026-06-30';
  beforeAll(async () => {
    fx = await fixture(['A', 'B', 'C']);
    for (const [bi, lapsing] of [
      [0, 15],
      [1, 2],
      [2, 2],
    ] as const) {
      const b = fx.org.branchIds[bi]!;
      for (let i = 0; i < 25; i++) {
        const c = await customer(fx);
        // Four visits before the period (৳500 each); those who stay come back once in June.
        for (const d of ['2026-03-10', '2026-04-01', '2026-04-20', '2026-05-15'])
          await order(fx, b, d, { customer: c });
        if (i >= lapsing) await order(fx, b, '2026-06-10', { customer: c });
      }
    }
    // Branch A raised the kacchi price two weeks before the period.
    const item = await id(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Kacchi', 47000) returning id`,
      [fx.org.id],
    );
    await admin(
      `insert into public.price_history (org_id, branch_id, menu_item_id, old_price_poisha, new_price_poisha, changed_at)
       values ($1, $2, $3, 42000, 47000, '2026-05-20T10:00:00+06:00')`,
      [fx.org.id, fx.org.branchIds[0], item],
    );
  });

  it('flags branch A (15 of 25 = 60% vs 8% elsewhere); impact = their monthly spend × one month', async () => {
    const found = await admin<Row>(
      `select type, branch_id, impact_poisha, evidence from private.detect_all($1, $2::date, $3::date, array['customers'])`,
      [fx.org.id, FROM, TO],
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'customers.lapse', branch_id: fx.org.branchIds[0] });
    // Regulars: four visits in the 90 days before June (03-10, 04-01, 04-20, 05-15).
    expect(found[0]!.evidence).toMatchObject({
      regulars: 25,
      lapsed: 15,
      rate_bps: 6000,
      peer_rate_bps: 800,
    });
    // 15 lapsed × ৳2,000 over 90 days ÷ 3 × 30 days ÷ 30 = ৳10,000.
    expect(n(found[0]!.impact_poisha)).toBe(1_000_000);
    expect((found[0]!.evidence as { price_changes: Row[] }).price_changes[0]).toMatchObject({
      old_poisha: 42000,
      new_poisha: 47000,
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('campaigns respect consent, caps, opt-outs and holdouts', () => {
  let fx: Fx;
  let manager: TestUser;
  let cashier: TestUser;
  let campaign: string;
  const customers: string[] = [];
  beforeAll(async () => {
    fx = await fixture(['Main']);
    const b = fx.org.branchIds[0]!;
    manager = await addMember(fx.org, 'manager', [b]);
    cashier = await addMember(fx.org, 'cashier', [b]);
    // 40 at-risk customers (visits 80 and 70 days ago): 30 consented, 6 never asked, 4 refused.
    for (let i = 0; i < 40; i++) {
      const c = await customer(fx, i < 30 ? true : i < 36 ? null : false);
      customers.push(c);
      for (const d of [80, 70]) await order(fx, b, addDays(TODAY, -d), { customer: c });
    }
    campaign = await id(
      `insert into public.campaigns (org_id, name, kind, holdout_pct) values ($1, 'Come back', 'win_back', 20) returning id`,
      [fx.org.id],
    );
  });

  it('needs a message and an approval by owner or manager; cashiers cannot run it', async () => {
    expect(
      (await asUser(manager, (s) => s.attempt('select public.approve_campaign($1)', [campaign])))
        .ok,
    ).toBe(false);
    await admin(
      `update public.campaigns set body_bn = 'আবার আসুন!', body_en = 'Come back!' where id = $1`,
      [campaign],
    );
    expect(
      (
        await asUser(manager, (s) =>
          s.attempt('select public.run_campaign($1, $2)', [campaign, NOW]),
        )
      ).ok,
    ).toBe(false);
    await asUser(manager, (s) => s.q('select public.approve_campaign($1)', [campaign]), {
      commit: true,
    });
    expect(
      (
        await asUser(cashier, (s) =>
          s.attempt('select public.run_campaign($1, $2)', [campaign, NOW]),
        )
      ).ok,
    ).toBe(false);
  });

  it('holdout first, then consent: nobody without granted consent is messaged', async () => {
    const [{ r }] = (await asUser(
      manager,
      (s) => s.q<{ r: Row }>('select public.run_campaign($1, $2) as r', [campaign, NOW]),
      {
        commit: true,
      },
    )) as [{ r: Row }];
    expect(n(r.queued) + n(r.holdout) + n(r.no_consent) + n(r.capped)).toBe(40);
    expect(n(r.holdout)).toBeGreaterThan(0);
    const sent = await admin<{ customer_id: string }>(
      `select s.customer_id from public.campaign_sends s where s.campaign_id = $1 and s.status = 'queued'`,
      [campaign],
    );
    expect(sent.every((s) => customers.indexOf(s.customer_id) < 30)).toBe(true);
    const outbox = await admin<{ n: number }>(
      `select count(*)::int as n from public.message_outbox where org_id = $1 and template_key = 'campaign'`,
      [fx.org.id],
    );
    expect(outbox[0]!.n).toBe(n(r.queued));
  });

  it('the same campaign does not repeat within 30 days, and another one is capped', async () => {
    const [{ r }] = (await asUser(
      manager,
      (s) => s.q<{ r: Row }>('select public.run_campaign($1, $2) as r', [campaign, NOW]),
      {
        commit: true,
      },
    )) as [{ r: Row }];
    expect(n(r.queued) + n(r.holdout) + n(r.no_consent)).toBe(0);
    const other = await id(
      `insert into public.campaigns (org_id, name, kind, holdout_pct, body_bn, status, approved_at) values ($1, 'Second', 'win_back', 0, 'x', 'approved', now()) returning id`,
      [fx.org.id],
    );
    const [{ r: r2 }] = (await asUser(
      manager,
      (s) => s.q<{ r: Row }>('select public.run_campaign($1, $2) as r', [other, NOW]),
      {
        commit: true,
      },
    )) as [{ r: Row }];
    const [first] = await admin<{ n: number }>(
      `select count(*)::int as n from public.campaign_sends where campaign_id = $1 and status = 'queued'`,
      [campaign],
    );
    expect(n(r2.capped)).toBe(first!.n);
    // Only the consenting customers held out of the first campaign may hear from the second one.
    const [held] = await admin<{ n: number }>(
      `select count(*)::int as n from public.campaign_sends where campaign_id = $1 and is_holdout and private.marketing_ok($2, customer_id)`,
      [campaign, fx.org.id],
    );
    expect(n(r2.queued)).toBe(held!.n);
  });

  it('an opt-out keyword refuses marketing from then on', async () => {
    const [c] = await admin<{ phone: string }>(`select phone from public.customers where id = $1`, [
      customers[0],
    ]);
    const [{ k }] = (await asService(
      (s) => s.q<{ k: number }>('select public.record_opt_out($1) as k', [c!.phone]),
      { commit: true },
    )) as [{ k: number }];
    expect(n(k)).toBe(2);
    const [ok] = await admin<{ ok: boolean }>(`select private.marketing_ok($1, $2) as ok`, [
      fx.org.id,
      customers[0],
    ]);
    expect(ok!.ok).toBe(false);
    expect(
      (await asUser(manager, (s) => s.attempt('select public.record_opt_out($1)', [c!.phone]))).ok,
    ).toBe(false);
  });

  it('results report n per group and make no claim below 30 each', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_campaign_results($1, $2)', [campaign, NOW]),
    );
    expect(rows.map((r) => r.group_name)).toEqual(['treated', 'holdout']);
    expect(rows.every((r) => r.enough_data === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('post-meal feedback and review replies', () => {
  it('a token per order, one answer per token, only through the service role', async () => {
    const fx = await fixture(['Main']);
    const b = fx.org.branchIds[0]!;
    const c = await customer(fx);
    const recent = new Date(Date.now() - 60 * 60_000).toISOString();
    await admin(
      `insert into public.orders (id, org_id, branch_id, channel_id, customer_id, order_status, payment_status, placed_at,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
       values (gen_random_uuid(),$1,$2,$3,$4,'completed','paid',$5,100,100,100,100,false,0)`,
      [fx.org.id, b, fx.channel, c, recent],
    );
    const requests = await asService(
      (s) =>
        s.q<{ token: string; to_phone: string }>(
          'select * from public.job_feedback_requests($1, now())',
          [fx.org.id],
        ),
      {
        commit: true,
      },
    );
    expect(requests).toHaveLength(1);
    const again = await asService((s) =>
      s.q('select * from public.job_feedback_requests($1, now())', [fx.org.id]),
    );
    expect(again).toHaveLength(0);
    const submit = (token: string) =>
      asService(
        (s) =>
          s.q<{ ok: boolean }>('select public.submit_feedback($1, 3, $2, now()) as ok', [
            token,
            'Came cold and late',
          ]),
        {
          commit: true,
        },
      );
    expect((await submit('not-a-token'))[0]!.ok).toBe(false);
    expect((await submit(requests[0]!.token))[0]!.ok).toBe(true);
    expect((await submit(requests[0]!.token))[0]!.ok).toBe(false);
    const [f] = await admin<{ themes: string[]; token_hash: string }>(
      `select themes, token_hash from public.feedback where org_id = $1`,
      [fx.org.id],
    );
    expect(f!.themes).toEqual(['cold_food', 'slow_service']);
    expect(f!.token_hash).not.toBe(requests[0]!.token);
  });

  it('a reply is posted only after the owner or a manager approves it', async () => {
    const fx = await fixture(['Main']);
    const b = fx.org.branchIds[0]!;
    const manager = await addMember(fx.org, 'manager', [b]);
    const cashier = await addMember(fx.org, 'cashier', [b]);
    const review = await id(
      `insert into public.reviews (org_id, branch_id, source, rating, body, reviewed_at) values ($1, $2, 'google', 4, 'Slow service on Friday', now()) returning id`,
      [fx.org.id, b],
    );
    const [r] = await admin<{ themes: string[] }>(
      `select themes from public.reviews where id = $1`,
      [review],
    );
    expect(r!.themes).toEqual(['slow_service']);
    const reply = await id(
      `insert into public.review_replies (org_id, review_id, draft_body) values ($1, $2, 'Sorry — we are fixing Friday nights.') returning id`,
      [fx.org.id, review],
    );
    expect(
      (await asUser(cashier, (s) => s.attempt('select public.approve_review_reply($1)', [reply])))
        .ok,
    ).toBe(false);
    await asUser(manager, (s) => s.q('select public.approve_review_reply($1)', [reply]), {
      commit: true,
    });
    const [done] = await admin<{ status: string }>(
      `select status::text from public.review_replies where id = $1`,
      [reply],
    );
    expect(done!.status).toBe('approved');
    const ctx = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_review_context($1)', [review]),
    );
    expect(ctx).toHaveLength(1);
  });
});
