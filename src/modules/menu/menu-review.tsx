'use client';

import {
  AlertTriangle,
  Check,
  FolderPlus,
  Info,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card, Input, Select } from '@/components/ui/form';
import { DEFAULT_LOCALE, formatNumber, isLocale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { discardMenuDraftAction, importMenuAction } from '@/modules/menu/import-actions';
import { draftRowProblem, draftToCsv, type DraftRow } from '@/modules/menu/import';
import { initialState } from '@/modules/tenancy/form-state';

type Row = DraftRow & { key: string };
type Cat = { key: string; name: string; rows: Row[] };

let seq = 0;
const nextKey = () => `k${++seq}`;
/** A row left empty (a new line never filled in) is ignored, not an error. */
const blank = (r: DraftRow) => r.name.trim() === '' && r.price.trim() === '';
const problemOf = (r: DraftRow) => (blank(r) ? null : draftRowProblem(r));

function group(rows: DraftRow[]): Cat[] {
  const cats: Cat[] = [];
  for (const r of rows) {
    const name = r.category.trim();
    let cat = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { key: nextKey(), name, rows: [] };
      cats.push(cat);
    }
    cat.rows.push({ ...r, key: nextKey() });
  }
  return cats;
}

/**
 * Setup → Menu → review (2026-11-19). The menu the AI read from the photos, shown the way it is printed:
 * each category a card, its dishes inside. The owner fixes names and prices, moves a dish to the right
 * category, deletes what is not a dish, and only then imports (CLAUDE.md #4). Rows the AI was unsure of,
 * rows without a price, and names already on the menu (skipped, never changed) are marked with words and
 * an icon.
 */
