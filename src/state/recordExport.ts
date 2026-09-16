// RecData(独自レコード定義)の各レコードを書き出しXMLに含めるかどうかの選択状態。
// レコードはファイルによって内容が大きく異なるため、既定では含めない。
// 例外として「VBS」を含むレコード名(VWJ社の標準レコード)は、標準レコード設定を
// 引き継ぐ目的で既定でチェック(含める)にする。
// ユーザーが明示的に変更した場合のみ localStorage に上書きとして保存する。

const STORAGE_KEY = "dm_merge_tool.recordExport.v1";

export function defaultRecordIncluded(name: string): boolean {
  return name.includes("VBS");
}

export class RecordExportStore {
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

  isIncluded(key: string, name: string): boolean {
    return this.overrides.get(key) ?? defaultRecordIncluded(name);
  }

  setIncluded(key: string, name: string, included: boolean) {
    if (included === defaultRecordIncluded(name)) this.overrides.delete(key);
    else this.overrides.set(key, included);
    this.persist();
  }
}

export const recordExportStore = new RecordExportStore();
