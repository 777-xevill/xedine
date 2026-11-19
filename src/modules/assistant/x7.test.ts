import { describe, expect, it } from 'vitest';
import { groundingSources } from '@/lib/llm-gateway/grounding';
import {
  isReasoningModel,
  toContentBlocks,
  toOpenAiMessages,
  type OpenAiChoice,
} from '@/lib/llm-gateway/openai';
import {
  ACTION_KINDS,
  ACTION_PAGES,
  ACTION_ROLES,
  ACTION_TOOL_DEFS,
  actionKindOfTool,
  actionToolsFor,
  mayDo,
} from './action-kinds';
import { judgeNumbers, strictUnsupported, validateNumbers } from './validator';
import { decodeEntities, htmlToText, safeWebUrl, urlIn, webSourcesOf } from './web-text';

/** ADR 0067: X7, the assistant that knows the world, and the changes it prepares. */

describe('numbers: general knowledge may carry figures, money and percentages never unsourced', () => {
  const tool = { metric_id: 'sales.net', data: { net_taka: 45230, margin_pct: 31 } };
  const unsupported = (text: string) => {
    const r = validateNumbers(text, [tool]);
    return strictUnsupported(text, r.unsupported);
  };

  it('lets a recipe or a food-safety fact keep its own figures', () => {
    expect(unsupported('Cook chicken until the inside reaches 75 °C, about 25 minutes.')).toEqual(
      [],
    );
    expect(
      unsupported('Borhani: 2 cups of yoghurt, 1 cup of water, a pinch of black salt.'),
    ).toEqual([]);
    expect(unsupported('দই ২ কাপ আর পানি ১ কাপ মিশিয়ে ১০ মিনিট রাখুন।')).toEqual([]);
  });

  it('refuses money that no tool gave, in any way it is written', () => {
    expect(unsupported('A good price for borhani is ৳80.')).toEqual([80]);
    expect(unsupported('Most shops sell it for 70 taka.')).toEqual([70]);
    expect(unsupported('দাম ৯০ টাকা রাখতে পারেন।')).toEqual([90]);
    expect(unsupported('Tk 120 a kg in Karwan Bazar.')).toEqual([120]);
    expect(unsupported('Price it at $3.50.')).toEqual([3.5]);
  });

  it('refuses both ends of a money or percent range', () => {
    expect(unsupported('Charge ৳300–400 for the platter.').sort()).toEqual([300, 400]);
    expect(unsupported('Aim for a 30-35% food cost.').sort()).toEqual([30, 35]);
  });

  it('refuses a percentage that no tool gave, and keeps the sourced ones', () => {
    expect(unsupported('Your margin is 31%, the usual is 28%.')).toEqual([28]);
    expect(unsupported('You sold ৳45,230 today.')).toEqual([]);
  });

  it('does not take a word that only ends like a currency for money', () => {
    expect(unsupported('Keep the farm 5 km away.')).toEqual([]);
  });
});

describe('the numbers check per answer', () => {
  const sales = { metric_id: 'items.qty_sold', data: { item_name: 'Kacchi', qty: 7 } };

  it('an answer that read the records is checked as always: an invented count is refused', () => {
    expect(
      judgeNumbers('You sold 45 Kacchi.', [sales], 'how many kacchi?', ['get_item_sales'], true),
    ).toEqual({
      ok: false,
      unsupported: [45],
    });
    expect(
      judgeNumbers('You sold 7 Kacchi.', [sales], 'how many kacchi?', ['get_item_sales'], true),
    ).toEqual({
      ok: true,
      general: false,
    });
  });

  it('a question about the records stays strict even when no tool was called', () => {
    expect(
      judgeNumbers('You sold 45 Kacchi.', [], 'how many kacchi sold today?', [], true).ok,
    ).toBe(false);
  });

  it('general knowledge alone keeps its own figures, but not money or percentages', () => {
    const recipe = 'Mix 2 cups of yoghurt with 1 cup of water and chill for 30 minutes.';
    expect(judgeNumbers(recipe, [], 'how to make borhani?', [], false)).toEqual({
      ok: true,
      general: true,
    });
    expect(
      judgeNumbers(recipe, [], 'how to make borhani?', ['web_search', 'find_page'], false),
    ).toEqual({
      ok: true,
      general: true,
    });
    expect(judgeNumbers('Sell it for ৳80.', [], 'borhani price?', ['web_search'], false)).toEqual({
      ok: false,
      unsupported: [80],
    });
  });

  it('a recipe next to the restaurant’s records keeps its figures only after "General knowledge:"', () => {
    expect(
      judgeNumbers(
        'You sold 7. Mix 2 cups of yoghurt.',
        [sales],
        'borhani',
        ['get_item_sales'],
        false,
      ).ok,
    ).toBe(false);
    expect(
      judgeNumbers(
        'You sold 7 Kacchi.\nGeneral knowledge: mix 2 cups of yoghurt with 1 cup of water.',
        [sales],
        'kacchi sales and borhani recipe',
        ['get_item_sales'],
        true,
      ),
    ).toEqual({ ok: true, general: true });
    expect(
      judgeNumbers(
        'আপনি ৭টি কাচ্চি বিক্রি করেছেন।\nসাধারণ জ্ঞান: ২ কাপ দই আর ১ কাপ পানি মেশান।',
        [sales],
        'kacchi',
        ['get_item_sales'],
        true,
      ).ok,
    ).toBe(true);
    // Above the line the records' rule still holds; below it, money still needs a source.
    expect(
      judgeNumbers(
        'You sold 45.\nGeneral knowledge: 2 cups.',
        [sales],
        'q',
        ['get_item_sales'],
        true,
      ),
    ).toEqual({ ok: false, unsupported: [45] });
    expect(
      judgeNumbers(
        'You sold 7.\nGeneral knowledge: sell it at ৳80.',
        [sales],
        'q',
        ['get_item_sales'],
        true,
      ),
    ).toEqual({ ok: false, unsupported: [80] });
  });
});

