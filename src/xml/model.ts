// Vectorworks IFC Data Manager (IFC_DM) XML の型定義。
// バイナリの内部シリアライズ値(criteria / DataSource)はデコードせず、
// 「値そのもの」を等価判定にのみ使う不透明な文字列として保持する。
// 各要素は元のDOM要素(el)も保持する。書き出し時にこの要素をそのまま複製することで、
// Validationなど今のモデルに写し取っていない情報も含めて欠落なく再構築できる。

export interface PSetFieldDef {
  name: string;
  dataType: string;
  unit: string;
  el: Element;
}

export interface PSetDef {
  name: string;
  enabled: string;
  fields: PSetFieldDef[];
  raw: string;
  el: Element;
}

export interface MemberDef {
  context: string; // 所属する MappedRecord の recordName、またはMappedPSetのname。無ければ空文字
  wrapperKind: "record" | "pset" | "direct"; // contextが何のラッパーかを区別する(書き出し時にラッパーごと複製するため)
  name: string;
  isVisible: string;
  isEnabled: string;
  isEmpty: string;
  type: string;
  dataSource: string; // opaque
  el: Element;
}

export interface DataSheetFieldDef {
  label: string;
  type: string;
  sourceParent: string;
  sourceChild: string;
  sourceField: string;
  hasMapping: string;
  isEnabled: string;
  isVisible: string;
  el: Element;
}

export interface DataSheetDef {
  name: string;
  version: string;
  fields: DataSheetFieldDef[];
}

export interface ObjectDef {
  key: string; // objectName + '||' + criteria(opaque)
  objectName: string;
  objectLabel: string;
  isEnabled: string;
  mappingCategory: string;
  condition: string;
  conditionSecondary: string;
  isChanged: string;
  hasCriteria: boolean;
  criteriaRaw: string; // opaque
  members: MemberDef[];
  dataSheets: DataSheetDef[];
  raw: string;
  el: Element;
}

export interface RecordFieldDef {
  fName: string;
  fFieldStyle: string;
  fNumClass: string;
  fPrec: string;
  fValue: string;
  popupValues: string[];
  el: Element;
}

export interface RecordDef {
  name: string;
  fields: RecordFieldDef[];
  raw: string;
  el: Element;
}

export interface ParsedDataManager {
  fileName: string;
  sourceFileName: string;
  version: string;
  ifcScheme: string;
  customPSetsVersion: string;
  criteriaOrderEl: Element | null;
  psets: Map<string, PSetDef>;
  objects: Map<string, ObjectDef>;
  records: Map<string, RecordDef>;
}
