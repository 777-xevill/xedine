'use client';

import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Plus,
  Search,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { Callout, GroupHeading, ToneIcon } from '@/components/stock/parts';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Hint, Input, Select } from '@/components/ui/form';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { suggestIngredients } from '@/modules/purchasing/lines';
import { saveDishAction, suggestDishAction } from '@/modules/recipes/actions';
import {
  findIngredient,
  MAX_DISH_ROWS,
  unitsForRow,
  type DishRow,
  type KnownIngredient,
} from '@/modules/recipes/dish';

export interface DishView {
  id: string;
  /** In the reader's language. */
  name: string;
  /** What one list takes from stock, as rows ("Chicken", "150", "g"); empty when nothing is written. */
  rows: DishRow[];
  aiHelped: boolean;
  /** An AI suggestion nobody saved yet: it fills a dish that has nothing written. */
  draft: { id: string; note: string; rows: DishRow[] } | null;
  /** Owner and accountant: what one plate costs to make, formatted; null for everyone else. */
  cost: { text: string; complete: boolean } | null;
}

const LIST_ID = 'dish-ingredient-names';

/**
 * Every dish and what goes into one plate (ADR 0037). Dishes with nothing written come first, so the
 * list is a to-do list until it is done. The owner or the manager edits; everyone else reads.
 */