describe('Gemini (X7) on the OpenAI wire format', () => {
  it('keeps the thought signature on a tool call and sends it back next turn', () => {
    const choice: OpenAiChoice = {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'get_sales', arguments: '{"window":"today"}' },
            extra_content: { google: { thought_signature: 'SIG' } },
          },
        ],
      },
    };
    const blocks = toContentBlocks(choice);
    const out = toOpenAiMessages(['P'], [{ role: 'assistant', content: blocks }]);
    const assistant = out[1] as Extract<(typeof out)[number], { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0]?.extra_content).toEqual({
      google: { thought_signature: 'SIG' },
    });
    expect(assistant.tool_calls?.[0]?.function.arguments).toBe('{"window":"today"}');
  });

  it('sends no extra_content when the provider gave none (OpenAI, Groq)', () => {
    const blocks = toContentBlocks({
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
    });
    const out = toOpenAiMessages([], [{ role: 'assistant', content: blocks }]);
    expect(JSON.stringify(out)).not.toContain('extra_content');
  });

  it('gives Gemini thinking room like the other reasoning models', () => {
    expect(isReasoningModel('gemini-3.5-flash')).toBe(true);
    expect(isReasoningModel('qwen/qwen3.8-27b')).toBe(false);
  });

  it('reads Google Search sources once each, web links only', () => {
    expect(
      groundingSources({
        groundingChunks: [
          { web: { uri: 'https://a.example/x', title: 'A' } },
          { web: { uri: 'https://a.example/x', title: 'A again' } },
          { web: { uri: 'javascript:alert(1)', title: 'bad' } },
          { web: { uri: 'https://b.example/', title: 'B' } },
        ],
      }),
    ).toEqual([
      { title: 'A', url: 'https://a.example/x' },
      { title: 'B', url: 'https://b.example/' },
    ]);
    expect(groundingSources(null)).toEqual([]);
  });
});

