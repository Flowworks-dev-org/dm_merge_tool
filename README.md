# Vectorworks Data Manager 統合ツール(dm_merge_tool)

Vectorworks の「データマネージャ」(IFCマッピング設定)から書き出したXMLを比較・統合するためのWebツール。

自社(Flowworks)テンプレートと VectorworksJapan(VWJ)提供テンプレート、双方の IFC Data Manager 設定XMLを取り込み、差分を可視化し、統合結果をXMLとして書き出せる。

## プライバシー / データの扱い

対象データ(自社の非公開テンプレートを含む)は**すべてブラウザ内(クライアントサイド)で処理**され、サーバーには一切送信されない。バックエンドを持たない静的サイトとして構築している。

本リポジトリはツールのソースコードのみを公開しており、実際のデータマネージャ設定ファイル(社内テンプレート)は含まれていない。

## 機能

- 2つの `IFC_DataMapping` XML(Vectorworksのデータマネージャからの書き出しファイル)を読み込み、`CustomPSets` / `Scheme > Object` / `RecData` の差分を可視化
- Objectはmappingcategory(検索条件によるオブジェクト/IFCエンティティオブジェクト/パラメトリックオブジェクト/ゾーン/シンボル定義)ごとに区分表示
- 片方にしかない項目は自動採用、両方にあり内容が異なる項目のみ「競合」としてフィールド単位でA/B選択
- 選択状態はブラウザのlocalStorageに自動保存、JSONでエクスポート/インポート可能
- オブジェクトの手動統合: 名前が一致しない異なるオブジェクト同士(例: 自社の独自オブジェクトとVWJの標準オブジェクト)を手動でペアリングし、1項目として統合。競合は統合元を優先して自動解決
- 統合結果をVectorworksが読み込める `IFC_DataMapping` XMLとして書き出し(元のDOM要素を複製する方式で、Validationや内部バイナリ値も欠落なく引き継ぐ)

## データ構造メモ

- `criteria` 属性 / `DataSource` 要素には Vectorworks 独自のバイナリシリアライズ値(base64)が含まれる。これはデコードせず、値の一致判定・複製にのみ使用する。
- `Object` のキーは `objectName + criteria` の組み合わせ(criteria条件付きの同名オブジェクトが存在するため)。
- 1つのObjectには「IFCエンティティへのメインマッピング(`MappingForObject[type=Primary]`、Object直下)」と「Vectorworksデータセット側の属性マッピング(`VWMapping > MappingForObject`)」の2種類のスコープが存在しうる。書き出し時はこれを区別して正しい側に要素を挿入する。

## 開発

```bash
npm install
npm run dev
```

TypeScript + Vite のみで構成(ビルド成果物は静的ファイルなので GitHub Pages 等でホスト可能)。

```bash
npm run build   # dist/ に静的ファイルを出力
```
