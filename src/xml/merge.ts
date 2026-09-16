import type {
  PSetDef,
  PSetFieldDef,
  ObjectDef,
  MemberDef,
  DataSheetFieldDef,
  RecordDef,
  RecordFieldDef,
} from "./model";
import { extractSingleObject } from "./extract";
import { buildObjectElement } from "./export";

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

/**
 * 同一ファイル内でのオブジェクト統合(srcSide === destSide)を実際に適用し、統合先のキーを
 * 更新後のObjectDefで置き換え、統合元のキーを取り除いた新しいMapを返す。
 * これにより、更新後のオブジェクトはこの後の通常の(もう片方のファイルとの)自動比較に
 * そのまま乗る = 競合があれば通常通りA/B選択できる(統合元優先の自動解決にはならない)。
 */
function resolveSameFileObjectPairing(objMap: Map<string, ObjectDef>, destKey: string, srcKey: string): Map<string, ObjectDef> {
  const destObj = objMap.get(destKey);
  const srcObj = objMap.get(srcKey);
  if (!destObj || !srcObj) return objMap;
  const merged = mergeObjectPair(destObj, srcObj, destObj.key);
  // 複製・差し替え処理を行うための一時ドキュメント(実際の書き出し先ではない)。
  const tempDoc = document.implementation.createDocument(null, "root", null);
  const consolidatedEl = buildObjectElement(tempDoc, merged);
  const updatedDef = extractSingleObject(consolidatedEl); // key は destObj.key と一致するはず(objectName/criteria属性は統合先のまま)
  const out = new Map(objMap);
  out.delete(srcKey);
  out.set(updatedDef.key, updatedDef);
  return out;
}

/** mergeObjectsに、手動ペアリングによる例外的な組み合わせを適用したバージョン。 */
export function mergeObjectsWithPairings(
  a: Map<string, ObjectDef>,
  b: Map<string, ObjectDef>,
  pairings: ManualPairing[],
): MergedObject[] {
  let workingA = a;
  let workingB = b;
  const crossFilePairings: ManualPairing[] = [];

  for (const p of pairings) {
    if (p.srcSide === p.destSide) {
      const target = p.destSide === "A" ? workingA : workingB;
      const updated = resolveSameFileObjectPairing(target, p.destKey, p.srcKey);
      if (p.destSide === "A") workingA = updated;
      else workingB = updated;
    } else {
      crossFilePairings.push(p);
    }
  }

  const usedA = new Set<string>();
  const usedB = new Set<string>();
  for (const p of crossFilePairings) {
    (p.srcSide === "A" ? usedA : usedB).add(p.srcKey);
    (p.destSide === "A" ? usedA : usedB).add(p.destKey);
  }
  const filteredA = new Map([...workingA].filter(([k]) => !usedA.has(k)));
  const filteredB = new Map([...workingB].filter(([k]) => !usedB.has(k)));
  const out = mergeObjects(filteredA, filteredB);
  for (const p of crossFilePairings) {
    const srcObj = (p.srcSide === "A" ? workingA : workingB).get(p.srcKey);
    const destObj = (p.destSide === "A" ? workingA : workingB).get(p.destKey);
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
