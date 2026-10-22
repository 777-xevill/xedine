'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Alert, Hint, Input, Label, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/auth-forms';
import { createChatLinkAction } from '@/modules/purchasing/chat-actions';
import { initialState } from '@/modules/tenancy/form-state';

/** Make a one-time Telegram link for a purchaser, with a Copy button next to the finished link. */
export function TelegramLinkForm({
  orgId,
  orgSlug,
  targets,
  ready,
}: {
  orgId: string;
  orgSlug: string;
  targets: { value: string; label: string }[];
  ready: boolean;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createChatLinkAction, initialState);
  const [copied, setCopied] = useState(false);
  const link = state.ok ? state.data?.link : undefined;

  return (
    <form action={action} aria-busy={pending} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <ErrorAlert error={state.error} />
      {link ? (
        <Alert tone="success">
          <p>{t('telegramPage.linkReady')}</p>
          <div className="mt-2 flex gap-2">
            <Input
              readOnly
              value={link}
              aria-label={t('common.copy')}
              data-testid="telegram-link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <div>
        <Label htmlFor="tg-target">{t('telegramPage.person')}</Label>
        <Select id="tg-target" name="target" required onChange={() => setCopied(false)}>
          {targets.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </Select>
      </div>
      <Hint>{t('telegramPage.linkHint')}</Hint>
      <Button type="submit" disabled={!ready || pending} onClick={() => setCopied(false)}>
        {t('telegramPage.makeLink')}
      </Button>
    </form>
  );
}
