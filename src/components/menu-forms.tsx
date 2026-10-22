'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { ErrorAlert } from '@/components/auth-forms';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label, Select } from '@/components/ui/form';
import {
  createCategoryAction,
  createItemAction,
  createModifierAction,
  createModifierGroupAction,
  createVariantAction,
  setItemModifierGroupsAction,
} from '@/modules/menu/actions';
import { initialState } from '@/modules/tenancy/form-state';

export function CategoryForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('menu');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState(createCategoryAction, initialState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <Label htmlFor="catName">{t('categoryName')}</Label>
        <Input
          id="catName"
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          placeholder={t('categoryPlaceholder')}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? tc('loading') : t('addCategory')}
      </Button>
      <ErrorAlert error={state.error} />
    </form>
  );
}

export function ItemForm({
  orgId,
  orgSlug,
  categories,
}: {
  orgId: string;
  orgSlug: string;
  categories: { id: string; name: string }[];
}) {
  const t = useTranslations('menu');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState(createItemAction, initialState);
  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1.5fr_1fr_auto] sm:items-end"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <ErrorAlert error={state.error} />
      <div>
        <Label htmlFor="itemName">{t('itemName')}</Label>
        <Input
          id="itemName"
          name="name"
          required
          maxLength={200}
          autoComplete="off"
          placeholder={t('itemPlaceholder')}
        />
      </div>
      <div>
        <Label htmlFor="itemCategory">{t('categoryLabel')}</Label>
        <Select id="itemCategory" name="categoryId" defaultValue="">
          <option value="">{t('uncategorised')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="itemPrice">{t('basePrice')}</Label>
        <Input
          id="itemPrice"
          name="price"
          inputMode="decimal"
          required
          autoComplete="off"
          placeholder={t('pricePlaceholder')}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? tc('loading') : t('addItem')}
      </Button>
    </form>
  );
}

export function VariantForm({
  orgId,
  orgSlug,
  itemId,
}: {
  orgId: string;
  orgSlug: string;
  itemId: string;
}) {
  const t = useTranslations('menu');
  return (
    <ActionForm action={createVariantAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="itemId" value={itemId} />
      <div>
        <Label htmlFor={`vname-${itemId}`}>{t('variantName')}</Label>
        <Input
          id={`vname-${itemId}`}
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder={t('variantPlaceholder')}
          className="w-36"
        />
      </div>
      <div>
        <Label htmlFor={`vdelta-${itemId}`}>{t('sizePrice')}</Label>
        <Input
          id={`vdelta-${itemId}`}
          name="price"
          inputMode="decimal"
          autoComplete="off"
          placeholder={t('sizePricePlaceholder')}
          aria-describedby={`vhint-${itemId}`}
          className="w-28"
        />
      </div>
      <Button type="submit" size="sm">
        {t('addVariant')}
      </Button>
      <Hint id={`vhint-${itemId}`} className="basis-full">
        {t('sizePriceHint')}
      </Hint>
    </ActionForm>
  );
}

export function ModifierGroupForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('menu');
  return (
    <ActionForm action={createModifierGroupAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <Label htmlFor="groupName">{t('groupName')}</Label>
        <Input
          id="groupName"
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder={t('groupPlaceholder')}
          className="w-40"
        />
      </div>
      <div>
        <Label htmlFor="groupMin">{t('minSelect')}</Label>
        <Input
          id="groupMin"
          name="minSelect"
          type="number"
          min={0}
          max={20}
          defaultValue={0}
          aria-describedby="groupHint"
          className="w-20"
        />
      </div>
      <div>
        <Label htmlFor="groupMax">{t('maxSelect')}</Label>
        <Input
          id="groupMax"
          name="maxSelect"
          type="number"
          min={1}
          max={20}
          defaultValue={1}
          aria-describedby="groupHint"
          className="w-20"
        />
      </div>
      <Button type="submit">{t('addGroup')}</Button>
      <Hint id="groupHint" className="basis-full">
        {t('groupRangeHint')}
      </Hint>
    </ActionForm>
  );
}

export function ModifierForm({
  orgId,
  orgSlug,
  groupId,
}: {
  orgId: string;
  orgSlug: string;
  groupId: string;
}) {
  const t = useTranslations('menu');
  return (
    <ActionForm action={createModifierAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="groupId" value={groupId} />
      <div>
        <Label htmlFor={`mname-${groupId}`}>{t('modifierName')}</Label>
        <Input
          id={`mname-${groupId}`}
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder={t('modifierPlaceholder')}
          className="w-36"
        />
      </div>
      <div>
        <Label htmlFor={`mprice-${groupId}`}>{t('modifierPrice')}</Label>
        <Input
          id={`mprice-${groupId}`}
          name="price"
          inputMode="decimal"
          placeholder="0"
          className="w-20"
        />
      </div>
      <Button type="submit" size="sm">
        {t('addModifier')}
      </Button>
    </ActionForm>
  );
}

/** Which add-on groups apply to this item — a checkbox set, saved as one replace-the-set call. */
export function ItemModifierGroupsForm({
  orgId,
  orgSlug,
  itemId,
  groups,
  selected,
}: {
  orgId: string;
  orgSlug: string;
  itemId: string;
  groups: { id: string; name: string }[];
  selected: string[];
}) {
  const t = useTranslations('menu');
  const [state, action, pending] = useActionState(setItemModifierGroupsAction, initialState);
  const [picked, setPicked] = useState(new Set(selected));
  if (groups.length === 0) return <p className="text-sm text-secondary">{t('itemNoGroups')}</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="itemId" value={itemId} />
      <ErrorAlert error={state.error} />
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const active = picked.has(g.id);
          return (
            <label
              key={g.id}
              className={`glass-tile flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm ${active ? 'border-purple/60 text-foreground' : 'text-secondary'}`}
            >
              <input
                type="checkbox"
                name="groupIds"
                value={g.id}
                checked={active}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  })
                }
                className="size-3.5 accent-purple"
              />
              {g.name}
            </label>
          );
        })}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {t('saveGroups')}
      </Button>
    </form>
  );
}
