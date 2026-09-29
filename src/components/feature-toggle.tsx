'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Switch } from '@/components/ui/segmented';
import { toggleFeatureAction } from '@/modules/settings/actions';
import type { FeatureKey } from '@/modules/tenancy/navigation';

/** One Settings → Features switch. Flips at once, saves in the background, reverts on failure. */
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
  const [on, setOn] = React.useOptimistic(enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={on}
        label={label}
        disabled={pending}
        testId={`feature-${feature}`}
        onChange={(next) =>
          start(async () => {
            setError(null);
            setOn(next);
            const fd = new FormData();
            fd.set('orgId', orgId);
            fd.set('orgSlug', orgSlug);
            fd.set('feature', feature);
            fd.set('on', String(next));
            const result = await toggleFeatureAction(fd);
            if (result.error) setError(te(result.error));
          })
        }
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
