// Vectorworks データマネージャの mappingCategory コード → 表示名。
// 実際にデータマネージャ画面で検索して確認済み(2026-09-16)。
export const MAPPING_CATEGORY_LABELS: Record<string, string> = {
  "1": "シンボル定義",
  "4": "IFCエンティティオブジェクト",
  "5": "検索条件によるオブジェクト",
  "6": "パラメトリックオブジェクト",
  "8": "ゾーン",
};

export function mappingCategoryLabel(code: string): string {
  return MAPPING_CATEGORY_LABELS[code] ?? (code ? `その他(未確認コード${code})` : "(分類なし)");
}
