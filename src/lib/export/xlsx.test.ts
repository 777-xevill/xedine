import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ordersSheets, vatSheets } from '@/modules/compliance/export-files';
import { buildXlsx, int, money, safeSheetName, txt } from './xlsx';

const files = (bytes: Uint8Array) =>
  Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));

describe('buildXlsx', () => {
  it('writes a real workbook: parts, header style, exact money and safe text', () => {
    const f = files(
      buildXlsx([
        {
          name: 'Sales: May?',
          widths: [20, 12],
          freezeRow: 1,
          filterRow: 1,
          rows: [
            [txt('Name', 'header'), txt('Amount', 'header')],
            [txt('=HYPERLINK("x")'), money(123456789)],
            [txt('a & b <c>'), int(5)],
          ],
        },
      ]),
    );
    expect(Object.keys(f)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
      ]),
    );
    expect(f['xl/workbook.xml']).toContain('name="Sales  May"');
    const sheet = f['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<v>1234567.89</v>'); // exact, no float
    expect(sheet).toContain(
      't="inlineStr"><is><t xml:space="preserve">=HYPERLINK("x")'.replace('"x"', '&quot;x&quot;'),
    );
    expect(sheet).not.toContain('<f>'); // nothing can run as a formula
    expect(sheet).toContain('a &amp; b &lt;c&gt;');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:B3"/>');
  });

  it('keeps sheet names inside Excel’s rules', () => {
    expect(safeSheetName('a/b:c*d?e[f]g'.padEnd(50, 'x'))).toHaveLength(31);
    expect(safeSheetName('   ')).toBe('Sheet');
  });
});

describe('the two files for the accountant', () => {
  const branchName = (id: unknown) => (id === 'b1' ? 'Uttara' : id === 'b2' ? 'Mirpur' : '');
  const common = {
    restaurant: 'Demo',
    from: '2026-10-01',
    to: '2026-10-31',
    preparedOn: '2026-11-01',
    branchName,
  };

  it('sales and VAT: a title, one row per branch, a total row, a plain note', () => {
    const [sheet] = vatSheets({
      ...common,
      lang: 'en',
      rows: [
        {
          branch_id: 'b1',
          vat_rate_bps: 750,
          price_includes_vat: true,
          orders: 10,
          net_poisha: 100000,
          vat_poisha: 7500,
          service_charge_poisha: 10000,
          total_poisha: 117500,
        },
        {
          branch_id: 'b2',
          vat_rate_bps: 1500,
          price_includes_vat: false,
          orders: 5,
          net_poisha: 50050,
          vat_poisha: 7508,
          service_charge_poisha: 0,
          total_poisha: 57558,
        },
      ],
    });
    const cells = sheet!.rows.map((r) => r.map((c) => c.value));
    expect(cells[0]![0]).toBe('Demo: sales and VAT');
    expect(cells[4]![0]).toBe('Branch');
    expect(cells[5]).toEqual(['Uttara', '7.5%', 'Yes', 10, 100000, 7500, 10000, 117500]);
    expect(cells[6]![1]).toBe('15%');
    const total = cells[7]!;
    expect(total).toEqual(['Total', '', '', 15, 150050, 15008, 10000, 175058]);
    expect(cells.flat().join(' ')).toContain('not a filed VAT return');
  });

  it('all orders: a summary of completed orders only, then every order in words', () => {
    const order = (o: Partial<Record<string, unknown>>) => ({
      branch_id: 'b1',
      business_date: '2026-10-05',
      placed_at: '2026-10-05T04:35:00Z',
      order_number: 7,
      order_status: 'completed',
      payment_status: 'paid',
      net_poisha: 1000,
      vat_poisha: 75,
      service_charge_poisha: 100,
      total_poisha: 1175,
      discount_net_poisha: 0,
      ...o,
    });
    const sheets = ordersSheets({
      ...common,
      lang: 'bn',
      rows: [
        order({}),
        order({ order_status: 'cancelled', payment_status: 'unpaid' }),
        order({ order_status: 'open', payment_status: 'unpaid' }),
      ],
    });
    expect(sheets.map((s) => s.name)).toEqual(['সারসংক্ষেপ', 'সব অর্ডার']);
    const sum = sheets[0]!.rows.map((r) => r.map((c) => c.value));
    expect(sum[5]).toEqual(['Uttara', 1, 1000, 75, 100, 1175, 1, 1]); // money from the completed one only
    const list = sheets[1]!.rows.map((r) => r.map((c) => c.value));
    expect(list).toHaveLength(4);
    expect(list[1]!.slice(0, 6)).toEqual([
      '2026-10-05',
      '10:35',
      'Uttara',
      7,
      'সম্পন্ন',
      'পরিশোধিত',
    ]);
    expect(sheets[1]!.freezeRow).toBe(1);
  });
});
