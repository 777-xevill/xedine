'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/form';
import {
  createDiscountCodeAction,
  deleteDiscountCodeAction,
  toggleDiscountCodeAction,
} from '@/modules/discounts/actions';
import { normalizeCode, randomCode } from '@/modules/discounts/codes';

/** The box for a new code, with "Make one for me" for a code nobody can guess. */
export function DiscountCodeForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('discountCodes');
  return (
    <ActionForm
      action={createDiscountCodeAction}
      successKey="discountCodes.made"
      className="grid gap-4 sm:grid-cols-2"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <Label htmlFor="dc-code">{t('code')}</Label>
        <div className="flex gap-2">
          <Input
            id="dc-code"
            name="code"
            required
            maxLength={24}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t('codePlaceholder')}
            onChange={(e) => {
              e.target.value = normalizeCode(e.target.value);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              // The box is uncontrolled, so the form's own reset clears it after a code is made.
              const box = document.getElementById('dc-code');
              if (!(box instanceof HTMLInputElement)) return;
              box.value = randomCode((n) => {
                const bytes = new Uint32Array(1);
                crypto.getRandomValues(bytes);
                return bytes[0]! % n;
              });
            }}
          >
            {t('makeOne')}
          </Button>
        </div>
        <Hint>{t('codeHint')}</Hint>
      </div>
      <div>
        <Label htmlFor="dc-percent">{t('percent')}</Label>
        <Input
          id="dc-percent"
          name="percent"
          required
          inputMode="decimal"
          maxLength={6}
          defaultValue="10"
        />
        <Hint>{t('percentHint')}</Hint>
      </div>
      <div>
        <Label htmlFor="dc-uses">{t('uses')}</Label>
        <Input id="dc-uses" name="maxUses" inputMode="numeric" maxLength={6} />
        <Hint>{t('usesHint')}</Hint>
      </div>
      <div>
        <Label htmlFor="dc-end">{t('endsOn')}</Label>
        <Input id="dc-end" name="endsOn" type="date" />
        <Hint>{t('endsOnHint')}</Hint>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="dc-note">{t('note')}</Label>
        <Input id="dc-note" name="note" maxLength={120} placeholder={t('notePlaceholder')} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit">{t('make')}</Button>
      </div>
    </ActionForm>
  );
}

/** Turn a code off (or back on) without losing it. */
export function ToggleCodeButton({
  orgSlug,
  id,
  active,
}: {
  orgSlug: string;
  id: string;
  active: boolean;
}) {
  const t = useTranslations('discountCodes');
  return (
    <form action={toggleDiscountCodeAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="active" value={String(active)} />
      <Button type="submit" variant="ghost" size="sm">
        {active ? t('turnOff') : t('turnOn')}
      </Button>
    </form>
  );
}

/** Delete a code after a plain "are you sure"; bills that used it keep their discount. */
export function DeleteCodeButton({ orgSlug, id }: { orgSlug: string; id: string }) {
  const t = useTranslations('discountCodes');
  return (
    <form
      action={deleteDiscountCodeAction}
      onSubmit={(e) => {
        if (!window.confirm(t('deleteConfirm'))) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <Button type="submit" variant="ghost" size="sm" className="text-danger">
        {t('delete')}
      </Button>
    </form>
  );
}
