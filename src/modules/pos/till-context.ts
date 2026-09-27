'use client';

import { createContext, useContext } from 'react';
import type { Locale } from '@/lib/i18n/format';
import type { createClient, StaffMember } from './client';
import type { DeviceState } from './device-storage';

/** What every till screen needs: the device, who is PIN'd in, and whether the server is reachable. */
export interface TillContextValue {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staffId: string;
  managers: StaffMember[];
  locale: Locale;
  online: boolean;
}

export const TillContext = createContext<TillContextValue | null>(null);

export function useTill(): TillContextValue {
  const value = useContext(TillContext);
  if (!value) throw new Error('useTill must be used inside the till');
  return value;
}
