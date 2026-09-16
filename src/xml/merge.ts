import type {
  PSetDef,
  PSetFieldDef,
  ObjectDef,
  MemberDef,
  DataSheetFieldDef,
  RecordDef,
  RecordFieldDef,
} from "./model";

// 統合ポリシー: A(優先/FW製推奨)を常に採用し、Aに無い項目だけBで補う。
// 両方に存在し内容が異なる場合も A を採用するが、その旨(conflict)を記録して可視化する。
export type Source = "A" | "B";

// フィールド単位でA/B両方の値を保持する(ユーザーがどちらを採用するか選べるようにするため)。
export interface MergedField<T> {
  key: string;
  a?: T;
  b?: T;
  bothPresent: boolean;
  conflict: boolean;
}

function mergeFieldList<T>(a: T[], b: T[], keyFn: (x: T) => string): MergedField<T>[] {
  const aMap = new Map(a.map((x) => [keyFn(x), x]));
  const bMap = new Map(b.map((x) => [keyFn(x), x]));
  const keys = new Set([...aMap.keys(), ...bMap.keys()]);
  const out: MergedField<T>[] = [];
  for (const k of keys) {
    const av = aMap.get(k);
    const bv = bMap.get(k);
    const bothPresent = av !== undefined && bv !== undefined;
    const conflict = bothPresent && JSON.stringify(av) !== JSON.stringify(bv);
    out.push({ key: k, a: av, b: bv, bothPresent, conflict });
  }
  return out;
}

interface TopLevelMergeResult<T> {
  source: Source;
  bothPresent: boolean;
  conflict: boolean;
  value: T;
}

function mergeTopLevel<T extends { raw: string; el: Element }>(a: T | undefined, b: T | undefined): TopLevelMergeResult<T> {
  if (a !== undefined) {
    const bothPresent = b !== undefined;
    return { source: "A", bothPresent, conflict: bothPresent && a.raw !== b!.raw, value: a };
  }
  return { source: "B", bothPresent: false, conflict: false, value: b as T };
}

export interface MergedPSet {
  key: string;
  name: string;
  source: Source;
  bothPresent: boolean;
  conflict: boolean;
  fields: MergedField<PSetFieldDef>[];
  el: Element;
}