describe('the changes the assistant may prepare', () => {
  it('has a tool, roles and a page for every kind', () => {
    expect(ACTION_TOOL_DEFS.map((t) => t.name).sort()).toEqual(
      ACTION_KINDS.map((k) => `propose_${k}`).sort(),
    );
    for (const k of ACTION_KINDS) {
      expect(ACTION_ROLES[k].length).toBeGreaterThan(0);
      expect(ACTION_PAGES[k]).toBeTruthy();
      expect(actionKindOfTool(`propose_${k}`)).toBe(k);
    }
    expect(actionKindOfTool('get_sales')).toBeNull();
    expect(actionKindOfTool('propose_drop_table')).toBeNull();
  });

  it('every tool says it only prepares, and allows no extra fields', () => {
    for (const t of ACTION_TOOL_DEFS) {
      expect(t.description).toContain('Prepares the change only');
      expect((t.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(
        false,
      );
    }
  });

  it('managers may plan the day and write waste, not change prices or costs', () => {
    expect(mayDo('add_party_order', ['manager'])).toBe(true);
    expect(mayDo('add_special_day', ['manager'])).toBe(true);
    expect(mayDo('log_waste', ['manager'])).toBe(true);
    expect(mayDo('change_price', ['manager'])).toBe(false);
    expect(mayDo('add_fixed_cost', ['manager'])).toBe(false);
    expect(mayDo('change_price', ['accountant'])).toBe(false);
    expect(mayDo('change_price', ['owner'])).toBe(true);
  });

  it('offers the everyday model the change tools only when the question asks for a change', () => {
    expect(actionToolsFor('How were sales yesterday?', ['owner'])).toEqual([]);
    expect(actionToolsFor('Add Chicken Tehari at 220', ['owner']).map((t) => t.name)).toEqual([
      'propose_add_category',
      'propose_add_dish',
      'propose_change_price',
      'propose_set_dish_on_menu',
    ]);
    expect(
      actionToolsFor('Add Karim Traders as a supplier and remember we close at 11', ['owner']).map(
        (t) => t.name,
      ),
    ).toEqual([
      'propose_add_special_day',
      'propose_add_party_order',
      'propose_record_purchase',
      'propose_add_supplier',
      'propose_remember_rule',
    ]);
    // A change the words cannot place: every tool this person may use.
    expect(actionToolsFor('please update it', ['owner']).length).toBe(ACTION_KINDS.length);
    expect(actionToolsFor('কাচ্চির দাম ৩৫০ করে দাও', ['owner']).length).toBeGreaterThan(0);
    expect(actionToolsFor('kal 40 jon er party ache, plan koro', ['owner']).length).toBeGreaterThan(
      0,
    );
    const manager = actionToolsFor('Add a party order for Friday', ['manager']).map((t) => t.name);
    expect(manager).toContain('propose_add_party_order');
    expect(manager).not.toContain('propose_change_price');
  });
});

describe('web pages for the assistant', () => {
  it('reads only public http(s) addresses', () => {
    expect(safeWebUrl('https://en.wikipedia.org/wiki/Biryani')?.hostname).toBe('en.wikipedia.org');
    for (const bad of [
      'http://localhost:3000',
      'http://127.0.0.1/admin',
      'http://10.0.0.5',
      'https://[::1]/',
      'file:///etc/passwd',
      'https://user:pw@example.com',
      'https://example.com:8443/',
      'https://intranet/',
      'https://printer.local/',
      'not a url',
    ])
      expect(safeWebUrl(bad)).toBeNull();
  });

  it('turns a page into its title and readable text, without scripts and menus', () => {
    const page = htmlToText(
      '<html><head><title>Borhani &amp; more</title><script>evil()</script></head><body><nav>Home | Shop</nav><h1>Borhani</h1><p>A spiced yoghurt drink.</p><ul><li>Yoghurt</li><li>Mint</li></ul><footer>©</footer></body></html>',
    );
    expect(page.title).toBe('Borhani & more');
    expect(page.text).toBe('Borhani\nA spiced yoghurt drink.\n- Yoghurt\n- Mint');
    expect(htmlToText(`<p>${'a'.repeat(50)}</p>`, 10).text).toBe('aaaaaaaaaa…');
  });

  it('lists a search result only when the answer used it; a linked page always', () => {
    const found = {
      source: 'wikipedia',
      results: [
        { title: 'Borhani', url: 'https://en.wikipedia.org/wiki/Borhani', text: '' },
        {
          title: 'Taiwanese cuisine',
          url: 'https://en.wikipedia.org/wiki/Taiwanese_cuisine',
          text: '',
        },
      ],
    };
    const linked = {
      source: 'page',
      results: [{ title: 'Menu', url: 'https://x.example/m', text: '' }],
    };
    expect(webSourcesOf([found, linked], 'Borhani is a spiced yoghurt drink.')).toEqual([
      { title: 'Borhani', url: 'https://en.wikipedia.org/wiki/Borhani' },
      { title: 'Menu', url: 'https://x.example/m' },
    ]);
    expect(webSourcesOf([{ error: 'failed' }], 'anything')).toEqual([]);
  });

  it('decodes entities and finds a link in a question', () => {
    expect(decodeEntities('&lt;b&gt; &#2453; &#x9BE; &nbsp;x')).toBe('<b> ক া  x');
    expect(urlIn('read this https://example.com/menu?a=1 please')).toBe(
      'https://example.com/menu?a=1',
    );
    expect(urlIn('no link here')).toBeNull();
  });
});
