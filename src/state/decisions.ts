// 競合(A/Bどちらを採用するか)のフィールド単位の決定を管理するストア。
// localStorageに自動保存し、JSONファイルとしてのエクスポート/インポートにも対応する。

export type Choice = "A" | "B";

const STORAGE_KEY = "dm_merge_tool.decisions.v1";

export class DecisionStore {
  private decisions = new Map<string, Choice>();
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, Choice>;
      this.decisions = new Map(Object.entries(obj));
    } catch {
      // 壊れたデータは無視して空の状態から始める
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.decisions)));
    } catch {
      // localStorageが使えない環境(プライベートモード等)では保存をあきらめる
    }
  }

  get(key: string): Choice | undefined {
    return this.decisions.get(key);
  }

  set(key: string, choice: Choice) {
    this.decisions.set(key, choice);
    this.persist();
    this.notify();
  }

  clear(key: string) {
    this.decisions.delete(key);
    this.persist();
    this.notify();
  }

  clearAll() {
    this.decisions.clear();
    this.persist();
    this.notify();
  }

  get size(): number {
    return this.decisions.size;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  exportJson(): string {
    return JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), decisions: Object.fromEntries(this.decisions) },
      null,
      2,
    );
  }

  importJson(text: string): number {
    const parsed = JSON.parse(text) as { decisions?: Record<string, Choice> };
    const entries = Object.entries(parsed.decisions ?? {});
    for (const [k, v] of entries) {
      if (v === "A" || v === "B") this.decisions.set(k, v);
    }
    this.persist();
    this.notify();
    return entries.length;
  }
}

export const decisionStore = new DecisionStore();