export function mergePSets(a: Map<string, PSetDef>, b: Map<string, PSetDef>): MergedPSet[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out: MergedPSet[] = [];
  for (const k of keys) {
    const av = a.get(k);
    const bv = b.get(k);
    const top = mergeTopLevel(av, bv);
    out.push({
      key: k,
      name: k,
      source: top.source,
      bothPresent: top.bothPresent,
      conflict: top.conflict,
      fields: mergeFieldList(av?.fields ?? [], bv?.fields ?? [], (f) => f.name),
      el: top.value.el,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

export interface MergedObject {
  key: string;
  objectName: string;
  objectLabel: string;
  isEnabled: string;
  mappingCategory: string;
  source: Source;
  bothPresent: boolean;
  conflict: boolean;
  members: MergedField<MemberDef>[];
  dataSheetFields: MergedField<DataSheetFieldDef & { dsName: string }>[];
  el: Element;
  /** 手動統合(オブジェクトの移動・統合)で作られた項目か。trueの場合、競合は常に統合元優先で自動解決される。 */
  isManualPair?: boolean;
}

function flattenDataSheets(o?: ObjectDef): (DataSheetFieldDef & { dsName: string })[] {
  return (o?.dataSheets ?? []).flatMap((ds) => ds.fields.map((f) => ({ ...f, dsName: ds.name })));
}

export function mergeObjects(a: Map<string, ObjectDef>, b: Map<string, ObjectDef>): MergedObject[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out: MergedObject[] = [];
  for (const k of keys) {
    const av = a.get(k);
    const bv = b.get(k);
    const top = mergeTopLevel(av, bv);
    out.push({
      key: k,
      objectName: top.value.objectName,
      objectLabel: top.value.objectLabel,
      isEnabled: top.value.isEnabled,
      mappingCategory: top.value.mappingCategory,
      source: top.source,
      bothPresent: top.bothPresent,
      conflict: top.conflict,
      members: mergeFieldList(av?.members ?? [], bv?.members ?? [], (m) => `${m.context}::${m.name}`),
      dataSheetFields: mergeFieldList(flattenDataSheets(av), flattenDataSheets(bv), (f) => `${f.dsName}::${f.label}::${f.sourceField}`),
      el: top.value.el,
    });
  }
  return out.sort((x, y) => x.objectName.localeCompare(y.objectName));
}

/**
 * 本来は自動対応しない(objectName+criteriaが一致しない)オブジェクト同士を、
 * ユーザーが手動で「統合元の設定を統合先に移動・統合する」。
 * 「統合先」(destObj)は名前・分類・書き出し時の土台(clone元要素)として使われ、
 * 「統合元」(srcObj)はそこに取り込まれる。統合元・統合先はA/Bどちらのファイルの
 * オブジェクトでもよい(同じファイル内の異なるオブジェクト同士でも可)。
 * 競合(両方にある同名フィールド)は常に統合元を優先して統合先を置き換える
 * (ユーザーによるA/B選択は発生しない)。
 */
export function mergeObjectPair(destObj: ObjectDef, srcObj: ObjectDef, pairKey: string): MergedObject {
  return {
    key: pairKey,
    objectName: destObj.objectName,
    objectLabel: destObj.objectLabel,
    isEnabled: destObj.isEnabled,
    mappingCategory: destObj.mappingCategory,
    source: "A",
    bothPresent: true,
    conflict: destObj.raw !== srcObj.raw,
    isManualPair: true,
    members: mergeFieldList(destObj.members, srcObj.members, (m) => `${m.context}::${m.name}`),
    dataSheetFields: mergeFieldList(flattenDataSheets(destObj), flattenDataSheets(srcObj), (f) => `${f.dsName}::${f.label}::${f.sourceField}`),
    el: destObj.el,
  };
}

export interface ManualPairing {
  srcSide: Source;
  srcKey: string;
  destSide: Source;
  destKey: string;
}

/** mergeObjectsに、手動ペアリングによる例外的な組み合わせを適用したバージョン。 */
export function mergeObjectsWithPairings(
  a: Map<string, ObjectDef>,
  b: Map<string, ObjectDef>,
  pairings: ManualPairing[],
): MergedObject[] {
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  for (const p of pairings) {
    (p.srcSide === "A" ? usedA : usedB).add(p.srcKey);
    (p.destSide === "A" ? usedA : usedB).add(p.destKey);
  }
  const filteredA = new Map([...a].filter(([k]) => !usedA.has(k)));
  const filteredB = new Map([...b].filter(([k]) => !usedB.has(k)));
  const out = mergeObjects(filteredA, filteredB);
  for (const p of pairings) {
    const srcObj = (p.srcSide === "A" ? a : b).get(p.srcKey);
    const destObj = (p.destSide === "A" ? a : b).get(p.destKey);
    if (destObj && srcObj) out.push(mergeObjectPair(destObj, srcObj, `pair::src:${p.srcSide}:${p.srcKey}=>dest:${p.destSide}:${p.destKey}`));
  }
  return out.sort((x, y) => x.objectName.localeCompare(y.objectName));
}

export interface MergedRecord {
  key: string;
  name: string;
  source: Source;
  bothPresent: boolean;
  conflict: boolean;
  fields: MergedField<RecordFieldDef>[];
  el: Element;
}

export function mergeRecords(a: Map<string, RecordDef>, b: Map<string, RecordDef>): MergedRecord[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out: MergedRecord[] = [];
  for (const k of keys) {
    const av = a.get(k);
    const bv = b.get(k);
    const top = mergeTopLevel(av, bv);
    out.push({
      key: k,
      name: k,
      source: top.source,
      bothPresent: top.bothPresent,
      conflict: top.conflict,
      fields: mergeFieldList(av?.fields ?? [], bv?.fields ?? [], (f) => f.fName),
      el: top.value.el,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
