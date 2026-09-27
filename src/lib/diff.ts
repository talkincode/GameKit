export type DiffRow = { kind: "same" | "add" | "del"; text: string };

export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 250_000) {
    return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  }
  const scores = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      scores[i][j] = a[i] === b[j] ? scores[i + 1][j + 1] + 1 : Math.max(scores[i + 1][j], scores[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (scores[i + 1][j] >= scores[i][j + 1]) {
      rows.push({ kind: "del", text: a[i] });
      i += 1;
    } else {
      rows.push({ kind: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) rows.push({ kind: "del", text: a[i++] });
  while (j < b.length) rows.push({ kind: "add", text: b[j++] });
  return rows;
}