export function MenuReview({
  orgId,
  orgSlug,
  draftId,
  rows: initial,
  existing,
}: {
  orgId: string;
  orgSlug: string;
  draftId: string;
  rows: DraftRow[];
  existing: string[];
}) {
  const t = useTranslations('setup.review');
  const te = useTranslations('errors');
  const raw = useLocale();
  const n = (v: number) => formatNumber(v, isLocale(raw) ? raw : DEFAULT_LOCALE);
  const [cats, setCats] = useState<Cat[]>(() => group(initial));
  const [onlyCheck, setOnlyCheck] = useState(false);
  const [state, importAction, importing] = useActionState(importMenuAction, initialState);
  const [discardState, discardAction, discarding] = useActionState(
    discardMenuDraftAction,
    initialState,
  );

  const onMenu = useMemo(() => new Set(existing.map((s) => s.trim().toLowerCase())), [existing]);
  const all = cats.flatMap((c) => c.rows.map((r) => ({ ...r, category: c.name })));
  // A name printed twice is added once (the import skips the second): say so on the later one.
  const firstOf = new Map<string, string>();
  for (const r of all) {
    const k = r.name.trim().toLowerCase();
    if (k && !firstOf.has(k)) firstOf.set(k, r.key);
  }
  const problems = all.filter((r) => problemOf(r) !== null).length;
  const toCheck = all.filter((r) => r.check).length;
  const adding = all.filter((r) => {
    const k = r.name.trim().toLowerCase();
    return !blank(r) && problemOf(r) === null && !onMenu.has(k) && firstOf.get(k) === r.key;
  }).length;

  const patchRow = (catKey: string, key: string, patch: Partial<Row>) =>
    setCats((cs) =>
      cs.map((c) =>
        c.key !== catKey
          ? c
          : { ...c, rows: c.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) },
      ),
    );
  const removeRow = (catKey: string, key: string) =>
    setCats((cs) =>
      cs.map((c) => (c.key === catKey ? { ...c, rows: c.rows.filter((r) => r.key !== key) } : c)),
    );
  const moveRow = (from: string, key: string, to: string) =>
    setCats((cs) => {
      const row = cs.find((c) => c.key === from)?.rows.find((r) => r.key === key);
      if (!row) return cs;
      return cs.map((c) =>
        c.key === from
          ? { ...c, rows: c.rows.filter((r) => r.key !== key) }
          : c.key === to
            ? { ...c, rows: [...c.rows, row] }
            : c,
      );
    });
  const addRow = (catKey: string) =>
    setCats((cs) =>
      cs.map((c) =>
        c.key === catKey
          ? {
              ...c,
              rows: [
                ...c.rows,
                {
                  key: nextKey(),
                  category: c.name,
                  name: '',
                  name_bn: '',
                  price: '',
                  check: false,
                },
              ],
            }
          : c,
      ),
    );
  const addCategory = () =>
    setCats((cs) => [
      ...cs,
      {
        key: nextKey(),
        name: '',
        rows: [{ key: nextKey(), category: '', name: '', name_bn: '', price: '', check: false }],
      },
    ]);

  const csv = draftToCsv(all.filter((r) => !blank(r)).map(({ key: _key, ...r }) => r));
  const fixFirst = problems > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" icon={<Sparkles />}>
          {t('aiDraft')}
        </Badge>
        <Badge tone="neutral">{t('summary', { cats: n(cats.length), items: n(all.length) })}</Badge>
        {toCheck > 0 ? (
          <Badge tone="warning" icon={<AlertTriangle />}>
            {t('toCheck', { n: n(toCheck) })}
          </Badge>
        ) : null}
        {toCheck > 0 ? (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={onlyCheck}
              onChange={(e) => setOnlyCheck(e.target.checked)}
              className="size-4 accent-[var(--brand-yellow)]"
            />
            {t('onlyCheck')}
          </label>
        ) : null}
      </div>

      {cats.map((cat, ci) => {
        const rows = onlyCheck
          ? cat.rows.filter((r) => r.check || problemOf(r) !== null)
          : cat.rows;
        if (onlyCheck && rows.length === 0) return null;
        return (
          <Card key={cat.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-elevated text-xs font-bold text-secondary">
                {n(ci + 1)}
              </span>
              <Input
                aria-label={t('categoryName')}
                value={cat.name}
                placeholder={t('noCategory')}
                maxLength={80}
                onChange={(e) =>
                  setCats((cs) =>
                    cs.map((c) => (c.key === cat.key ? { ...c, name: e.target.value } : c)),
                  )
                }
                className="min-w-0 flex-1 text-base font-bold"
              />
              <span className="shrink-0 text-xs text-secondary">
                {t('items', { n: n(cat.rows.length) })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('deleteCategory', { name: cat.name || t('noCategory') })}
                onClick={() => {
                  if (cat.rows.length === 0 || window.confirm(t('deleteCategoryConfirm')))
                    setCats((cs) => cs.filter((c) => c.key !== cat.key));
                }}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>

            <ul className="space-y-2">
              {rows.map((r) => {
                const problem = problemOf({ ...r, category: cat.name });
                const k = r.name.trim().toLowerCase();
                const already = k !== '' && onMenu.has(k);
                const twice = k !== '' && !already && firstOf.get(k) !== r.key;
                return (
                  <li
                    key={r.key}
                    className={cn(
                      'rounded-input border p-2.5 transition-colors',
                      problem || r.check
                        ? 'border-warning/45 bg-warning/5'
                        : 'border-edge bg-surface-elevated/40',
                      (already || twice) && !problem && 'opacity-60',
                    )}
                  >
                    <div className="flex gap-2">
                      <Input
                        aria-label={t('name')}
                        value={r.name}
                        placeholder={t('name')}
                        maxLength={120}
                        onChange={(e) =>
                          patchRow(cat.key, r.key, { name: e.target.value, check: false })
                        }
                        className="min-w-0 flex-1"
                      />
                      <Input
                        aria-label={t('price')}
                        value={r.price}
                        placeholder={t('price')}
                        inputMode="decimal"
                        onChange={(e) =>
                          patchRow(cat.key, r.key, { price: e.target.value, check: false })
                        }
                        className={cn(
                          'w-24 shrink-0 text-right tabular-nums sm:w-28',
                          problem === 'price' && 'border-warning',
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('deleteItem', { name: r.name || t('name') })}
                        onClick={() => removeRow(cat.key, r.key)}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input
                        aria-label={t('nameBn')}
                        value={r.name_bn}
                        placeholder={t('nameBn')}
                        lang="bn"
                        maxLength={120}
                        onChange={(e) => patchRow(cat.key, r.key, { name_bn: e.target.value })}
                        className="min-h-9 min-w-40 flex-1 text-sm"
                      />
                      {cats.length > 1 ? (
                        <Select
                          aria-label={t('moveTo')}
                          value={cat.key}
                          onChange={(e) => moveRow(cat.key, r.key, e.target.value)}
                          className="min-h-9 w-auto max-w-48 text-sm"
                        >
                          {cats.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name || t('noCategory')}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                      {problem ? (
                        <Badge tone="warning" icon={<AlertTriangle />}>
                          {t(`problem.${problem}`)}
                        </Badge>
                      ) : r.check ? (
                        <>
                          <Badge tone="warning" icon={<AlertTriangle />}>
                            {t('unsure')}
                          </Badge>
                          <Button
                            type="button"
                            variant="subtle"
                            size="sm"
                            onClick={() => patchRow(cat.key, r.key, { check: false })}
                          >
                            <Check aria-hidden className="size-4" />
                            {t('looksRight')}
                          </Button>
                        </>
                      ) : null}
                      {already ? (
                        <Badge tone="info" icon={<Info />}>
                          {t('already')}
                        </Badge>
                      ) : twice ? (
                        <Badge tone="info" icon={<Info />}>
                          {t('twice')}
                        </Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {!onlyCheck ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => addRow(cat.key)}>
                <Plus aria-hidden className="size-4" />
                {t('addItem')}
              </Button>
            ) : null}
          </Card>
        );
      })}

      {!onlyCheck ? (
        <Button type="button" variant="secondary" onClick={addCategory}>
          <FolderPlus aria-hidden className="size-4" />
          {t('addCategory')}
        </Button>
      ) : null}

      {/* The confirm bar stays on screen while the owner scrolls, above the floating "Ask Xedine" button. */}
      <div className="sticky bottom-20 z-20 rounded-card border border-edge-strong bg-surface/85 p-3 shadow-soft backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-sm">
            {state.error ? (
              <Alert tone="danger">{te(state.error, state.data)}</Alert>
            ) : discardState.error ? (
              <Alert tone="danger">{te(discardState.error, discardState.data)}</Alert>
            ) : fixFirst ? (
              <p className="flex items-center gap-2 font-semibold text-warning">
                <AlertTriangle aria-hidden className="size-4 shrink-0" />
                {t('fixFirst', { n: n(problems) })}
              </p>
            ) : (
              <p className="text-secondary">
                {t('willAdd', { n: n(adding), cats: n(cats.length) })}
              </p>
            )}
          </div>
          <form action={discardAction}>
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="draftId" value={draftId} />
            <Button
              type="submit"
              variant="ghost"
              disabled={discarding || importing}
              onClick={(e) => {
                if (!window.confirm(t('discardConfirm'))) e.preventDefault();
              }}
            >
              {t('discard')}
            </Button>
          </form>
          <form action={importAction}>
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="draftId" value={draftId} />
            <input type="hidden" name="from" value="review" />
            <input type="hidden" name="csv" value={csv} />
            <Button type="submit" disabled={fixFirst || adding === 0 || importing || discarding}>
              {importing ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Check aria-hidden className="size-4" />
              )}
              {t('confirm', { n: n(adding) })}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
