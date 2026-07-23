/**
 * Spreadsheet reading with real header detection.
 *
 * The source files are hand-maintained: title rows above the header, blank
 * separator rows, "Columna 1..21" filler headers, numbers stored as text,
 * dates stored as text, duplicated column names. Nothing here guesses values —
 * it only locates the header row and hands back cells verbatim.
 */
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

export interface SheetData {
  sheetName: string;
  headerRow: number | null;
  headers: string[];
  /** 1-based worksheet row number -> raw values keyed by header. */
  rows: RawRow[];
  totalRows: number;
}

export interface RawRow {
  rowNumber: number;
  values: Record<string, string | null>;
  /** True when every mapped cell is empty. */
  isEmpty: boolean;
}

export interface WorkbookData {
  filename: string;
  byteSize: number;
  sha256: string;
  sheets: SheetData[];
}

export async function fileDigest(filePath: string): Promise<{ sha256: string; byteSize: number }> {
  const buffer = await readFile(filePath);
  const info = await stat(filePath);
  return { sha256: createHash('sha256').update(buffer).digest('hex'), byteSize: info.size };
}

/** Excel serial dates and real dates both arrive here; text is left untouched. */
export function cellToString(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    // Excel stores 25.780 litres as the number 25780; keep full precision and
    // let the caller decide how to parse. Trailing ".0" is noise from the
    // spreadsheet, not data.
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellToString(v.result as ExcelJS.CellValue);
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((r) => r.text).join('');
    }
    if ('hyperlink' in v && typeof v.hyperlink === 'string') return v.hyperlink;
    if ('error' in v) return null;
  }
  return String(value);
}

const FILLER_HEADER = /^columna\s*\d+$/i;

function isFillerHeader(h: string): boolean {
  return h === '' || FILLER_HEADER.test(h.trim());
}

/**
 * Finds the row that actually carries column names.
 *
 * Strategy: score the first `maxScan` rows by how many non-empty, non-filler,
 * distinct textual cells they hold, preferring earlier rows on a tie. A sheet
 * like "GUIES AGOST 24 - JULIOL 25" has its header on row 7 under a title and a
 * totals block — this finds it without hardcoding the number.
 */
export function detectHeaderRow(grid: (string | null)[][], maxScan = 15): number | null {
  let best: { row: number; score: number } | null = null;
  const scan = Math.min(grid.length, maxScan);
  for (let i = 0; i < scan; i += 1) {
    const cells = grid[i] ?? [];
    const labels = cells
      .map((c) => (c ?? '').trim())
      .filter((c) => c !== '' && !isFillerHeader(c));
    const distinct = new Set(labels.map((l) => l.toLowerCase()));
    const textual = labels.filter((l) => !/^-?[\d.,\s]+$/.test(l)).length;
    const score = distinct.size + textual;
    if (labels.length >= 3 && (best === null || score > best.score)) {
      best = { row: i + 1, score };
    }
  }
  return best?.row ?? null;
}

/** Makes headers unique and stable: "Email", "Email__2", ... */
export function uniqueHeaders(raw: (string | null)[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, idx) => {
    let name = (h ?? '').trim();
    if (isFillerHeader(name)) name = `col_${idx + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}__${count + 1}`;
  });
}

export interface ReadOptions {
  /** Force the header row instead of detecting it. */
  headerRow?: number;
  /** Sheets to skip entirely. */
  skipSheets?: string[];
}

export async function readWorkbook(filePath: string, options: ReadOptions = {}): Promise<WorkbookData> {
  const { sha256, byteSize } = await fileDigest(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: SheetData[] = [];
  for (const worksheet of workbook.worksheets) {
    if (options.skipSheets?.includes(worksheet.name)) continue;

    const grid: (string | null)[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values: (string | null)[] = [];
      const cellCount = Math.max(worksheet.columnCount, row.cellCount);
      for (let c = 1; c <= cellCount; c += 1) {
        values.push(cellToString(row.getCell(c).value));
      }
      grid[rowNumber - 1] = values;
    });

    const headerRow = options.headerRow ?? detectHeaderRow(grid);
    if (headerRow === null) {
      sheets.push({ sheetName: worksheet.name, headerRow: null, headers: [], rows: [], totalRows: grid.length });
      continue;
    }

    const headers = uniqueHeaders(grid[headerRow - 1] ?? []);
    const rows: RawRow[] = [];
    for (let i = headerRow; i < grid.length; i += 1) {
      const cells = grid[i];
      if (!cells) continue;
      const values: Record<string, string | null> = {};
      let empty = true;
      headers.forEach((header, idx) => {
        const raw = cells[idx];
        const value = raw === null || raw === undefined || raw.trim() === '' ? null : raw;
        values[header] = value;
        if (value !== null) empty = false;
      });
      rows.push({ rowNumber: i + 1, values, isEmpty: empty });
    }

    sheets.push({
      sheetName: worksheet.name,
      headerRow,
      headers,
      rows,
      totalRows: grid.length,
    });
  }

  return {
    filename: filePath.split('/').pop() ?? filePath,
    byteSize,
    sha256,
    sheets,
  };
}
