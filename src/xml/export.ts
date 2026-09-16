import type { ParsedDataManager, MemberDef, DataSheetFieldDef } from "./model";
import type { MergedPSet, MergedObject, MergedRecord, MergedField } from "./merge";
import { decisionStore, type Choice } from "../state/decisions";

// 統合結果を IFC_DataMapping 形式のXMLとして書き出す。
//
// 方針: プレビュー用に取り出した値からXMLを組み立て直すのではなく、
// 「採用する側(基本はA)の元のDOM要素をまるごと複製し、Bを選んだ/Bにしかない
// フィールドだけBの元要素と差し替える・追加する」方式をとる。これにより Validation
// や内部バイナリ(criteria / DataSource)など、比較・プレビュー用のモデルには写し取って
// いない情報も欠落なく引き継げる。未決定の競合はA(優先側)を自動採用する。
//
// 「片方にしかない」項目は競合ではなく自動採用対象だが、書き出し時にそれを見落とすと
// (特にBにしかないMappedRecord/MappedPSet/DataSheetが丸ごと)欠落してしまうため、
// 競合フィールドだけでなく「Bにしかない」フィールド・ラッパーも明示的に扱う。

function resolvedChoice(key: string): Choice {
  return decisionStore.get(key) ?? "A";
}

/**
 * 競合なら選択(未決定はA)、片方にしか無ければ有る方を採用する。
 * forceB=true(手動統合オブジェクトの統合元)の場合は、決定を問わず競合は常にBを採用する。
 */
function shouldUseB<T>(f: MergedField<T>, decisionKey: string, forceB = false): boolean {
  if (!f.b) return false;
  if (f.conflict) return forceB || resolvedChoice(decisionKey) === "B";
  return f.a === undefined; // Bにしかない
}

function buildPSetElement(doc: Document, p: MergedPSet): Element {
  const clone = doc.importNode(p.el, true) as Element;
  for (const f of p.fields) {
    if (!shouldUseB(f, `psets::${p.key}::field::${f.key}`)) continue;
    const existing = Array.from(clone.children).find((c) => c.tagName === "Field" && c.getAttribute("name") === f.key);
    const replacement = doc.importNode(f.b!.el, true);
    if (existing) existing.replaceWith(replacement);
    else clone.appendChild(replacement);
  }
  return clone;
}

function buildRecordElement(doc: Document, r: MergedRecord): Element {
  const clone = doc.importNode(r.el, true) as Element;
  for (const f of r.fields) {
    if (!shouldUseB(f, `records::${r.key}::field::${f.key}`)) continue;
    const existing = Array.from(clone.children).find((c) => c.tagName === "RecordField" && c.getAttribute("fName") === f.key);
    const replacement = doc.importNode(f.b!.el, true);
    if (existing) existing.replaceWith(replacement);
    else clone.appendChild(replacement);
  }
  return clone;
}

// Vectorworksでは1つのObjectの中に、IFCエンティティへの「メイン」マッピング
// (<MappingForObject type="Primary">。Objectの直下)と、Vectorworksデータセット
// 側の属性マッピング(<VWMapping><MappingForObject>。VWMapping配下)が両方存在しうる。
// それぞれ独自の MembersForEntry / MappedRecord / MappedPSet を持つため、
// 「どちらのスコープに属するMemberか」を区別しないと、誤った側に挿入してしまう。
type MappingScope = "vwmapping" | "primary";

function classifyScope(el: Element): MappingScope {
  return el.closest("VWMapping") ? "vwmapping" : "primary";
}

/** クローン側で、指定スコープに対応する MappingForObject を探す。無ければBから骨組みごと複製する。 */
function findMappingForObjectInClone(doc: Document, clone: Element, scope: MappingScope, bReferenceEl: Element): Element | null {
  if (scope === "vwmapping") {
    const existing = clone.querySelector(":scope > VWMapping > MappingForObject");
    if (existing) return existing;
    const bMfo = bReferenceEl.closest("VWMapping > MappingForObject");
    const bVwMapping = bMfo?.parentElement;
    if (!bVwMapping) return null;
    const imported = doc.importNode(bVwMapping, true) as Element;
    clone.appendChild(imported);
    return imported.querySelector("MappingForObject");
  }
  const existing = clone.querySelector(':scope > MappingForObject[type="Primary"]');
  if (existing) return existing;
  const bMfo = bReferenceEl.closest('MappingForObject[type="Primary"]');
  if (!bMfo) return null;
  const imported = doc.importNode(bMfo, true) as Element;
  clone.appendChild(imported);
  return imported;
}

