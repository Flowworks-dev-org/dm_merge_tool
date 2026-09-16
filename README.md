# IFC Data Manager 統合ツール(dm_merge_tool)

Vectorworks の「データマネージャ」(IFCマッピング設定)から書き出したXMLを比較・統合するためのWebツール。

自社(Flowworks)テンプレートと VectorworksJapan(VWJ)提供テンプレート、双方の IFC Data Manager 設定XMLを取り込み、両者の差分を可視化し、将来的には統合ファイルの書き出しまでを行うことを目標とする。

## プライバシー / データの扱い

対象データ(自社の非公開テンプレートを含む)は**すべてブラウザ内(クライアントサイド)で処理**され、サーバーには一切送信されない。バックエンドを持たない静的サイトとして構築している。

## 現在のフェーズ

**Phase 1: 比較ビューア(実装済み)**

- 2つの `IFC_DataMapping` XML(Vectorworksのデータマネージャからの書き出しファイル)を読み込み
- 以下3種別について、名前をキーに突き合わせて差分を可視化
  - `CustomPSets`(IFCカスタムプロパティセット定義)
  - `Scheme > Object`(Vectorworksオブジェクト⇔IFC属性マッピング)
  - `RecData`(独自レコード定義)
- 各項目は「Aのみ / Bのみ / 共通・一致 / 共通・差分あり」に分類され、フィルタ・検索・詳細展開が可能

**Phase 2以降(未着手)**: 差分ごとにどちらを採用するか選択し、統合ファイル(XML)を書き出すマージ機能。

## データ構造メモ

- `criteria` 属性 / `DataSource` 要素には Vectorworks 独自のバイナリシリアライズ値(base64)が含まれる。これはデコードせず、値の一致判定にのみ使用する(要素単位でブロックごと扱うため、再エンコードの必要がない)。
- `Object` のキーは `objectName + criteria` の組み合わせ(criteria条件付きの同名オブジェクトが存在するため)。

## 開発

```bash
npm install
npm run dev
```

TypeScript + Vite のみで構成(ビルド成果物は静的ファイルなので GitHub Pages 等でホスト可能)。

```bash
npm run build   # dist/ に静的ファイルを出力
```
