'use client';

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