function findWrapperInMfo(mfo: Element, kind: "record" | "pset" | "direct", name: string): Element | null {
  if (kind === "direct") return mfo.querySelector(":scope > MembersForEntry");
  const tag = kind === "record" ? "MappedRecord" : "MappedPSet";
  const attrName = kind === "record" ? "recordName" : "name";
  return Array.from(mfo.querySelectorAll(`:scope > ${tag}`)).find((el) => el.getAttribute(attrName) === name) ?? null;
}

function buildObjectElement(doc: Document, o: MergedObject): Element {
  const clone = doc.importNode(o.el, true) as Element;
  // 手動統合(オブジェクトの移動・統合)で作られた項目は、競合を常に統合元優先で自動解決する。
  const forceB = !!o.isManualPair;

  // Memberを「スコープ(IFCメイン/Vectorworksデータセット) + ラッパー(MappedRecord/MappedPSet/直下)」
  // ごとにグループ化する。
  const memberGroups = new Map<
    string,
    { kind: "record" | "pset" | "direct"; scope: MappingScope; contextName: string; fields: MergedField<MemberDef>[] }
  >();
  for (const m of o.members) {
    const sample = (m.a ?? m.b) as MemberDef;
    const refEl = (m.a?.el ?? m.b?.el)!;
    const scope = classifyScope(refEl);
    const groupKey = `${scope}::${sample.context}`;
    if (!memberGroups.has(groupKey)) memberGroups.set(groupKey, { kind: sample.wrapperKind, scope, contextName: sample.context, fields: [] });
    memberGroups.get(groupKey)!.fields.push(m);
  }

  for (const group of memberGroups.values()) {
    const existsInA = group.fields.some((f) => f.a !== undefined);
    const existsInB = group.fields.some((f) => f.b !== undefined);
    const sampleBField = group.fields.find((f) => f.b);
    if (!sampleBField?.b) continue; // このグループにBの要素が一つも無ければ何もしない

    const mfo = findMappingForObjectInClone(doc, clone, group.scope, sampleBField.b.el);
    if (!mfo) continue;

    if (!existsInA && existsInB) {
      // ラッパーごとBにしか無い場合は、Bの元要素を丸ごと複製して挿入する。
      if (group.kind === "direct") {
        const mfe = mfo.querySelector(":scope > MembersForEntry");
        if (mfe) for (const f of group.fields) if (f.b) mfe.appendChild(doc.importNode(f.b.el, true));
      } else {
        const wrapperTag = group.kind === "record" ? "MappedRecord" : "MappedPSet";
        const wrapperEl = sampleBField.b.el.closest(wrapperTag);
        if (wrapperEl) mfo.appendChild(doc.importNode(wrapperEl, true));
      }
      continue;
    }

    // ラッパー自体は両方(またはAのみ)にある。フィールド単位で差し替え/追加する。
    const wrapper = findWrapperInMfo(mfo, group.kind, group.contextName);
    for (const m of group.fields) {
      if (!shouldUseB(m, `objects::${o.key}::member::${m.key}`, forceB)) continue;
      const bVal = m.b as MemberDef;
      const existing = wrapper
        ? Array.from(wrapper.querySelectorAll("Member")).find((el) => el.getAttribute("memberName") === bVal.name)
        : undefined;
      const replacement = doc.importNode(m.b!.el, true);
      if (existing) existing.replaceWith(replacement);
      else wrapper?.appendChild(replacement);
    }
  }

  // DataSheetもシート単位でグループ化し、同様に扱う。
  const dsGroups = new Map<string, MergedField<DataSheetFieldDef & { dsName: string }>[]>();
  for (const f of o.dataSheetFields) {
    const dsName = ((f.a ?? f.b) as DataSheetFieldDef & { dsName: string }).dsName;
    if (!dsGroups.has(dsName)) dsGroups.set(dsName, []);
    dsGroups.get(dsName)!.push(f);
  }
  for (const [dsName, fields] of dsGroups) {
    const existsInA = fields.some((f) => f.a !== undefined);
    const existsInB = fields.some((f) => f.b !== undefined);

    if (!existsInA && existsInB) {
      const sample = fields.find((f) => f.b);
      const bDsEl = sample?.b?.el.closest("DataSheet");
      const dataSheetsParent = clone.querySelector("DataSheets");
      if (bDsEl && dataSheetsParent) dataSheetsParent.appendChild(doc.importNode(bDsEl, true));
      continue;
    }

    const dsEl = Array.from(clone.querySelectorAll("DataSheet")).find((ds) => ds.getAttribute("name") === dsName);
    if (!dsEl) continue;
    for (const f of fields) {
      if (!shouldUseB(f, `objects::${o.key}::ds::${f.key}`, forceB)) continue;
      const bVal = f.b as DataSheetFieldDef & { dsName: string };
      const existing = Array.from(dsEl.querySelectorAll("Field")).find((fld) => {
        if (fld.getAttribute("label") !== bVal.label) return false;
        const sf = fld.querySelector("SourceFieldName")?.textContent?.trim() ?? "";
        return sf === bVal.sourceField;
      });
      const replacement = doc.importNode(f.b!.el, true);
      if (existing) existing.replaceWith(replacement);
      else dsEl.appendChild(replacement);
    }
  }

  return clone;
}

