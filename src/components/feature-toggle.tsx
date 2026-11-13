'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Switch } from '@/components/ui/segmented';
import { toggleFeatureAction } from '@/modules/settings/actions';
import type { FeatureKey } from '@/modules/tenancy/navigation';

/**
 * One Settings → Features switch. It flips at once and keeps its own state (so what you see is what you
 * pressed), saves in the background, then refreshes the page so the sidebar follows; on failure it flips back.
 */
export function FeatureToggle({
  orgId,
  orgSlug,
  feature,
  enabled,
  label,
}: {
  orgId: string;
  orgSlug: string;
  feature: FeatureKey;
  enabled: boolean;
  label: string;
}) {
  const te = useTranslations('errors');
  const router = useRouter();
  const [on, setOn] = React.useState(enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  // A fresh value from the server (another tab, a refresh) wins over what this switch last showed.
  const [seen, setSeen] = React.useState(enabled);
  if (seen !== enabled) {
    setSeen(enabled);
    setOn(enabled);
  }

  async function change(next: boolean) {
    setError(null);
    setOn(next);
    setPending(true);
    try {
      const fd = new FormData();
      fd.set('orgId', orgId);
      fd.set('orgSlug', orgSlug);
      fd.set('feature', feature);
      fd.set('on', String(next));
      const result = await toggleFeatureAction(fd);
      if (result.error) {
        setOn(!next);
        setError(te(result.error));
      } else {
        router.refresh();
      }
    } catch {
      setOn(!next);
      setError(te('invalidInput'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={on}
        label={label}
        disabled={pending}
        testId={`feature-${feature}`}
        onChange={(next) => void change(next)}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
