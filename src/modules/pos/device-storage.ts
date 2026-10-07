'use client';

import type { VatConfig } from '@/lib/money';
import type {
  Channel,
  DiningTable,
  MenuCategory,
  ReasonCode,
  ReceiptInfo,
  ShiftRow,
  StaffMember,
} from './client';

/**
 * Device pairing and staff-session state, kept in the browser only. None of this is an RLS
 * credential (ADR 0013) — losing it just logs the till out; it never grants data access on its own.
 */
export interface DeviceState {
  deviceId: string;
  orgId: string;
  orgSlug: string;
  branchId: string;
  branchName: string;
}
export interface StaffSessionState {
  sessionId: string;
  staffId: string;
  staffName: string;
}

const DEVICE_KEY = 'xedine.pos.device';
const SESSION_KEY = 'xedine.pos.staff-session';

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing / storage blocked: the device just re-pairs next load.
  }
}
function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const getDevice = (): DeviceState | null => safeGet<DeviceState>(DEVICE_KEY);
export const setDevice = (state: DeviceState): void => safeSet(DEVICE_KEY, state);
export const clearDevice = (): void => safeRemove(DEVICE_KEY);

export const getStaffSession = (): StaffSessionState | null =>
  safeGet<StaffSessionState>(SESSION_KEY);
export const setStaffSession = (state: StaffSessionState): void => safeSet(SESSION_KEY, state);
export const clearStaffSession = (): void => safeRemove(SESSION_KEY);

/**
 * Everything the till needs to keep selling with no network (ARCHITECTURE.md "Offline POS":
 * cached menu). Refreshed on every successful load; read only when the network load fails.
 */
export interface TillSnapshot {
  savedAt: string;
  shift: ShiftRow | null;
  vat: VatConfig;
  menu: MenuCategory[];
  channels: Channel[];
  tables: DiningTable[];
  voidReasons: ReasonCode[];
  discountReasons: ReasonCode[];
  refundReasons: ReasonCode[];
  staff: StaffMember[];
  receipt: ReceiptInfo;
}

const snapshotKey = (deviceId: string) => `xedine.pos.snapshot.${deviceId}`;
export const getTillSnapshot = (deviceId: string): TillSnapshot | null =>
  safeGet<TillSnapshot>(snapshotKey(deviceId));
export const setTillSnapshot = (deviceId: string, snapshot: TillSnapshot): void =>
  safeSet(snapshotKey(deviceId), snapshot);

/** Per-device counter behind provisional receipt numbers; never reused, even across reloads. */
export function nextProvisionalCounter(deviceId: string): number {
  const key = `xedine.pos.provisional.${deviceId}`;
  const next = (safeGet<number>(key) ?? 0) + 1;
  safeSet(key, next);
  return next;
}

/**
 * How this till shows the menu (ADR 0031): words only, or a photo above the words. A choice of the
 * device, not of the restaurant — a counter till can show photos while a back-office till stays plain.
 */
export type TillView = 'text' | 'photo';
const VIEW_KEY = 'xedine.pos.view';
export const getTillView = (): TillView =>
  safeGet<string>(VIEW_KEY) === 'photo' ? 'photo' : 'text';
export const setTillView = (view: TillView): void => safeSet(VIEW_KEY, view);