export function DishList({
  orgId,
  orgSlug,
  dishes,
  known,
  canEdit,
  aiReady,
}: {
  orgId: string;
  orgSlug: string;
  dishes: DishView[];
  known: KnownIngredient[];
  canEdit: boolean;
  aiReady: boolean;
}) {
  const t = useTranslations('recipes');
  const loc = useLocale() as Locale;
  const [query, setQuery] = React.useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? dishes.filter((d) => d.name.toLowerCase().includes(q)) : dishes;
  const groups = [
    {
      key: 'todo',
      tone: 'warning',
      icon: <CircleDashed />,
      list: shown.filter((d) => !d.rows.length),
    },
    {
      key: 'done',
      tone: 'success',
      icon: <CircleCheck />,
      list: shown.filter((d) => d.rows.length),
    },
  ] as const;
  return (
    <div className="space-y-5">
      <datalist id={LIST_ID}>
        {known.map((k) => (
          <option key={k.id} value={loc === 'bn' && k.name_bn ? k.name_bn : k.name} />
        ))}
      </datalist>
      {dishes.length > 8 ? (
        <div className="relative max-w-md">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-secondary"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="ps-10"
          />
        </div>
      ) : null}
      {shown.length === 0 ? <p className="text-sm text-secondary">{t('noMatch')}</p> : null}
      {groups.map((g) =>
        g.list.length === 0 ? null : (
          <section key={g.key}>
            <GroupHeading tone={g.tone} icon={g.icon}>
              {`${t(`group.${g.key}`)} (${formatNumber(g.list.length, loc)})`}
            </GroupHeading>
            <ul className="space-y-2">
              {g.list.map((d) => (
                <DishCard
                  key={d.id}
                  orgId={orgId}
                  orgSlug={orgSlug}
                  dish={d}
                  known={known}
                  canEdit={canEdit}
                  aiReady={aiReady}
                />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

/** "1.5" → "১.৫" in Bangla, with the decimals it was written with. */
function useQty() {
  const loc = useLocale() as Locale;
  const tu = useTranslations('units');
  return (r: DishRow) => {
    const n = Number(r.qty);
    const digits = r.qty.split('.')[1]?.length ?? 0;
    return `${Number.isFinite(n) ? formatNumber(n, loc, { fractionDigits: digits }) : r.qty} ${tu(r.unit)}`;
  };
}

function DishCard({
  orgId,
  orgSlug,
  dish,
  known,
  canEdit,
  aiReady,
}: {
  orgId: string;
  orgSlug: string;
  dish: DishView;
  known: KnownIngredient[];
  canEdit: boolean;
  aiReady: boolean;
}) {
  const t = useTranslations('recipes');
  const loc = useLocale() as Locale;
  const qty = useQty();
  const done = dish.rows.length > 0;
  const head = dish.rows.slice(0, 4).map((r) => `${r.name} ${qty(r)}`);
  const summary = done
    ? [
        ...head,
        ...(dish.rows.length > 4
          ? [t('more', { count: formatNumber(dish.rows.length - 4, loc) })]
          : []),
      ].join(' · ')
    : t('nothingYet');
  return (
    <li>
      <details className="group rounded-card border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-start gap-3 rounded-card p-3.5 sm:px-4 [&::-webkit-details-marker]:hidden">
          <ToneIcon
            tone={done ? 'success' : 'neutral'}
            icon={done ? <CircleCheck /> : <CircleDashed />}
            className="size-10"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{dish.name}</span>
            <span className="block text-sm text-secondary">{summary}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              {dish.cost ? (
                dish.cost.complete ? (
                  <Badge tone="neutral">{t('plateCost', { cost: dish.cost.text })}</Badge>
                ) : (
                  <StatusBadge tone="warning">{t('priceMissing')}</StatusBadge>
                )
              ) : null}
              {done && dish.aiHelped ? (
                <Badge tone="accent" icon={<Sparkles />}>
                  {t('aiHelped')}
                </Badge>
              ) : null}
              {!done && dish.draft ? (
                <Badge tone="accent" icon={<Sparkles />}>
                  {t('aiWaiting')}
                </Badge>
              ) : null}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="mt-2.5 size-4 shrink-0 text-secondary transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-line px-3.5 pt-3.5 pb-4 sm:px-4">
          {canEdit ? (
            // Keyed by language: the rows hold ingredient names, so a language switch starts them again.
            <DishEditor
              key={loc}
              orgId={orgId}
              orgSlug={orgSlug}
              dish={dish}
              known={known}
              aiReady={aiReady}
            />
          ) : done ? (
            <ul className="space-y-1 text-sm">
              {dish.rows.map((r, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{r.name}</span>
                  <span className="text-secondary tabular-nums">{qty(r)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Hint className="mt-0">{t('askOwner')}</Hint>
          )}
        </div>
      </details>
    </li>
  );
}

interface EditRow extends DishRow {
  key: number;
}

const blank = (): DishRow => ({ name: '', qty: '', unit: 'g' });

function DishEditor({
  orgId,
  orgSlug,
  dish,
  known,
  aiReady,
}: {
  orgId: string;
  orgSlug: string;
  dish: DishView;
  known: KnownIngredient[];
  aiReady: boolean;
}) {
  const t = useTranslations('recipes');
  const tu = useTranslations('units');
  const te = useTranslations('errors');
  const loc = useLocale() as Locale;
  const fromDraft = dish.rows.length === 0 && dish.draft !== null;
  const [rows, setRows] = React.useState<EditRow[]>(() =>
    (dish.rows.length > 0 ? dish.rows : (dish.draft?.rows ?? [blank(), blank(), blank()])).map(
      (r, i) => ({ ...r, key: i }),
    ),
  );
  // Rows added later (by a tap or the AI) get keys after the first ones, of which there are at most
  // MAX_DISH_ROWS.
  const nextKey = React.useRef(MAX_DISH_ROWS);
  const keyed = (list: DishRow[]): EditRow[] => list.map((r) => ({ ...r, key: ++nextKey.current }));
  const [draftId, setDraftId] = React.useState<string | null>(fromDraft ? dish.draft!.id : null);
  const [note, setNote] = React.useState<string | null>(fromDraft ? dish.draft!.note : null);
  const [undo, setUndo] = React.useState<EditRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [asking, startAsk] = React.useTransition();
  const [saving, startSave] = React.useTransition();
  const busy = asking || saving;
  const label = (k: KnownIngredient) => (loc === 'bn' && k.name_bn ? k.name_bn : k.name);

  const change = (key: number, patch: Partial<DishRow>) => {
    setSaved(false);
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // An item the kitchen keeps in pieces cannot be written in grams: move to a unit that fits.
        const units = unitsForRow(findIngredient(next.name, known));
        return units.includes(next.unit) ? next : { ...next, unit: units[0]! };
      }),
    );
  };

  const ask = () =>
    startAsk(async () => {
      setError(null);
      setSaved(false);
      const res = await suggestDishAction({ orgId, orgSlug, itemId: dish.id });
      if ('error' in res) {
        setError(te(res.error));
        return;
      }
      setUndo(rows.some((r) => r.name.trim()) ? rows : null);
      setRows(keyed(res.rows));
      setDraftId(res.draftId);
      setNote(res.note);
    });

  const save = () =>
    startSave(async () => {
      setError(null);
      const res = await saveDishAction({
        orgId,
        orgSlug,
        itemId: dish.id,
        rows: rows.map(({ name, qty, unit, size }) => ({ name, qty, unit, size })),
        draftId,
      });
      if ('error' in res) {
        setError(te(res.error, res.data));
        return;
      }
      setSaved(true);
      setDraftId(null);
      setNote(null);
      setUndo(null);
    });

  return (
    <div className="space-y-4">
      {aiReady ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button variant="secondary" size="sm" onClick={ask} disabled={busy}>
            <Sparkles aria-hidden className="size-4 text-purple" />
            {asking ? t('asking') : t('askAi')}
          </Button>
          <span className="text-xs text-secondary">{t('askAiHint')}</span>
        </div>
      ) : null}

      {draftId ? (
        <Callout tone="info" icon={<Sparkles />}>
          <p className="font-semibold">{t('aiCheckTitle')}</p>
          <p className="text-secondary">{t('aiCheckBody')}</p>
          {note ? <p className="mt-1 text-secondary">{note}</p> : null}
          {undo ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 -ms-3"
              onClick={() => {
                setRows(undo);
                setUndo(null);
                setDraftId(null);
                setNote(null);
              }}
            >
              <Undo2 aria-hidden className="size-4" />
              {t('undoAi')}
            </Button>
          ) : null}
        </Callout>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-semibold">{t('listFor', { dish: dish.name })}</p>
        <ul className="space-y-2">
          {rows.map((r) => {
            const match = findIngredient(r.name, known);
            const close =
              !match && r.name.trim().length >= 3 ? suggestIngredients(r.name, known, null, 2) : [];
            return (
              <li key={r.key} className="rounded-input border border-line p-2 sm:border-0 sm:p-0">
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <Input
                    list={LIST_ID}
                    value={r.name}
                    maxLength={120}
                    onChange={(e) => change(r.key, { name: e.target.value })}
                    placeholder={t('ingredientPlaceholder')}
                    aria-label={t('ingredient')}
                    className="min-w-0 basis-full sm:basis-auto sm:flex-1"
                  />
                  <Input
                    value={r.qty}
                    inputMode="decimal"
                    maxLength={12}
                    onChange={(e) => change(r.key, { qty: e.target.value })}
                    placeholder={t('amountPlaceholder')}
                    aria-label={t('amount')}
                    className="w-24 min-w-0 flex-1 sm:flex-none"
                  />
                  <Select
                    value={r.unit}
                    onChange={(e) => change(r.key, { unit: e.target.value as DishRow['unit'] })}
                    aria-label={t('unit')}
                    className="w-28 min-w-0 flex-1 sm:flex-none"
                  >
                    {unitsForRow(match).map((u) => (
                      <option key={u} value={u}>
                        {tu(u)}
                      </option>
                    ))}
                  </Select>
                  {r.unit === 'other' ? (
                    <Input
                      value={r.size ?? ''}
                      inputMode="decimal"
                      maxLength={12}
                      onChange={(e) => change(r.key, { size: e.target.value })}
                      placeholder={tu(
                        match?.base === 'g'
                          ? 'otherSizeG'
                          : match?.base === 'ml'
                            ? 'otherSizeMl'
                            : match?.base === 'pcs'
                              ? 'otherSizePcs'
                              : 'otherSizeAny',
                      )}
                      aria-label={tu('otherSizeAny')}
                      className="w-full min-w-0 sm:w-56"
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSaved(false);
                      setRows((prev) => prev.filter((x) => x.key !== r.key));
                    }}
                    aria-label={t('removeLine', { name: r.name.trim() || t('ingredient') })}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </div>
                {r.name.trim() && !match ? (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary">
                    <span>{t('newIngredient')}</span>
                    {close.length > 0 ? <span>{t('didYouMean')}</span> : null}
                    {close.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => change(r.key, { name: label(c) })}
                        className="rounded-full border border-purple/30 px-2 py-0.5 font-semibold text-purple hover:bg-purple/8"
                      >
                        {label(c)}
                      </button>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 -ms-3"
          disabled={rows.length >= MAX_DISH_ROWS}
          onClick={() => {
            setSaved(false);
            setRows((prev) => [...prev, ...keyed([blank()])]);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {t('addLine')}
        </Button>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t('savedDish', { dish: dish.name })}</Alert> : null}
      <Button onClick={save} disabled={busy}>
        {saving ? t('saving') : t('save')}
      </Button>
    </div>
  );
}
