import { int, money, txt, type Cell, type Sheet } from '@/lib/export/xlsx';

/**
 * The two Excel files an owner shares with the accountant (ROADMAP Phase 10): sales and VAT, and every order.
 * Pure functions from data to sheets, so the layout is testable. Headings are plain words in English or
 * Bangla; money is in taka with lakh grouping.
 */

export type ExportLang = 'en' | 'bn';

const L = {
  en: {
    vatSheet: 'Sales and VAT',
    vatTitle: '{name}: sales and VAT',
    period: 'From {from} to {to}',
    prepared: 'Prepared on {date}',
    branch: 'Branch',
    vatRate: 'VAT rate',
    inclusive: 'Menu prices include VAT',
    yes: 'Yes',
    no: 'No',
    orders: 'Orders',
    net: 'Sales before VAT (৳)',
    vat: 'VAT (৳)',
    service: 'Service charge (৳)',
    total: 'Total collected (৳)',
    totalRow: 'Total',
    vatNote1:
      'Only completed orders are counted. This is a working summary from your orders, not a filed VAT return.',
    vatNote2: 'Please check the return format and the VAT rules with your accountant.',
    ordersSheet: 'All orders',
    date: 'Date',
    time: 'Time',
    orderNo: 'Order no.',
    status: 'Order status',
    payment: 'Payment',
    discount: 'Discount (৳)',
    status_: {
      open: 'Open',
      sent_to_kitchen: 'In the kitchen',
      preparing: 'Being cooked',
      ready: 'Ready',
      served: 'Served',
      completed: 'Completed',
      cancelled: 'Cancelled',
    } as Record<string, string>,
    pay_: {
      unpaid: 'Not paid',
      partially_paid: 'Part paid',
      paid: 'Paid',
      partially_refunded: 'Part refunded',
      refunded: 'Refunded',
    } as Record<string, string>,
  },
  bn: {
    vatSheet: 'বিক্রি ও ভ্যাট',
    vatTitle: '{name}: বিক্রি ও ভ্যাট',
    period: '{from} থেকে {to} পর্যন্ত',
    prepared: 'তৈরি: {date}',
    branch: 'শাখা',
    vatRate: 'ভ্যাটের হার',
    inclusive: 'মেনুর দামে ভ্যাট ধরা আছে',
    yes: 'হ্যাঁ',
    no: 'না',
    orders: 'অর্ডার',
    net: 'ভ্যাটের আগে বিক্রি (৳)',
    vat: 'ভ্যাট (৳)',
    service: 'সার্ভিস চার্জ (৳)',
    total: 'মোট আদায় (৳)',
    totalRow: 'মোট',
    vatNote1:
      'শুধু সম্পন্ন অর্ডার গোনা হয়েছে। এটি আপনার অর্ডার থেকে তৈরি একটি কাজের সারসংক্ষেপ, জমা দেওয়া ভ্যাট রিটার্ন নয়।',
    vatNote2: 'রিটার্নের ফরম্যাট আর ভ্যাটের নিয়ম আপনার হিসাবরক্ষকের সাথে মিলিয়ে নিন।',
    ordersSheet: 'সব অর্ডার',
    date: 'তারিখ',
    time: 'সময়',
    orderNo: 'অর্ডার নং',
    status: 'অর্ডারের অবস্থা',
    payment: 'পেমেন্ট',
    discount: 'ডিসকাউন্ট (৳)',
    status_: {
      open: 'খোলা',
      sent_to_kitchen: 'রান্নাঘরে',
      preparing: 'রান্না হচ্ছে',
      ready: 'তৈরি',
      served: 'পরিবেশিত',
      completed: 'সম্পন্ন',
      cancelled: 'বাতিল',
    } as Record<string, string>,
    pay_: {
      unpaid: 'পরিশোধ হয়নি',
      partially_paid: 'আংশিক পরিশোধ',
      paid: 'পরিশোধিত',
      partially_refunded: 'আংশিক ফেরত',
      refunded: 'ফেরত',
    } as Record<string, string>,
  },
} as const;

const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
const n = (v: unknown) => Number(v ?? 0);
const header = (labels: string[]): Cell[] => labels.map((x) => txt(x, 'header'));

