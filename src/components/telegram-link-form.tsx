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
  people,
  ready,
}: {
  orgId: string;
  orgSlug: string;
  people: {
    userId: string;
    isOwner: boolean;
    label: string;
    branches: { id: string; name: string; allowed: boolean }[];
  }[];
  ready: boolean;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createChatLinkAction, initialState);
  const [copied, setCopied] = useState(false);
  const [userId, setUserId] = useState(people[0]?.userId ?? '');
  const [branchId, setBranchId] = useState('');
  const person = people.find((p) => p.userId === userId) ?? people[0];
  // A branch picked for someone else does not carry over: fall back to this person's first branch.
  const branch =
    person?.branches.find((b) => b.id === branchId && b.allowed) ??
    person?.branches.find((b) => b.allowed);
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
      <input
        type="hidden"
        name="target"
        value={person && branch ? `${person.userId}|${branch.id}` : ''}
      />
      <div>
        <Label htmlFor="tg-person">{t('telegramPage.person')}</Label>
        <Select
          id="tg-person"
          value={person?.userId ?? ''}
          onChange={(e) => {
            setUserId(e.target.value);
            setBranchId('');
            setCopied(false);
          }}
        >
          {people.map((x) => (
            <option key={x.userId} value={x.userId}>
              {x.label}
            </option>
          ))}
        </Select>
      </div>
      {person?.isOwner ? (
        // The owner is not buying: one chat for the whole restaurant (briefs, alerts, questions).
        <p className="text-sm text-secondary">{t('telegramPage.ownerNote')}</p>
      ) : person ? (
        <div>
          <Label htmlFor="tg-branch">{t('telegramPage.branch')}</Label>
          <Select
            id="tg-branch"
            value={branch?.id ?? ''}
            onChange={(e) => {
              setBranchId(e.target.value);
              setCopied(false);
            }}
          >
            {person.branches.map((b) => (
              <option key={b.id} value={b.id} disabled={!b.allowed}>
                {b.allowed ? b.name : t('telegramPage.noAccess', { name: b.name })}
              </option>
            ))}
          </Select>
          {person.branches.some((b) => !b.allowed) ? (
            <Hint className="mt-1">
              {t('telegramPage.moreBranches')}{' '}
              <a href={`/${orgSlug}/team`} className="font-medium text-purple underline">
                {t('telegramPage.openTeam')}
              </a>
            </Hint>
          ) : null}
        </div>
      ) : null}
      <Hint>{t('telegramPage.linkHint')}</Hint>
      <Button type="submit" disabled={!ready || pending} onClick={() => setCopied(false)}>
        {t('telegramPage.makeLink')}
      </Button>
    </form>
  );
}
