/**
 * Single choke point for every CSV-generation path in the app (bulk
 * "Export CSV", the import error report). NFR-4: a cell starting with
 * =, +, - or @ is prefixed with a leading apostrophe to neutralise
 * formula injection when the file is opened in a spreadsheet tool.
 */
const FORMULA_PREFIX_CHARS = ['=', '+', '-', '@'];

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let cell = String(value);

  if (FORMULA_PREFIX_CHARS.includes(cell[0])) {
    cell = `'${cell}`;
  }

  if (/[",\n\r]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }

  return cell;
}

/**
 * Builds a CSV string (header row + one row per record) from an array of
 * flat objects, in the given column order. Every cell goes through
 * escapeCsvCell -- callers never concatenate CSV by hand.
 */
export function toCsv<T extends object>(columns: { key: string; header: string }[], rows: T[]): string {
  const headerLine = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvCell((row as Record<string, unknown>)[c.key])).join(','),
  );
  return [headerLine, ...lines].join('\r\n');
}