export interface VatRow {
  branch_id: unknown;
  vat_rate_bps: unknown;
  price_includes_vat: unknown;
  orders: unknown;
  net_poisha: unknown;
  vat_poisha: unknown;
  service_charge_poisha: unknown;
  total_poisha: unknown;
}

export interface OrderRow {
  branch_id: unknown;
  business_date: unknown;
  placed_at: unknown;
  order_number: unknown;
  order_status: unknown;
  payment_status: unknown;
  net_poisha: unknown;
  vat_poisha: unknown;
  service_charge_poisha: unknown;
  total_poisha: unknown;
  discount_net_poisha: unknown;
}

/** 7.5% from 750 basis points, without trailing noise: 7.5%, 15%, 0%. */
const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

export function vatSheets(opts: {
  lang: ExportLang;
  restaurant: string;
  from: string;
  to: string;
  preparedOn: string;
  branchName: (id: unknown) => string;
  rows: VatRow[];
}): Sheet[] {
  const l = L[opts.lang];
  const sum = (k: keyof VatRow) => opts.rows.reduce((s, r) => s + n(r[k]), 0);
  const rows: Cell[][] = [
    [txt(fill(l.vatTitle, { name: opts.restaurant }), 'title')],
    [txt(fill(l.period, { from: opts.from, to: opts.to }), 'bold')],
    [txt(fill(l.prepared, { date: opts.preparedOn }), 'note')],
    [],
    header([l.branch, l.vatRate, l.inclusive, l.orders, l.net, l.vat, l.service, l.total]),
    ...opts.rows.map((r) => [
      txt(opts.branchName(r.branch_id)),
      txt(percent(n(r.vat_rate_bps))),
      txt(r.price_includes_vat ? l.yes : l.no),
      int(n(r.orders)),
      money(n(r.net_poisha)),
      money(n(r.vat_poisha)),
      money(n(r.service_charge_poisha)),
      money(n(r.total_poisha)),
    ]),
    [
      txt(l.totalRow, 'totalLabel'),
      txt('', 'totalLabel'),
      txt('', 'totalLabel'),
      int(sum('orders'), 'totalInt'),
      money(sum('net_poisha'), 'totalMoney'),
      money(sum('vat_poisha'), 'totalMoney'),
      money(sum('service_charge_poisha'), 'totalMoney'),
      money(sum('total_poisha'), 'totalMoney'),
    ],
    [],
    [txt(l.vatNote1, 'note')],
    [txt(l.vatNote2, 'note')],
  ];
  return [{ name: l.vatSheet, widths: [24, 12, 24, 10, 22, 16, 20, 20], rows }];
}

/** "10:35" in Bangladesh time from a timestamp. */
const dhakaTime = (iso: unknown) => {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
};

export function ordersSheets(opts: {
  lang: ExportLang;
  branchName: (id: unknown) => string;
  rows: OrderRow[];
}): Sheet[] {
  const l = L[opts.lang];
  // One row per bill and nothing else, so it can be filtered and checked line by line. The totals by
  // branch and VAT rate are in the other file (Sales and VAT).
  const list: Cell[][] = [
    header([
      l.date,
      l.time,
      l.branch,
      l.orderNo,
      l.status,
      l.payment,
      l.discount,
      l.net,
      l.vat,
      l.service,
      l.total,
    ]),
    ...opts.rows.map((r) => [
      txt(String(r.business_date ?? '')),
      txt(dhakaTime(r.placed_at)),
      txt(opts.branchName(r.branch_id)),
      r.order_number === null || r.order_number === undefined
        ? txt('')
        : int(n(r.order_number), 'default'),
      txt(l.status_[String(r.order_status)] ?? String(r.order_status ?? '')),
      txt(l.pay_[String(r.payment_status)] ?? String(r.payment_status ?? '')),
      money(n(r.discount_net_poisha)),
      money(n(r.net_poisha)),
      money(n(r.vat_poisha)),
      money(n(r.service_charge_poisha)),
      money(n(r.total_poisha)),
    ]),
  ];
  return [
    {
      name: l.ordersSheet,
      widths: [12, 8, 22, 10, 16, 16, 16, 22, 14, 18, 18],
      rows: list,
      freezeRow: 1,
      filterRow: 1,
    },
  ];
}