export interface ExportSummary {
  undecidedCount: number;
}

export function computeExportSummary(psets: MergedPSet[], objects: MergedObject[], records: MergedRecord[]): ExportSummary {
  let undecidedCount = 0;
  const countUndecided = (prefix: string, key: string, ns: string, fkey: string) => {
    if (!decisionStore.get(`${prefix}::${key}::${ns}::${fkey}`)) undecidedCount++;
  };
  for (const p of psets) for (const f of p.fields) if (f.conflict) countUndecided("psets", p.key, "field", f.key);
  for (const r of records) for (const f of r.fields) if (f.conflict) countUndecided("records", r.key, "field", f.key);
  for (const o of objects) {
    if (o.isManualPair) continue; // 手動統合は常に統合元優先で自動解決されるため未決定にはならない
    for (const m of o.members) if (m.conflict) countUndecided("objects", o.key, "member", m.key);
    for (const f of o.dataSheetFields) if (f.conflict) countUndecided("objects", o.key, "ds", f.key);
  }
  return { undecidedCount };
}

export function buildExportXml(
  a: ParsedDataManager,
  b: ParsedDataManager,
  psets: MergedPSet[],
  objects: MergedObject[],
  records: MergedRecord[],
): string {
  const doc = document.implementation.createDocument(null, "IFC_DataMapping", null);
  const root = doc.documentElement;
  root.setAttribute("fileName", `${a.fileName || b.fileName || "Merged"}_統合`);
  root.setAttribute("mappingFor", "File");
  root.setAttribute("version", a.version || b.version || "7");

  const customPSetsEl = doc.createElement("CustomPSets");
  customPSetsEl.setAttribute("version", a.customPSetsVersion || b.customPSetsVersion || "1");
  for (const p of psets) customPSetsEl.appendChild(buildPSetElement(doc, p));
  root.appendChild(customPSetsEl);

  const schemeEl = doc.createElement("Scheme");
  schemeEl.setAttribute("IfcScheme", a.ifcScheme || b.ifcScheme || "2x3");
  const criteriaOrderSrc = a.criteriaOrderEl ?? b.criteriaOrderEl;
  if (criteriaOrderSrc) schemeEl.appendChild(doc.importNode(criteriaOrderSrc, true));
  for (const o of objects) schemeEl.appendChild(buildObjectElement(doc, o));
  root.appendChild(schemeEl);

  const recDataEl = doc.createElement("RecData");
  for (const r of records) recDataEl.appendChild(buildRecordElement(doc, r));
  root.appendChild(recDataEl);

  const xml = new XMLSerializer().serializeToString(doc);
  return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n' + xml;
}
