import { describe, expect, it } from 'vitest';
import { pageKeyFromPath } from './page-key';

describe('pageKeyFromPath', () => {
  it('maps each page to its sidebar key', () => {
    expect(pageKeyFromPath('demo', '/demo')).toBe('home');
    expect(pageKeyFromPath('demo', '/demo/stock')).toBe('stock');
    expect(pageKeyFromPath('demo', '/demo/menu-profit')).toBe('menuProfit');
    expect(pageKeyFromPath('demo', '/demo/assistant')).toBe('chat');
    expect(pageKeyFromPath('demo', '/demo/branch')).toBe('branchSetup');
    expect(pageKeyFromPath('demo', '/demo/discount-codes')).toBe('discountCodes');
  });

  it('separates staff from staff records, and the settings pages from each other', () => {
    expect(pageKeyFromPath('demo', '/demo/staff')).toBe('staff');
    expect(pageKeyFromPath('demo', '/demo/staff/records')).toBe('staffRecords');
    expect(pageKeyFromPath('demo', '/demo/settings')).toBe('general');
    expect(pageKeyFromPath('demo', '/demo/settings/features')).toBe('features');
    expect(pageKeyFromPath('demo', '/demo/settings/assistant')).toBe('assistantRules');
    expect(pageKeyFromPath('demo', '/demo/settings/telegram')).toBe('telegram');
  });

  it('knows nothing about other organizations or unlisted pages', () => {
    expect(pageKeyFromPath('demo', '/other/stock')).toBeNull();
    expect(pageKeyFromPath('demo', '/demo/calendar')).toBeNull();
  });
});
