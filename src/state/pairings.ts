// 自動キー一致(objectName+criteria)では対応付けられないオブジェクト同士を、
// ユーザーが手動で「統合元の設定を統合先に移動・統合する」ためのペア設定。
// 統合元(移動するデータ)・統合先(移動先。名前や分類はそのまま)はそれぞれ独立して
// A/Bどちらのファイルからでも選べる(同じファイル内での統合元/統合先の指定も可)。
// 競合(両方にある同名フィールド)は常に統合元が優先され、統合先を上書きする
// (このペアリングに限り、A優先の通常ルールとは異なりユーザー選択は発生しない)。
// localStorageに自動保存する。

export type Side = "A" | "B";

export interface ObjectPairing {
  srcSide: Side; // 統合元がA/Bどちらのファイルの項目か
  srcKey: string;
  destSide: Side; // 統合先がA/Bどちらのファイルの項目か
  destKey: string;
}

const STORAGE_KEY = "dm_merge_tool.pairings.v2";

export class PairingStore {
  private pairings: ObjectPairing[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ObjectPairing[];
      if (Array.isArray(parsed)) {
        this.pairings = parsed.filter(
          (p) =>
            p &&
            (p.srcSide === "A" || p.srcSide === "B") &&
            (p.destSide === "A" || p.destSide === "B") &&
            typeof p.srcKey === "string" &&
            typeof p.destKey === "string",
        );
      }
    } catch {
      // 壊れたデータは無視
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pairings));
    } catch {
      // localStorageが使えない環境では保存をあきらめる
    }
  }

  list(): ObjectPairing[] {
    return [...this.pairings];
  }

  /** 指定した側(A/B)のファイルで、既にどれかのペアの統合元/統合先として使われているキー一覧。 */
  usedKeys(side: Side): Set<string> {
    const out = new Set<string>();
    for (const p of this.pairings) {
      if (p.srcSide === side) out.add(p.srcKey);
      if (p.destSide === side) out.add(p.destKey);
    }
    return out;
  }

  add(srcSide: Side, srcKey: string, destSide: Side, destKey: string) {
    const newUsed = new Set([`${srcSide}::${srcKey}`, `${destSide}::${destKey}`]);
    // どちらかのキーが既に別のペアで使われていたら、その古いペアは解除してから登録する
    this.pairings = this.pairings.filter((p) => {
      const used = [`${p.srcSide}::${p.srcKey}`, `${p.destSide}::${p.destKey}`];
      return !used.some((u) => newUsed.has(u));
    });
    this.pairings.push({ srcSide, srcKey, destSide, destKey });
    this.persist();
    this.notify();
  }

  remove(srcSide: Side, srcKey: string, destSide: Side, destKey: string) {
    this.pairings = this.pairings.filter((p) => !(p.srcSide === srcSide && p.srcKey === srcKey && p.destSide === destSide && p.destKey === destKey));
    this.persist();
    this.notify();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

export const pairingStore = new PairingStore();
