import type {
  ParsedDataManager,
  PSetDef,
  ObjectDef,
  RecordDef,
  MemberDef,
  DataSheetDef,
  DataSheetFieldDef,
} from "./model";

// 要素を「タグ名 + ソート済み属性 + 子要素(順序保持)」の形に正規化してから
// JSON文字列化する。整形の揺れ(空白・属性順)に左右されずに内容の同一性を判定できる。
interface Canon {
  t: string;
  a: [string, string][];
  c: Canon[] | string;
}

function canonicalize(el: Element): Canon {
  const attrs = Array.from(el.attributes)
    .map((a) => [a.name, a.value] as [string, string])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const children = Array.from(el.children);
  if (children.length === 0) {
    return { t: el.tagName, a: attrs, c: (el.textContent ?? "").trim() };
  }
  return { t: el.tagName, a: attrs, c: children.map(canonicalize) };
}

function canonicalString(el: Element): string {
  return JSON.stringify(canonicalize(el));
}

function text(el: Element | null, selector: string): string {
  return el?.querySelector(selector)?.textContent?.trim() ?? "";
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? "";
}

export class XmlParseError extends Error {}

export function parseDataManagerXml(
  xmlText: string,
  sourceFileName: string,
): ParsedDataManager {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new XmlParseError(
      `XMLの解析に失敗しました(${sourceFileName}): ${parserError.textContent?.slice(0, 200)}`,
    );
  }
  const root = doc.documentElement;
  if (!root || root.tagName !== "IFC_DataMapping") {
    throw new XmlParseError(
      `想定外のルート要素です(${sourceFileName}): <${root?.tagName ?? "?"}> — Vectorworks の IFC Data Manager 書き出しXMLではない可能性があります。`,
    );
  }

  const psets = extractPSets(root);
  const objects = extractObjects(root);
  const records = extractRecords(root);

  const schemeEl = root.querySelector(":scope > Scheme");
  return {
    fileName: attr(root, "fileName"),
    sourceFileName,
    version: attr(root, "version"),
    ifcScheme: schemeEl?.getAttribute("IfcScheme") ?? "",
    customPSetsVersion: attr(root.querySelector(":scope > CustomPSets") ?? root, "version"),
    criteriaOrderEl: schemeEl?.querySelector(":scope > CriteriaOrder") ?? null,
    psets,
    objects,
    records,
  };
}

function extractPSets(root: Element): Map<string, PSetDef> {
  const map = new Map<string, PSetDef>();
  const container = root.querySelector(":scope > CustomPSets");
  if (!container) return map;
  for (const cp of Array.from(container.children)) {
    if (cp.tagName !== "CustomPSet") continue;
    const name = attr(cp, "name");
    const fields = Array.from(cp.children)
      .filter((f) => f.tagName === "Field")
      .map((f) => ({
        name: attr(f, "name"),
        dataType: text(f, "DataType"),
        unit: text(f, "Unit"),
        el: f,
      }));
    map.set(name, { name, enabled: attr(cp, "enabled"), fields, raw: canonicalString(cp), el: cp });
  }
  return map;
}

function extractObjects(root: Element): Map<string, ObjectDef> {
  const map = new Map<string, ObjectDef>();
  const scheme = root.querySelector(":scope > Scheme");
  if (!scheme) return map;
  for (const obj of Array.from(scheme.children)) {
    if (obj.tagName !== "Object") continue;
    const objectName = attr(obj, "objectName");
    const criteriaRaw = attr(obj, "criteria");
    const key = `${objectName}||${criteriaRaw}`;

    const members: MemberDef[] = Array.from(obj.querySelectorAll("Member")).map((m) => {
      const recordAncestor = m.closest("MappedRecord");
      const psetAncestor = m.closest("MappedPSet");
      const wrapperKind: "record" | "pset" | "direct" = recordAncestor ? "record" : psetAncestor ? "pset" : "direct";
      const context = recordAncestor ? attr(recordAncestor, "recordName") : psetAncestor ? attr(psetAncestor, "name") : "";
      return {
        context,
        wrapperKind,
        name: attr(m, "memberName"),
        isVisible: text(m, "IsVisible"),
        isEnabled: text(m, "IsEnabled"),
        isEmpty: text(m, "IsEmpty"),
        type: text(m, "Type"),
        dataSource: text(m, "DataSource"),
        el: m,
      };
    });

    const dataSheets: DataSheetDef[] = Array.from(obj.querySelectorAll("DataSheet")).map((ds) => {
      const fields: DataSheetFieldDef[] = Array.from(ds.querySelectorAll("Field")).map((f) => ({
        label: attr(f, "label"),
        type: attr(f, "type"),
        sourceParent: text(f, "SourceParentName"),
        sourceChild: text(f, "SourceChildName"),
        sourceField: text(f, "SourceFieldName"),
        hasMapping: text(f, "HasMapping"),
        isEnabled: text(f, "IsEnabled"),
        isVisible: text(f, "IsVisible"),
        el: f,
      }));
      return { name: attr(ds, "name"), version: attr(ds, "version"), fields };
    });

    map.set(key, {
      key,
      objectName,
      objectLabel: attr(obj, "objectLabel"),
      isEnabled: attr(obj, "isEnabled"),
      mappingCategory: attr(obj, "mappingCategory"),
      condition: attr(obj, "condition"),
      conditionSecondary: attr(obj, "conditionSecondary"),
      isChanged: attr(obj, "isChanged"),
      hasCriteria: criteriaRaw.length > 0,
      criteriaRaw,
      members,
      dataSheets,
      raw: canonicalString(obj),
      el: obj,
    });
  }
  return map;
}

function extractRecords(root: Element): Map<string, RecordDef> {
  const map = new Map<string, RecordDef>();
  const container = root.querySelector(":scope > RecData");
  if (!container) return map;
  for (const rec of Array.from(container.children)) {
    if (rec.tagName !== "Record") continue;
    const name = attr(rec, "recordName");
    const fields = Array.from(rec.children)
      .filter((f) => f.tagName === "RecordField")
      .map((f) => ({
        fName: attr(f, "fName"),
        fFieldStyle: attr(f, "fFieldStyle"),
        fNumClass: attr(f, "fNumClass"),
        fPrec: attr(f, "fPrec"),
        fValue: attr(f, "fValue"),
        popupValues: Array.from(f.querySelectorAll("RecPopUpValue")).map(
          (p) => attr(p, "popUpValueLocName"),
        ),
        el: f,
      }));
    map.set(name, { name, fields, raw: canonicalString(rec), el: rec });
  }
  return map;
}
