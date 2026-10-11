/**
 * One grid, one CSV. A row of the map is a line of integers. 0 is empty.
 * Kids can change the numbers in the code view; the editor reads those numbers back.
 */

const CSV_CAP = 80_000;

export function writeGrid(cells: readonly number[], columns: number, rows: number): string | null {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) return null;
  if (cells.length !== columns * rows) return null;
  if (cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 9999)) return null;
  const lines: string[] = [];
  for (let y = 0; y < rows; y += 1) lines.push(cells.slice(y * columns, (y + 1) * columns).join(","));
  return `${lines.join("\n")}\n`;
}

/** Strict size: exactly `rows` lines, exactly `columns` integers, nothing else. */
export function readGrid(text: string, columns: number, rows: number, maxValue: number): number[] | null {
  if (typeof text !== "string" || text.length > CSV_CAP) return null;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) return null;
  if (!Number.isInteger(maxValue) || maxValue < 0) return null;
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== rows) return null;
  const cells: number[] = [];
  for (const line of lines) {
    if (!line) return null;
    const parts = line.split(",");
    if (parts.length !== columns) return null;
    for (const part of parts) {
      const token = part.trim();
      if (!/^\d+$/.test(token)) return null;
      const value = Number(token);
      if (!Number.isInteger(value) || value > maxValue) return null;
      cells.push(value);
    }
  }
  return cells;
}
