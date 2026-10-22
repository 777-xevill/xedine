import { describe, expect, it } from 'vitest';
import { findPages, PAGE_GUIDE, type Access } from './app-guide';
import { pageLinks } from './links';
import { TOOL_DEFS, TOOL_PAGES } from './tools';

const owner = (enabled: Access['enabled'] = []): Access => ({
  slug: 'demo',
  roles: ['owner'],
  enabled,
});

describe('findPages', () => {
  it('finds the page for a topic, in English and Bangla', () => {
    // Dish ingredients is always on (ADR 0037).
    expect(findPages('where do I add a recipe', owner())[0]).toMatchObject({
      key: 'recipes',
      status: 'open',
      path: '/demo/recipes',
    });
    expect(findPages('বার্গারের উপকরণ', owner())[0]?.key).toBe('recipes');
    expect(findPages('আজকের বিক্রি', owner())[0]?.key).toBe('sales');
    expect(findPages('vat return due', owner(['compliance']))[0]?.key).toBe('compliance');
  });

  it('says how to get a page that is switched off or not for this role', () => {
    const off = findPages('menu profit', owner())[0];
    expect(off).toMatchObject({ key: 'menuProfit', status: 'switched_off' });
    expect(off?.how_to_get_it).toContain('Features');
    const manager: Access = { slug: 'demo', roles: ['manager'], enabled: [] };
    expect(findPages('money leaks', manager)[0]).toMatchObject({
      key: 'leaks',
      status: 'not_for_your_role',
    });
  });

  it('lists every page once for an empty topic, and nothing for nonsense', () => {
    const all = findPages('', owner());
    expect(new Set(all.map((p) => p.key)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(20);
    expect(findPages('zzzzqqqq', owner())).toEqual([]);
  });

  it('describes every page the sidebar can show', () => {
    for (const [key, g] of Object.entries(PAGE_GUIDE)) {
      expect(g.name, key).not.toBe('');
      expect(g.what.length, key).toBeGreaterThan(10);
    }
  });
});

describe('pageLinks', () => {
  const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });

  it('links the page each tool belongs to, once, and not the page already open', () => {
    const links = pageLinks(
      [call('get_stock_status'), call('get_stock_loss'), call('get_sales')],
      owner(),
      'sales',
    );
    expect(links.map((l) => l.key)).toEqual(['stock']);
    expect(links[0]?.href).toBe('/demo/stock');
  });

  it('never offers a page this person cannot open', () => {
    const manager: Access = { slug: 'demo', roles: ['manager'], enabled: [] };
    const links = pageLinks([call('get_findings'), call('get_stock_status')], manager);
    expect(links.map((l) => l.key)).toEqual(['stock']);
  });

  it('adds the pages a find_page lookup found, and at most three links', () => {
    const links = pageLinks(
      [
        call('find_page', { topic: 'supplier' }),
        call('get_sales'),
        call('get_stock_status'),
        call('get_findings'),
      ],
      owner(['purchasing']),
    );
    expect(links.length).toBeLessThanOrEqual(3);
    expect(links[0]?.key).toBe('purchases');
  });
});

describe('the tool list', () => {
  it('names every tool once, and each tool with a page points at a real one', () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const [tool, page] of Object.entries(TOOL_PAGES)) {
      expect(names, tool).toContain(tool);
      expect(Object.keys(PAGE_GUIDE), page).toContain(page);
    }
  });

  it('stays small enough for a small provider plan', () => {
    // Roughly 4 characters a token: the whole list is sent with every model call.
    expect(JSON.stringify(TOOL_DEFS).length / 4).toBeLessThan(4200);
  });
});
