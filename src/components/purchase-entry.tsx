'use client';

import { Check, Plus, Sparkles, Sprout, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Hint, Input, Label, Select } from '@/components/ui/form';
import { UnitField } from '@/components/unit-field';
import { VoiceTextarea } from '@/components/voice-textarea';
import { cn } from '@/lib/utils';
import { recordPurchaseAction, sayBazarAction, type SaidLine } from '@/modules/purchasing/actions';
import {
  matchIngredient,
  PURCHASE_UNITS,
  suggestIngredients,
  type BaseUnit,
  type IngredientRef,
  type PurchaseUnit,
} from '@/modules/purchasing/lines';
import { initialState, type FormState } from '@/modules/tenancy/form-state';

export interface IngredientOption {
  id: string;
  name: string;
  nameBn: string | null;
  base: BaseUnit;
  aliases: string[];
}

interface Row {
  key: number;
  /** What the purchaser typed (or the item's name once picked). */
  text: string;
  pickedId: string | null;
  /** "Yes, it is a new item": added to the stock list by the same save (ADR 0039). */
  confirmedNew: boolean;
  qty: string;
  unit: PurchaseUnit;
  total: string;
  /** Bumped when a row is filled from outside, so the unit box starts again from `unit`. */
  rev: number;
}

type Said = { role: 'me' | 'xedine'; text: string };

const defaultUnit = (base: BaseUnit | undefined): PurchaseUnit =>
  base === 'pcs' ? 'pcs' : base === 'ml' ? 'l' : 'kg';

/**
 * The Purchases form (ADR 0039): one row to start, the purchaser types the item and Xedine finds it in
 * the stock list — or asks "is it a new item?". "Tell Xedine" is a pop-up on the same page where the
 * purchaser says the whole bazar like a person and the rows are filled in for them to check; nothing
 * is saved until they press Save.
 */
