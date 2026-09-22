'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { ErrorAlert } from '@/components/auth-forms';
import { createCategoryAction, createItemAction } from '@/modules/menu/actions';
import { initialState } from '@/modules/tenancy/form-state';

export function CategoryForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('menu');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState(createCategoryAction, initialState);
  return (
    <form action={action} className="flex items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div className="flex-1">
        <Label htmlFor="catName">{t('categoryName')}</Label>
        <Input id="catName" name="name" required />
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
      className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <ErrorAlert error={state.error} />
      <div>
        <Label htmlFor="itemName">{t('itemName')}</Label>
        <Input id="itemName" name="name" required />
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
        <Input id="itemPrice" name="price" inputMode="decimal" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? tc('loading') : t('addItem')}
      </Button>
    </form>
  );
}
