import { strToU8, zipSync } from 'fflate';
import { poishaToTakaText } from '@/lib/money';

/**
 * A small .xlsx writer for the files an owner shares with an accountant (ROADMAP Phase 10 export): real
 * Excel, so it opens tidy in Excel, Google Sheets and phones, with a styled header row, column widths,
 * taka in lakh grouping, a frozen header and filters. Text is written as inline strings, so a name starting
 * with = + - @ can never run as a formula. Money comes in as integer poisha and is written as an exact
 * decimal, never through floating-point maths (CLAUDE.md money rule).
 */

export type StyleName =
  | 'default'
  | 'header'
  | 'title'
  | 'note'
  | 'int'
  | 'money'
  | 'totalLabel'
  | 'totalInt'
  | 'totalMoney'
  | 'bold';

export interface Cell {
  /** Text, a whole number, or integer poisha when `poisha` is set. */
  value: string | number | null;
  poisha?: boolean;
  style?: StyleName;
}

export interface Sheet {
  name: string;
  /** Column widths in characters. */
  widths: number[];
  rows: Cell[][];
  /** Rows above and including this one stay in view when scrolling (the header row number, 1-based). */
  freezeRow?: number;
  /** Row number (1-based) of the header to put filter buttons on, spanning the used columns. */
  filterRow?: number;
}

export const txt = (value: string | null, style?: StyleName): Cell => ({ value, style });
export const int = (value: number, style: StyleName = 'int'): Cell => ({ value, style });
export const money = (poisha: number, style: StyleName = 'money'): Cell => ({
  value: poisha,
  poisha: true,
  style,
});

// Style index = position in cellXfs below.
const STYLE_INDEX: Record<StyleName, number> = {
  default: 0,
  header: 1,
  title: 2,
  note: 3,
  int: 4,
  money: 5,
  totalLabel: 6,
  totalInt: 7,
  totalMoney: 8,
  bold: 9,
};

/** Characters XML cannot hold (control codes other than tab, newline, return) are dropped. */
const xmlSafe = (s: string) =>
  Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c === 9 || c === 10 || c === 13 || c >= 32;
    })
    .join('');

const esc = (s: string) =>
  xmlSafe(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(cell: Cell, ref: string): string {
  const s = STYLE_INDEX[cell.style ?? 'default'];
  const style = s ? ` s="${s}"` : '';
  if (cell.value === null || cell.value === '') return style ? `<c r="${ref}"${style}/>` : '';
  if (typeof cell.value === 'number') {
    const v = cell.poisha ? poishaToTakaText(cell.value) : String(cell.value);
    return `<c r="${ref}"${style}><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((c, i) => cellXml(c, `${columnName(i)}${r + 1}`)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const used = Math.max(sheet.widths.length, ...sheet.rows.map((r) => r.length));
  const frozen = sheet.freezeRow
    ? `<pane ySplit="${sheet.freezeRow}" topLeftCell="A${sheet.freezeRow + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  const filter = sheet.filterRow
    ? `<autoFilter ref="A${sheet.filterRow}:${columnName(used - 1)}${sheet.rows.length}"/>`
    : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${frozen}</sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${rows}</sheetData>${filter}</worksheet>`
  );
}

// Lakh grouping (1,23,456.00) for taka; the same for whole numbers.
const MONEY_FORMAT = '[&gt;=10000000]##\\,##\\,##\\,##0.00;[&gt;=100000]##\\,##\\,##0.00;##,##0.00';
const INT_FORMAT = '[&gt;=10000000]##\\,##\\,##\\,##0;[&gt;=100000]##\\,##\\,##0;##,##0';

// Colours are ARGB. The header takes the brand navy; the totals row a light tint.
const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="${MONEY_FORMAT}"/><numFmt numFmtId="165" formatCode="${INT_FORMAT}"/></numFmts>` +
  `<fonts count="5">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="15"/><name val="Calibri"/></font>` +
  `<font><i/><sz val="10"/><color rgb="FF5B6275"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1B2440"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F8"/></patternFill></fill></fills>` +
  `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="thin"><color rgb="FFC9CFDC"/></bottom><diagonal/></border>` +
  `<border><left/><right/><top style="thin"><color rgb="FF1B2440"/></top><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="10">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="165" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="164" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Excel limits: a sheet name is at most 31 characters and cannot hold : \ / ? * [ ]. */
export function safeSheetName(name: string): string {
  return (
    name
      .replace(/[:\\/?*[\]]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet'
  );
}

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheets
          .map(
            (s, i) =>
              `<sheet name="${esc(safeSheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