export function PurchaseEntry({
  orgId,
  orgSlug,
  branches,
  defaultBranchId,
  today,
  suppliers,
  ingredients,
  days,
  lang,
}: {
  /** What the browser's speech recognition should listen for. */
  lang: 'bn-BD' | 'en-US';
  orgId: string;
  orgSlug: string;
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  today: string;
  suppliers: { id: string; name: string }[];
  ingredients: IngredientOption[];
  days: number[];
}) {
  const t = useTranslations('purchases');
  const tc = useTranslations();
  const refs = React.useMemo<IngredientRef[]>(
    () =>
      ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        name_bn: i.nameBn,
        base: i.base,
        aliases: i.aliases,
      })),
    [ingredients],
  );
  const byId = React.useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const nextKey = React.useRef(1);
  const blank = React.useCallback(
    (): Row => ({
      key: nextKey.current++,
      text: '',
      pickedId: null,
      confirmedNew: false,
      qty: '',
      unit: 'kg',
      total: '',
      rev: 0,
    }),
    [],
  );
  const [rows, setRows] = React.useState<Row[]>(() => [
    {
      key: 0,
      text: '',
      pickedId: null,
      confirmedNew: false,
      qty: '',
      unit: 'kg',
      total: '',
      rev: 0,
    },
  ]);
  const [focused, setFocused] = React.useState<number | null>(null);
  const [branch, setBranch] = React.useState(defaultBranchId);
  const [forDays, setForDays] = React.useState('');

  const [state, formAction, pending] = React.useActionState(
    async (prev: FormState, formData: FormData): Promise<FormState> => {
      const res = await recordPurchaseAction(prev, formData);
      if (res.ok) {
        setRows([blank()]);
        setForDays('');
      }
      return res;
    },
    initialState,
  );

  const resolve = (r: Row): IngredientOption | null => {
    if (r.pickedId) return byId.get(r.pickedId) ?? null;
    if (r.confirmedNew || !r.text.trim()) return null;
    const m = matchIngredient(r.text, refs);
    return m ? (byId.get(m.id) ?? null) : null;
  };
  const isEmpty = (r: Row) => !r.text.trim() && !r.qty.trim() && !r.total.trim();
  const patch = (key: number, p: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const pick = (key: number, ing: IngredientOption) =>
    setRows((all) =>
      all.map((r) =>
        r.key === key
          ? {
              ...r,
              text: ing.name,
              pickedId: ing.id,
              confirmedNew: false,
              unit: PURCHASE_UNITS[r.unit].base === ing.base ? r.unit : defaultUnit(ing.base),
              rev: r.rev + 1,
            }
          : r,
      ),
    );

  const filled = rows.filter((r) => !isEmpty(r));
  const unresolved = filled.filter((r) => !resolve(r) && !r.confirmedNew);
  const canSave = filled.length > 0 && unresolved.length === 0 && !pending;

  // ---- "Tell Xedine" pop-up ------------------------------------------------------------------
  const [open, setOpen] = React.useState(false);
  const [said, setSaid] = React.useState<Said[]>([]);
  const [saying, startSaying] = React.useTransition();
  const [sayError, setSayError] = React.useState('');
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [said.length, saying, open]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const fill = (lines: SaidLine[]) => {
    const made = lines.map<Row>((l) => {
      const ing = l.ingredientId ? byId.get(l.ingredientId) : undefined;
      const unit =
        l.unit && (!ing || PURCHASE_UNITS[l.unit].base === ing.base)
          ? l.unit
          : defaultUnit(ing?.base);
      return {
        key: nextKey.current++,
        text: ing ? ing.name : l.name,
        pickedId: ing?.id ?? null,
        confirmedNew: false,
        qty: l.qty,
        unit,
        total: l.total,
        rev: 1,
      };
    });
    setRows((all) => [...all.filter((r) => !isEmpty(r)), ...made]);
  };

  const say = (text: string) => {
    const q = text.trim();
    if (!q || saying) return;
    setSayError('');
    setSaid((m) => [...m, { role: 'me', text: q }]);
    startSaying(async () => {
      const res = await sayBazarAction({ orgId, branchId: branch, text: q });
      if (!res.ok) {
        setSayError(res.error);
        return;
      }
      fill(res.lines);
      if (res.days !== null) setForDays(String(res.days));
      const fresh = res.lines.filter((l) => l.ingredientId === null).length;
      const parts: string[] = [];
      parts.push(
        res.lines.length === 0 ? t('say.none') : t('say.done', { count: res.lines.length, fresh }),
      );
      if (res.unread.length > 0) parts.push(t('say.unread', { lines: res.unread.join('; ') }));
      setSaid((m) => [...m, { role: 'xedine', text: parts.join('\n') }]);
    });
  };

  const rowView = (r: Row, i: number) => {
    const found = resolve(r);
    const exact =
      found !== null &&
      [found.name, found.nameBn ?? '', ...found.aliases].some(
        (n) => n.trim().toLowerCase() === r.text.trim().toLowerCase(),
      );
    const typed = r.text.trim() !== '';
    const close =
      typed && !r.confirmedNew && !exact
        ? suggestIngredients(r.text, refs, null, 5)
            .map((x) => byId.get(x.id))
            .filter((x): x is IngredientOption => x !== undefined)
        : [];
    const dropdown = focused === r.key ? close : [];
    const warn = typed && !found && !r.confirmedNew;
    return (
      <div
        key={r.key}
        className={cn(
          'space-y-2 rounded-input border border-line p-3',
          warn && 'border-warning/70 ring-1 ring-warning/40',
        )}
      >
        <div className="flex items-start gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              value={r.text}
              onChange={(e) =>
                patch(r.key, { text: e.target.value, pickedId: null, confirmedNew: false })
              }
              onFocus={() => setFocused(r.key)}
              onBlur={() => setFocused((f) => (f === r.key ? null : f))}
              placeholder={t('typeItem')}
              aria-label={t('ingredient')}
              autoComplete="off"
              maxLength={120}
            />
            {dropdown.length > 0 ? (
              <ul
                role="listbox"
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-input border border-line bg-surface p-1 shadow-lift"
              >
                {dropdown.map((ing) => (
                  <li key={ing.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        pick(r.key, ing);
                        setFocused(null);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-input px-3 py-2 text-start text-sm hover:bg-surface-elevated"
                    >
                      <span>{ing.name}</span>
                      {ing.nameBn && ing.nameBn !== ing.name ? (
                        <span className="text-secondary">{ing.nameBn}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {rows.length > 1 ? (
            <button
              type="button"
              onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-surface-elevated hover:text-foreground"
              aria-label={t('removeRow')}
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>

        {found ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-success">
            <span className="inline-flex items-center gap-1.5">
              <Check aria-hidden className="size-4" />
              {t('found', { name: found.name })}
            </span>
            {!exact ? (
              <button
                type="button"
                onClick={() => patch(r.key, { pickedId: null, confirmedNew: true })}
                className="text-xs text-secondary underline underline-offset-2 hover:text-foreground"
              >
                {t('notThis')}
              </button>
            ) : null}
          </p>
        ) : null}
        {warn ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-warning">
              {t('isNew', { name: r.text.trim() })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => patch(r.key, { confirmedNew: true })}
              >
                <Sprout aria-hidden className="size-4" />
                {t('yesNew')}
              </Button>
              {close.slice(0, 3).map((ing) => (
                <Button
                  key={ing.id}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => pick(r.key, ing)}
                >
                  {t('orIs', { name: ing.name })}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {r.confirmedNew && typed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" icon={<Sprout />}>
              {t('newItem')}
            </Badge>
            <span className="text-xs text-secondary">{t('newWillAdd')}</span>
            <button
              type="button"
              onClick={() => patch(r.key, { confirmedNew: false })}
              className="text-xs text-secondary underline underline-offset-2 hover:text-foreground"
            >
              {t('undo')}
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <Input
            name={`line-${i}-qty`}
            inputMode="decimal"
            aria-label={t('qty')}
            placeholder={t('qty')}
            value={r.qty}
            onChange={(e) => patch(r.key, { qty: e.target.value })}
          />
          <UnitField
            key={`${r.key}-${r.rev}-${found?.base ?? 'any'}`}
            name={`line-${i}-unit`}
            ariaLabel={t('unit')}
            defaultValue={r.unit}
            {...(found ? { base: found.base } : { noOther: true })}
          />
          <Input
            name={`line-${i}-total`}
            inputMode="decimal"
            aria-label={t('lineTotal')}
            placeholder={t('lineTotal')}
            value={r.total}
            onChange={(e) => patch(r.key, { total: e.target.value })}
          />
        </div>
        <input type="hidden" name={`line-${i}-ingredient`} value={found?.id ?? ''} />
        <input
          type="hidden"
          name={`line-${i}-newname`}
          value={!found && r.confirmedNew ? r.text.trim() : ''}
        />
      </div>
    );
  };

  return (
    <>
      <form action={formAction} aria-busy={pending} className="space-y-3">
        {state.error ? (
          <Alert tone="danger">{tc(`errors.${state.error}`, state.data)}</Alert>
        ) : null}
        {state.ok ? <Alert tone="success">{t('recorded')}</Alert> : null}
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="p-branch">{t('branch')}</Label>
            <Select
              id="p-branch"
              name="branchId"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              required
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-date">{t('date')}</Label>
            <Input
              id="p-date"
              name="purchasedOn"
              type="date"
              max={today}
              defaultValue={today}
              required
            />
          </div>
          <div>
            <Label htmlFor="p-days">{t('forDays')}</Label>
            <Select
              id="p-days"
              name="forDays"
              value={forDays}
              onChange={(e) => setForDays(e.target.value)}
            >
              <option value="">{t('forDaysNone')}</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {t('daysOption', { count: d })}
                </option>
              ))}
            </Select>
            <Hint>{t('forDaysHint')}</Hint>
          </div>
          <div>
            <Label htmlFor="p-sup">{t('supplier')}</Label>
            <Select id="p-sup" name="supplierId" defaultValue="">
              <option value="">{t('newOrNoSupplier')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-supname">{t('newSupplier')}</Label>
            <Input id="p-supname" name="supplierName" maxLength={120} />
          </div>
        </div>

        <p className="pt-2 text-sm font-semibold">{t('lines')}</p>
        <div className="space-y-3">{rows.map((r, i) => rowView(r, i))}</div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((all) => [...all, blank()])}
        >
          <Plus aria-hidden className="size-4" />
          {t('addItem')}
        </Button>
        <Hint>{t('linesHint')}</Hint>
        {unresolved.length > 0 ? (
          <p className="text-sm text-warning">{t('confirmNew', { count: unresolved.length })}</p>
        ) : null}
        <Button type="submit" disabled={!canSave}>
          {t('record')}
        </Button>
      </form>

      {open ? (
        <section
          role="dialog"
          aria-label={t('say.title')}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-sheet border border-line bg-surface shadow-lift sm:inset-x-auto sm:end-6 sm:bottom-6 sm:h-[min(40rem,80dvh)] sm:w-[26rem] sm:rounded-card"
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Sparkles aria-hidden className="size-5 text-purple" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t('say.title')}</p>
              <p className="truncate text-xs text-secondary">{t('say.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex size-9 items-center justify-center rounded-full text-secondary hover:bg-surface-elevated hover:text-foreground"
              aria-label={t('say.close')}
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ol className="space-y-4 px-4 py-4">
              <li className="text-sm leading-6 text-secondary">{t('say.intro')}</li>
              {said.map((m, i) =>
                m.role === 'me' ? (
                  <li key={i} className="flex justify-end">
                    <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-surface-elevated px-4 py-2.5 text-sm whitespace-pre-line">
                      {m.text}
                    </p>
                  </li>
                ) : (
                  <li key={i} className="flex gap-3">
                    <Sparkles aria-hidden className="mt-1 size-4 shrink-0 text-purple" />
                    <p className="text-sm leading-6 whitespace-pre-line">{m.text}</p>
                  </li>
                ),
              )}
              {saying ? <li className="text-sm text-secondary">{t('say.reading')}</li> : null}
            </ol>
            <div ref={endRef} />
          </div>
          <div className="border-t border-line px-3 pt-3 pb-3">
            {sayError ? (
              <Alert tone="danger" className="mb-2">
                {tc(`errors.${sayError}`)}
              </Alert>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const text = String(new FormData(form).get('text') ?? '');
                form.reset();
                say(text);
              }}
              className="space-y-2"
            >
              <VoiceTextarea
                id="say-text"
                name="text"
                label={t('say.label')}
                placeholder={t('say.placeholder')}
                lang={lang}
                labels={{
                  speak: t('speak'),
                  stop: t('stop'),
                  unsupported: t('voiceUnsupported'),
                  listening: t('listening'),
                }}
              />
              <Button type="submit" disabled={saying} className="w-full">
                {t('say.send')}
              </Button>
            </form>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glow-action fixed end-4 bottom-20 z-40 inline-flex items-center gap-2 rounded-full bg-action px-5 py-3 text-sm font-semibold text-on-action transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:outline-none sm:end-6 sm:bottom-24"
        >
          <Sparkles className="size-4" aria-hidden />
          {t('say.open')}
        </button>
      )}
    </>
  );
}
