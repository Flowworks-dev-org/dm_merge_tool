export type DiffStatus = "onlyA" | "onlyB" | "same" | "diff";

export interface DiffRow<T> {
  key: string;
  status: DiffStatus;
  a?: T;
  b?: T;
}

/** 名前(キー)をベースに2つのMapを比較する。等価判定は equal コールバックに委ねる。 */
export function diffMaps<T>(
  a: Map<string, T>,
  b: Map<string, T>,
  equal: (x: T, y: T) => boolean,
): DiffRow<T>[] {
  const rows: DiffRow<T>[] = [];
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (bv === undefined) rows.push({ key: k, status: "onlyA", a: av });
    else rows.push({ key: k, status: equal(av, bv) ? "same" : "diff", a: av, b: bv });
  }
  for (const [k, bv] of b) {
    if (!a.has(k)) rows.push({ key: k, status: "onlyB", b: bv });
  }
  return rows;
}

export function countByStatus<T>(rows: DiffRow<T>[]): Record<DiffStatus, number> {
  const c: Record<DiffStatus, number> = { onlyA: 0, onlyB: 0, same: 0, diff: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}
