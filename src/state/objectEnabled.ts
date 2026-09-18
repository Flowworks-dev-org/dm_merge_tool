// オブジェクト(Scheme > Object)の isEnabled(データマネージャの「適用」チェック)を
// このツール側で上書きするための選択状態。既定値は読み込んだA(無ければB)の設定を
// そのまま使う。ユーザーが明示的にチェックを変更した場合のみ localStorage に上書きを保存する。

const STORAGE_KEY = "dm_merge_tool.objectEnabled.v1";

export class ObjectEnabledStore {
  private overrides = new Map<string, boolean>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        this.overrides = new Map(Object.entries(parsed).filter(([, v]) => typeof v === "boolean"));
      }
    } catch {
      // 壊れたデータは無視
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.overrides)));
    } catch {
      // localStorageが使えない環境では保存をあきらめる
    }
  }

  isEnabled(key: string, defaultValue: boolean): boolean {
    return this.overrides.get(key) ?? defaultValue;
  }

  setEnabled(key: string, defaultValue: boolean, enabled: boolean) {
    if (enabled === defaultValue) this.overrides.delete(key);
    else this.overrides.set(key, enabled);
    this.persist();
  }
}

export const objectEnabledStore = new ObjectEnabledStore();
