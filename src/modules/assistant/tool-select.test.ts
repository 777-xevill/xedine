import { afterEach, describe, expect, it } from 'vitest';
import { GROUPS, selectTools, toolNamesFor } from './tool-select';
import { TOOL_DEFS } from './tools';

describe('tool selection', () => {
  afterEach(() => {
    delete process.env.AI_TOOLS;
  });

  it('reaches every tool through some group (or always)', () => {
    const reachable = new Set([
      'get_today_brief',
      'find_page',
      ...Object.values(GROUPS).flatMap((g) => g.tools),
    ]);
    for (const t of TOOL_DEFS) expect(reachable.has(t.name), t.name).toBe(true);
    for (const n of reachable)
      expect(
        TOOL_DEFS.map((t) => t.name),
        n,
      ).toContain(n);
  });

  it('gives a broad question only the brief and the app guide', () => {
    expect(toolNamesFor('What should I do today?')).toEqual(['get_today_brief', 'find_page']);
  });

  it('adds the groups a question names, in English, Banglish and Bangla', () => {
    expect(toolNamesFor('Where am I losing money?')).toEqual(
      expect.arrayContaining(['get_findings', 'get_stock_loss']),
    );
    expect(toolNamesFor('kothay loss hocche')).toContain('get_stock_loss');
    expect(toolNamesFor('আজ বিক্রি কত হলো?')).toContain('get_sales');
    expect(toolNamesFor('when does my trade licence expire')).toContain('get_compliance');
  });

  it('adds the page the person is on, except Home', () => {
    expect(toolNamesFor('explain this page', 'stock')).toContain('get_stock_status');
    expect(toolNamesFor('explain this page', 'home')).toEqual(['get_today_brief', 'find_page']);
  });

  it('sends everything when the plan allows it', () => {
    expect(selectTools('hello').length).toBeLessThan(TOOL_DEFS.length);
    process.env.AI_TOOLS = 'all';
    expect(selectTools('hello')).toHaveLength(TOOL_DEFS.length);
  });
});
