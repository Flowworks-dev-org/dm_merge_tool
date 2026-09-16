import type { MergedPSet, MergedObject, MergedRecord, MergedField, Source } from "../xml/merge";
import { mergeObjectsWithPairings } from "../xml/merge";
import type { MemberDef, DataSheetFieldDef, PSetFieldDef, RecordFieldDef, ParsedDataManager, ObjectDef } from "../xml/model";
import { mappingCategoryLabel } from "../xml/category";
import { decisionStore, type Choice } from "../state/decisions";
import { pairingStore, type Side } from "../state/pairings";
import { buildExportXml, computeExportSummary } from "../xml/export";
import { escapeHtml, truncate } from "./util";

// ============ 汎用の「項目 > セクション > サブグループ > フィールド」構造 ============

interface FieldSection {
  sectionTitle: string;
  ns: string; // 決定キーの名前空間(member / ds / field)
  fieldLabel: (v: unknown) => string;
  valueText: (v: unknown) => string;
  subGroups: { title: string; fields: MergedField<unknown>[] }[];
}

interface PreviewItem {
  key: string;
  decisionPrefix: string;
  title: string;
  subtitle?: string;
  bothPresent: boolean;
  source: Source;
  sections: FieldSection[];
  /** 手動統合(オブジェクトの移動・統合)で作られた項目か。競合は常に統合元優先で自動解決され、選択UIは出さない。 */
  isManualPair?: boolean;
}

function groupBy<T>(items: T[], keyFn: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

// ============ 各カテゴリ → PreviewItem 変換 ============

function pSetFieldValueText(v: unknown): string {
  const f = v as PSetFieldDef;
  return `${f.dataType}${f.unit && f.unit !== "0" ? ` (Unit:${f.unit})` : ""}`;
}

function memberValueText(v: unknown): string {
  const m = v as MemberDef;
  return `visible=${m.isVisible} enabled=${m.isEnabled} empty=${m.isEmpty}${m.type ? ` type=${m.type}` : ""}`;
}

function dsFieldValueText(v: unknown): string {
  const f = v as DataSheetFieldDef;
  return `${f.sourceChild || "(なし)"}.${f.sourceField || "(なし)"} (mapped=${f.hasMapping})`;
}

function recordFieldValueText(v: unknown): string {
  const f = v as RecordFieldDef;
  return `style=${f.fFieldStyle} class=${f.fNumClass} prec=${f.fPrec}${f.fValue ? ` 既定値="${f.fValue}"` : ""}${f.popupValues.length ? ` 選択肢:[${f.popupValues.join(", ")}]` : ""}`;
}

function pSetToItem(p: MergedPSet): PreviewItem {
  return {
    key: p.key,
    decisionPrefix: `psets::${p.key}`,
    title: p.name,
    bothPresent: p.bothPresent,
    source: p.source,
    sections: [
      {
        sectionTitle: "フィールド",
        ns: "field",
        fieldLabel: (v) => (v as PSetFieldDef).name,
        valueText: pSetFieldValueText,
        subGroups: [{ title: "", fields: p.fields as MergedField<unknown>[] }],
      },
    ],
  };
}

function recordToItem(r: MergedRecord): PreviewItem {
  return {
    key: r.key,
    decisionPrefix: `records::${r.key}`,
    title: r.name,
    bothPresent: r.bothPresent,
    source: r.source,
    sections: [
      {
        sectionTitle: "フィールド",
        ns: "field",
        fieldLabel: (v) => (v as RecordFieldDef).fName,
        valueText: recordFieldValueText,
        subGroups: [{ title: "", fields: r.fields as MergedField<unknown>[] }],
      },
    ],
  };
}

function objectToItem(o: MergedObject): PreviewItem {
  const memberGroups = groupBy(o.members as MergedField<unknown>[], (m) => (((m.a ?? m.b) as MemberDef).context || "(オブジェクト直接属性)"));
  const dsGroups = groupBy(o.dataSheetFields as MergedField<unknown>[], (f) => ((f.a ?? f.b) as DataSheetFieldDef & { dsName: string }).dsName);
  return {
    key: o.key,
    decisionPrefix: `objects::${o.key}`,
    title: o.objectName,
    subtitle: o.objectLabel !== o.objectName ? o.objectLabel : undefined,
    bothPresent: o.bothPresent,
    source: o.source,
    isManualPair: o.isManualPair,
    sections: [
      {
        sectionTitle: "属性マッピング(Member)",
        ns: "member",
        fieldLabel: (v) => (v as MemberDef).name,
        valueText: memberValueText,
        subGroups: Array.from(memberGroups.entries()).map(([title, fields]) => ({ title, fields })),
      },
      {
        sectionTitle: "表示項目(DataSheet)",
        ns: "ds",
        fieldLabel: (v) => (v as DataSheetFieldDef).label || "(無題)",
        valueText: dsFieldValueText,
        subGroups: Array.from(dsGroups.entries()).map(([title, fields]) => ({ title, fields })),
      },
    ],
  };
}

// ============ 集計 ============

function itemFieldConflicts(item: PreviewItem): { key: string; field: MergedField<unknown> }[] {
  // 手動統合アイテムの競合は常に統合元優先で自動解決されるため、決定が必要な競合としては扱わない。
  if (item.isManualPair) return [];
  const out: { key: string; field: MergedField<unknown> }[] = [];
  for (const section of item.sections) {
    for (const g of section.subGroups) {
      for (const f of g.fields) {
        if (f.conflict) out.push({ key: `${item.decisionPrefix}::${section.ns}::${f.key}`, field: f });
      }
    }
  }
  return out;
}

function itemStats(item: PreviewItem): { conflictCount: number; undecidedCount: number } {
  const conflicts = itemFieldConflicts(item);
  const undecidedCount = conflicts.filter((c) => !decisionStore.get(c.key)).length;
  return { conflictCount: conflicts.length, undecidedCount };
}

function listStats(items: PreviewItem[]): { conflictCount: number; undecidedCount: number } {
  let conflictCount = 0;
  let undecidedCount = 0;
  for (const item of items) {
    const s = itemStats(item);
    conflictCount += s.conflictCount;
    undecidedCount += s.undecidedCount;
  }
  return { conflictCount, undecidedCount };
}

// ============ HTML片 ============

function badge(kind: string, label: string): string {
  return `<span class="badge badge-${kind}">${escapeHtml(label)}</span>`;
}

function onlyBadge(source: Source, isManualPair = false): string {
  if (isManualPair) return source === "A" ? badge("onlyA", "統合先のみ") : badge("onlyB", "統合元のみ");
  return source === "A" ? badge("onlyA", "Aのみ") : badge("onlyB", "Bのみ");
}

function itemBadgeHtml(item: PreviewItem): string {
  if (item.isManualPair) return badge("resolved", "統合済み(統合元優先)");
  if (!item.bothPresent) return onlyBadge(item.source);
  const { conflictCount, undecidedCount } = itemStats(item);
  if (conflictCount === 0) return badge("same", "一致");
  if (undecidedCount > 0) return badge("diff", `競合${conflictCount}・未決定${undecidedCount}`);
  return badge("resolved", `競合${conflictCount}・解決済み`);
}

function fieldRowHtml(item: PreviewItem, section: FieldSection, f: MergedField<unknown>): string {
  const label = escapeHtml(section.fieldLabel(f.a ?? f.b));
  if (!f.bothPresent) {
    const source: Source = f.a !== undefined ? "A" : "B";
    return `<tr><td>${label}</td><td colspan="2">${escapeHtml(section.valueText(f.a ?? f.b))}</td><td>${onlyBadge(source, item.isManualPair)}</td></tr>`;
  }
  if (!f.conflict) {
    return `<tr><td>${label}</td><td colspan="2">${escapeHtml(section.valueText(f.a))}</td><td>${badge("same", "一致")}</td></tr>`;
  }
  if (item.isManualPair) {
    // 手動統合は常に統合元優先で自動解決するため、選択UIは出さず結果のみ表示する。
    return `<tr class="auto-resolved-row">
      <td>${label}</td>
      <td colspan="2">
        統合元を採用: ${escapeHtml(section.valueText(f.b))}
        <span class="muted">(統合先の元の値: ${escapeHtml(section.valueText(f.a))})</span>
      </td>
      <td>${badge("resolved", "上書き")}</td>
    </tr>`;
  }
  const dKey = `${item.decisionPrefix}::${section.ns}::${f.key}`;
  const choice = decisionStore.get(dKey);
  return `<tr class="conflict-row" data-decision-key="${escapeHtml(dKey)}">
    <td>${label}</td>
    <td><button type="button" class="choice-btn${choice === "A" ? " selected" : ""}" data-choice="A">A: ${escapeHtml(section.valueText(f.a))}</button></td>
    <td><button type="button" class="choice-btn${choice === "B" ? " selected" : ""}" data-choice="B">B: ${escapeHtml(section.valueText(f.b))}</button></td>
    <td class="status-cell">${choice ? badge("resolved", "選択済み") : badge("diff", "未選択")}</td>
  </tr>`;
}

function statusBadgesFromCounts(
  onlyA: number,
  onlyB: number,
  same: number,
  conflict: number,
  undecidedCount: number,
  isManualPair = false,
): string {
  const parts: string[] = [];
  if (onlyA) parts.push(badge("onlyA", `${isManualPair ? "統合先のみ" : "Aのみ"}${onlyA}`));
  if (onlyB) parts.push(badge("onlyB", `${isManualPair ? "統合元のみ" : "Bのみ"}${onlyB}`));
  if (same) parts.push(badge("same", `一致${same}`));
  if (conflict) {
    if (isManualPair) parts.push(badge("resolved", `上書き${conflict}`));
    else parts.push(undecidedCount > 0 ? badge("diff", `競合${conflict}・未決定${undecidedCount}`) : badge("resolved", `競合${conflict}・解決済み`));
  }
  return parts.join("");
}

function subGroupBadgesHtml(item: PreviewItem, section: FieldSection, fields: MergedField<unknown>[]): string {
  let onlyA = 0;
  let onlyB = 0;
  let same = 0;
  let conflict = 0;
  let undecidedCount = 0;
  for (const f of fields) {
    if (!f.bothPresent) {
      if (f.a !== undefined) onlyA++;
      else onlyB++;
    } else if (!f.conflict) {
      same++;
    } else {
      conflict++;
      if (!item.isManualPair && !decisionStore.get(`${item.decisionPrefix}::${section.ns}::${f.key}`)) undecidedCount++;
    }
  }
  return statusBadgesFromCounts(onlyA, onlyB, same, conflict, undecidedCount, item.isManualPair);
}

/** DOM上の行(td最終列のバッジ文言)から内訳を数え直す。選択操作後にツリーの見出しバッジを更新するため。 */
function recountSubGroupBadgesFromDom(treeNode: HTMLElement): string {
  const rows = Array.from(treeNode.querySelectorAll("tbody tr"));
  let onlyA = 0;
  let onlyB = 0;
  let same = 0;
  let conflict = 0;
  let undecidedCount = 0;
  for (const r of rows) {
    const statusText = r.querySelector(".status-cell, td:last-child")?.textContent ?? "";
    if (r.classList.contains("conflict-row")) {
      conflict++;
      if (statusText.includes("未選択")) undecidedCount++;
    } else if (statusText.includes("Aのみ")) onlyA++;
    else if (statusText.includes("Bのみ")) onlyB++;
    else if (statusText.includes("一致")) same++;
  }
  return statusBadgesFromCounts(onlyA, onlyB, same, conflict, undecidedCount);
}

function subGroupHtml(item: PreviewItem, section: FieldSection, g: { title: string; fields: MergedField<unknown>[] }): string {
  const rows = g.fields.map((f) => fieldRowHtml(item, section, f)).join("");
  const table = `<table class="detail-table conflict-table"><thead><tr><th>フィールド名</th><th>A案</th><th>B案</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table>`;
  if (!g.title) return table;
  return `<details class="tree-node"><summary><span class="tree-title">${escapeHtml(g.title)}</span><span class="muted count-label">(${g.fields.length}件)</span><span class="tree-badges">${subGroupBadgesHtml(item, section, g.fields)}</span></summary>${table}</details>`;
}

function sectionHtml(item: PreviewItem, section: FieldSection): string {
  const body = section.subGroups.length ? section.subGroups.map((g) => subGroupHtml(item, section, g)).join("") : `<p class="muted">なし</p>`;
  return `<h4>${escapeHtml(section.sectionTitle)}</h4>${body}`;
}

function bulkToolbarHtml(item: PreviewItem): string {
  const conflictCount = itemFieldConflicts(item).length;
  if (conflictCount === 0) return "";
  return `<div class="bulk-toolbar">
    <span class="muted">この項目の競合(${conflictCount}件)を一括設定:</span>
    <button type="button" class="filter-btn bulk-btn" data-bulk="A">すべてA</button>
    <button type="button" class="filter-btn bulk-btn" data-bulk="B">すべてB</button>
    <button type="button" class="filter-btn bulk-btn" data-bulk="clear">未選択に戻す</button>
  </div>`;
}

function itemContentHtml(item: PreviewItem): string {
  return bulkToolbarHtml(item) + item.sections.map((s) => sectionHtml(item, s)).join("");
}

// ============ 項目トグルDOM ============

function renderItemToggle(item: PreviewItem, onDecisionChange: () => void): HTMLElement {
  const details = document.createElement("details");
  details.className = "item-toggle";

  const summary = document.createElement("summary");
  summary.innerHTML = `<span class="row-label">${escapeHtml(truncate(item.title, 70))}</span>${item.subtitle ? `<span class="row-sublabel">${escapeHtml(item.subtitle)}</span>` : ""}<span class="item-badge">${itemBadgeHtml(item)}</span>`;
  details.appendChild(summary);

  const content = document.createElement("div");
  content.className = "item-content";
  details.appendChild(content);

  let hydrated = false;
  details.addEventListener("toggle", () => {
    if (!details.open || hydrated) return;
    content.innerHTML = itemContentHtml(item);
    hydrated = true;

    content.addEventListener("click", (e) => {
      const bulkBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".bulk-btn");
      if (bulkBtn) {
        const mode = bulkBtn.dataset.bulk as "A" | "B" | "clear";
        for (const c of itemFieldConflicts(item)) {
          if (mode === "clear") decisionStore.clear(c.key);
          else decisionStore.set(c.key, mode);
        }
        content.innerHTML = itemContentHtml(item);
        summary.querySelector(".item-badge")!.innerHTML = itemBadgeHtml(item);
        onDecisionChange();
        return;
      }
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".choice-btn");
      if (!btn) return;
      const row = btn.closest<HTMLElement>(".conflict-row")!;
      const key = row.dataset.decisionKey!;
      const choice = btn.dataset.choice as Choice;
      decisionStore.set(key, choice);
      row.querySelectorAll<HTMLButtonElement>(".choice-btn").forEach((b) => b.classList.toggle("selected", b.dataset.choice === choice));
      row.querySelector(".status-cell")!.innerHTML = badge("resolved", "選択済み");
      const treeNode = row.closest<HTMLElement>(".tree-node");
      const badgesEl = treeNode?.querySelector(".tree-badges");
      if (treeNode && badgesEl) badgesEl.innerHTML = recountSubGroupBadgesFromDom(treeNode);
      summary.querySelector(".item-badge")!.innerHTML = itemBadgeHtml(item);
      onDecisionChange();
    });
  });

  return details;
}

// ============ 一覧パネル(検索付きトグルリスト) ============

function renderItemListPanel(items: PreviewItem[], onDecisionChange: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "preview-list-panel";
  wrap.innerHTML = `
    <input type="search" class="search-box" placeholder="名前で絞り込み…" />
    <div class="bulk-toolbar" data-role="tab-bulk-toolbar"></div>
  `;
  const tabBulkToolbarEl = wrap.querySelector<HTMLElement>('[data-role="tab-bulk-toolbar"]')!;
  const listEl = document.createElement("div");
  listEl.className = "toggle-list";
  wrap.appendChild(listEl);

  let currentFiltered: PreviewItem[] = items;

  function render(filterText: string) {
    currentFiltered = filterText ? items.filter((it) => (it.title + " " + (it.subtitle ?? "")).toLowerCase().includes(filterText)) : items;

    const conflictTotal = currentFiltered.reduce((n, it) => n + itemFieldConflicts(it).length, 0);
    tabBulkToolbarEl.hidden = conflictTotal === 0;
    tabBulkToolbarEl.innerHTML = conflictTotal
      ? `<span class="muted">表示中の項目の競合(${conflictTotal}件)をまとめて設定:</span>
         <button type="button" class="filter-btn bulk-btn" data-bulk="A">すべてA</button>
         <button type="button" class="filter-btn bulk-btn" data-bulk="B">すべてB</button>
         <button type="button" class="filter-btn bulk-btn" data-bulk="clear">未選択に戻す</button>`
      : "";

    listEl.innerHTML = "";
    if (currentFiltered.length === 0) {
      listEl.innerHTML = `<p class="muted empty-msg">該当する項目はありません。</p>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of currentFiltered) frag.appendChild(renderItemToggle(item, onDecisionChange));
    listEl.appendChild(frag);
  }

  tabBulkToolbarEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".bulk-btn");
    if (!btn) return;
    const mode = btn.dataset.bulk as "A" | "B" | "clear";
    for (const item of currentFiltered) {
      for (const c of itemFieldConflicts(item)) {
        if (mode === "clear") decisionStore.clear(c.key);
        else decisionStore.set(c.key, mode);
      }
    }
    const searchValue = wrap.querySelector<HTMLInputElement>(".search-box")!.value.trim().toLowerCase();
    render(searchValue);
    onDecisionChange();
  });

  wrap.querySelector<HTMLInputElement>(".search-box")!.addEventListener("input", (e) => {
    render((e.target as HTMLInputElement).value.trim().toLowerCase());
  });
  render("");
  return wrap;
}

// ============ サブタブ(区分)構成 ============

interface SubTabDef {
  id: string;
  label: string;
  items: PreviewItem[];
}

function buildSubTabs(psets: MergedPSet[], objects: MergedObject[], records: MergedRecord[]): SubTabDef[] {
  const objectsByCategory = groupBy(objects, (o) => o.mappingCategory);
  const categoryOrder = ["5", "4", "6", "8", "1"];
  const presentCodes = Array.from(objectsByCategory.keys());
  const orderedCodes = [...categoryOrder.filter((c) => presentCodes.includes(c)), ...presentCodes.filter((c) => !categoryOrder.includes(c)).sort()];

  const tabs: SubTabDef[] = [{ id: "psets", label: "CustomPSets", items: psets.map(pSetToItem) }];
  for (const code of orderedCodes) {
    tabs.push({
      id: `cat-${code}`,
      label: mappingCategoryLabel(code),
      items: objectsByCategory.get(code)!.map(objectToItem),
    });
  }
  tabs.push({ id: "records", label: "RecData", items: records.map(recordToItem) });
  return tabs;
}

// ============ 手動統合(オブジェクトの手動ペアリング) ============

function objectLabelText(o: ObjectDef): string {
  const label = o.objectLabel && o.objectLabel !== o.objectName ? `${o.objectLabel} — ${o.objectName}` : o.objectName;
  return truncate(label, 60);
}

function sideBadge(side: Side): string {
  return side === "A" ? `<span class="badge badge-onlyA">A</span>` : `<span class="badge badge-onlyB">B</span>`;
}

function pairingListHtml(a: ParsedDataManager, b: ParsedDataManager): string {
  const pairings = pairingStore.list();
  if (pairings.length === 0) return `<p class="muted">まだオブジェクトの統合はありません。</p>`;
  return `<ul class="pairing-list">${pairings
    .map((p) => {
      const srcMap = p.srcSide === "A" ? a.objects : b.objects;
      const destMap = p.destSide === "A" ? a.objects : b.objects;
      const srcObj = srcMap.get(p.srcKey);
      const destObj = destMap.get(p.destKey);
      const srcLabel = srcObj ? objectLabelText(srcObj) : `(不明: ${p.srcKey})`;
      const destLabel = destObj ? objectLabelText(destObj) : `(不明: ${p.destKey})`;
      return `<li>
        <span class="muted">統合元</span> ${sideBadge(p.srcSide)} ${escapeHtml(srcLabel)}
        <span class="pairing-arrow">→</span>
        <span class="muted">統合先</span> ${sideBadge(p.destSide)} ${escapeHtml(destLabel)}
        <button type="button" class="filter-btn pairing-remove-btn" data-src-side="${p.srcSide}" data-src-key="${escapeHtml(p.srcKey)}" data-dest-side="${p.destSide}" data-dest-key="${escapeHtml(p.destKey)}">解除</button>
      </li>`;
    })
    .join("")}</ul>`;
}

interface PickerEntry {
  key: string;
  label: string;
}

interface ObjectPickerHandle {
  el: HTMLElement;
  getSelected(): PickerEntry | null;
  reset(): void;
  updateEntries(entries: PickerEntry[]): void;
}

/** 検索しながら1件選べる、軽量なオートコンプリート入力。 */
function createObjectPicker(placeholder: string): ObjectPickerHandle {
  const wrap = document.createElement("div");
  wrap.className = "pair-picker";
  wrap.innerHTML = `
    <input type="text" class="search-box" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
    <div class="pair-suggestions" hidden></div>
  `;
  const input = wrap.querySelector<HTMLInputElement>("input")!;
  const suggestionsEl = wrap.querySelector<HTMLElement>(".pair-suggestions")!;
  let entries: PickerEntry[] = [];
  let selected: PickerEntry | null = null;

  function renderSuggestions() {
    const q = input.value.trim().toLowerCase();
    const filtered = (q ? entries.filter((e) => e.label.toLowerCase().includes(q)) : entries).slice(0, 30);
    suggestionsEl.innerHTML = filtered.length
      ? filtered.map((e) => `<button type="button" class="pair-suggestion-item" data-key="${escapeHtml(e.key)}">${escapeHtml(e.label)}</button>`).join("")
      : `<div class="pair-suggestion-empty muted">該当なし(候補${entries.length}件)</div>`;
    suggestionsEl.hidden = false;
  }

  input.addEventListener("focus", renderSuggestions);
  input.addEventListener("input", () => {
    selected = null;
    renderSuggestions();
  });
  input.addEventListener("blur", () => {
    // 候補クリックのmousedownが先に発火するよう、閉じるのを少し遅らせる
    setTimeout(() => {
      suggestionsEl.hidden = true;
    }, 150);
  });
  suggestionsEl.addEventListener("mousedown", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".pair-suggestion-item");
    if (!btn) return;
    selected = entries.find((en) => en.key === btn.dataset.key) ?? null;
    input.value = btn.textContent ?? "";
    suggestionsEl.hidden = true;
  });

  return {
    el: wrap,
    getSelected: () => selected,
    reset: () => {
      input.value = "";
      selected = null;
      suggestionsEl.hidden = true;
    },
    updateEntries: (newEntries) => {
      entries = newEntries;
    },
  };
}

// ============ エクスポート/インポート ============

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // click() 直後に revoke すると一部ブラウザでダウンロードが失敗し再試行されることがあるため、
  // ダウンロード処理が始まった後に解放する。
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ============ メイン ============

export function renderMergePreviewTab(
  a: ParsedDataManager,
  b: ParsedDataManager,
  psets: MergedPSet[],
  records: MergedRecord[],
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "tab-panel merge-preview";

  let objects: MergedObject[] = mergeObjectsWithPairings(a.objects, b.objects, pairingStore.list());
  let subTabs: SubTabDef[] = buildSubTabs(psets, objects, records);

  panel.innerHTML = `
    <p class="muted note">
      採用ルール: 片方にしか無いセット/フィールドはそのまま採用します(A/Bを表示するのみ)。両方にあり内容が異なる場合のみ「競合」として、A案・B案のどちらを採用するか選択してください。
      選択内容はこのブラウザに自動保存されます。
    </p>
    <details class="pairing-panel">
      <summary>オブジェクトの統合(オブジェクトの設定を異なるオブジェクトに移動・統合)</summary>
      <p class="muted" style="margin:6px 0 10px;">
        例: Bの「スペース」の設定を、Aの独自オブジェクトに移動・統合できます(名前が一致していなくても可)。
        統合元(移動するデータ側)はA/Bを選んで検索します。統合先(移動される側)はA/B問わず、全オブジェクトから検索して選べます。
        統合元と統合先の両方にある同名フィールドは、常に統合元が優先されて統合先を置き換えます。
      </p>
      <div class="pairing-controls">
        <div class="pair-slot">
          <label class="pair-slot-label">
            統合元
            <select data-role="src-side-select">
              <option value="A">A</option>
              <option value="B" selected>B</option>
            </select>
          </label>
          <div data-role="src-picker-mount"></div>
        </div>
        <span class="pairing-arrow">→</span>
        <div class="pair-slot">
          <label class="pair-slot-label">統合先</label>
          <div data-role="dest-picker-mount"></div>
        </div>
        <button type="button" class="filter-btn primary-btn" data-role="pair-add-btn">統合する</button>
      </div>
      <div data-role="pairing-list"></div>
    </details>
    <div class="global-toolbar">
      <span class="muted" data-role="global-stats"></span>
      <div class="toolbar-actions">
        <button type="button" class="filter-btn primary-btn" data-role="export-xml-btn">統合XMLを書き出す</button>
        <button type="button" class="filter-btn" data-role="export-btn">選択状態をエクスポート(JSON)</button>
        <button type="button" class="filter-btn" data-role="import-btn">インポート…</button>
        <button type="button" class="filter-btn" data-role="reset-btn">全選択をリセット</button>
        <input type="file" accept=".json" data-role="import-file" hidden />
      </div>
    </div>
    <div class="sub-tabs" data-role="sub-tabs"></div>
    <div data-role="sub-panels"></div>
  `;

  const subTabsEl = panel.querySelector<HTMLElement>('[data-role="sub-tabs"]')!;
  const subPanelsEl = panel.querySelector<HTMLElement>('[data-role="sub-panels"]')!;
  const globalStatsEl = panel.querySelector<HTMLElement>('[data-role="global-stats"]')!;
  const exportXmlBtnEl = panel.querySelector<HTMLButtonElement>('[data-role="export-xml-btn"]')!;
  const srcSideSelectEl = panel.querySelector<HTMLSelectElement>('[data-role="src-side-select"]')!;
  const pairingListEl = panel.querySelector<HTMLElement>('[data-role="pairing-list"]')!;
  const destPicker = createObjectPicker("統合先のオブジェクトを検索…");
  const srcPicker = createObjectPicker("統合元のオブジェクトを検索…");
  panel.querySelector('[data-role="dest-picker-mount"]')!.appendChild(destPicker.el);
  panel.querySelector('[data-role="src-picker-mount"]')!.appendChild(srcPicker.el);

  let tabButtons = new Map<string, HTMLButtonElement>();
  let tabPanels = new Map<string, HTMLElement>();

  function refreshTabButton(tab: SubTabDef) {
    const { conflictCount, undecidedCount } = listStats(tab.items);
    const btn = tabButtons.get(tab.id)!;
    const undecidedClass = undecidedCount === 0 ? "tab-count-done" : "tab-count-undecided";
    btn.innerHTML = `${escapeHtml(tab.label)} <span class="tab-count" title="競合件数">${conflictCount}</span><span class="tab-count ${undecidedClass}" title="未決定件数">${undecidedCount}</span>`;
    refreshGlobalStats();
  }

  function refreshGlobalStats() {
    const totals = subTabs.reduce(
      (acc, t) => {
        const s = listStats(t.items);
        acc.conflict += s.conflictCount;
        acc.undecided += s.undecidedCount;
        return acc;
      },
      { conflict: 0, undecided: 0 },
    );
    globalStatsEl.textContent = `全体: 競合 ${totals.conflict}件 / 未決定 ${totals.undecided}件 / 選択保存済み ${decisionStore.size}件`;
    exportXmlBtnEl.disabled = totals.undecided > 0;
    exportXmlBtnEl.title = totals.undecided > 0 ? `未決定の競合が${totals.undecided}件あるため書き出せません` : "";
  }

  function objectsForSide(side: Side): Map<string, ObjectDef> {
    return side === "A" ? a.objects : b.objects;
  }

  function sideKeyEntries(side: Side): PickerEntry[] {
    const used = pairingStore.usedKeys(side);
    return Array.from(objectsForSide(side).values())
      .filter((o) => !used.has(o.key))
      .map((o) => ({ key: o.key, label: objectLabelText(o) }));
  }

  // 統合先はA/B問わず全オブジェクトから選べるよう、キーに側の情報を埋め込んで結合する。
  function encodeSideKey(side: Side, key: string): string {
    return `${side}${key}`;
  }
  function decodeSideKey(compound: string): { side: Side; key: string } {
    return { side: compound[0] as Side, key: compound.slice(2) };
  }
  function combinedEntries(): PickerEntry[] {
    const fromA = sideKeyEntries("A").map((e) => ({ key: encodeSideKey("A", e.key), label: `A: ${e.label}` }));
    const fromB = sideKeyEntries("B").map((e) => ({ key: encodeSideKey("B", e.key), label: `B: ${e.label}` }));
    return [...fromA, ...fromB];
  }

  function refreshPairingPickers() {
    const srcSide = srcSideSelectEl.value as Side;
    srcPicker.updateEntries(sideKeyEntries(srcSide));
    destPicker.updateEntries(combinedEntries());
  }

  function refreshPairingUi() {
    refreshPairingPickers();
    pairingListEl.innerHTML = pairingListHtml(a, b);
    pairingListEl.querySelectorAll<HTMLButtonElement>(".pairing-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        pairingStore.remove(btn.dataset.srcSide as Side, btn.dataset.srcKey!, btn.dataset.destSide as Side, btn.dataset.destKey!);
        rebuildTabs();
      });
    });
  }

  function buildTabs() {
    subTabsEl.innerHTML = "";
    subPanelsEl.innerHTML = "";
    tabButtons = new Map();
    tabPanels = new Map();

    for (const tab of subTabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab-btn";
      subTabsEl.appendChild(btn);
      tabButtons.set(tab.id, btn);
      refreshTabButton(tab);

      const tabPanel = renderItemListPanel(tab.items, () => refreshTabButton(tab));
      tabPanel.hidden = true;
      subPanelsEl.appendChild(tabPanel);
      tabPanels.set(tab.id, tabPanel);

      btn.addEventListener("click", () => {
        tabButtons.forEach((b) => b.classList.remove("active"));
        tabPanels.forEach((p) => (p.hidden = true));
        btn.classList.add("active");
        tabPanels.get(tab.id)!.hidden = false;
      });
    }
    const firstBtn = tabButtons.get(subTabs[0]?.id);
    if (firstBtn) {
      firstBtn.classList.add("active");
      tabPanels.get(subTabs[0].id)!.hidden = false;
    }
    refreshGlobalStats();
  }

  /** ペアリングの追加/解除など、オブジェクト構成そのものが変わった時に呼ぶ全面再構築。 */
  function rebuildTabs() {
    objects = mergeObjectsWithPairings(a.objects, b.objects, pairingStore.list());
    subTabs = buildSubTabs(psets, objects, records);
    buildTabs();
    refreshPairingUi();
  }

  function rebuildAllPanels() {
    subTabs.forEach(refreshTabButton);
    tabPanels.forEach((p, id) => {
      const tab = subTabs.find((t) => t.id === id)!;
      const fresh = renderItemListPanel(tab.items, () => refreshTabButton(tab));
      fresh.hidden = p.hidden;
      p.replaceWith(fresh);
      tabPanels.set(id, fresh);
    });
  }

  buildTabs();
  refreshPairingUi();

  srcSideSelectEl.addEventListener("change", () => {
    srcPicker.reset();
    refreshPairingPickers();
  });

  panel.querySelector<HTMLButtonElement>('[data-role="pair-add-btn"]')!.addEventListener("click", () => {
    const srcSide = srcSideSelectEl.value as Side;
    const srcSelected = srcPicker.getSelected();
    const destSelected = destPicker.getSelected();
    if (!srcSelected || !destSelected) {
      alert("統合元・統合先の両方でオブジェクトを検索して選択してください。");
      return;
    }
    const { side: destSide, key: destKey } = decodeSideKey(destSelected.key);
    if (srcSide === destSide && srcSelected.key === destKey) {
      alert("統合元と統合先に同じオブジェクトは選べません。");
      return;
    }
    pairingStore.add(srcSide, srcSelected.key, destSide, destKey);
    destPicker.reset();
    srcPicker.reset();
    rebuildTabs();
    alert(`統合しました。\n\n統合元: ${srcSide} ${srcSelected.label}\n統合先: ${destSide} ${destSelected.label.replace(/^[AB]: /, "")}\n\n競合するフィールドは統合元が優先されます。`);
  });

  panel.querySelector<HTMLButtonElement>('[data-role="export-xml-btn"]')!.addEventListener("click", () => {
    const { undecidedCount } = computeExportSummary(psets, objects, records);
    if (undecidedCount > 0) {
      alert(`未決定の競合が${undecidedCount}件あるため書き出せません。すべての競合でA/Bを選択してから、再度お試しください。`);
      return;
    }
    const xml = buildExportXml(a, b, psets, objects, records);
    downloadText(`IFC_DataMapping_統合_${new Date().toISOString().slice(0, 10)}.xml`, xml, "application/xml");
  });

  panel.querySelector<HTMLButtonElement>('[data-role="export-btn"]')!.addEventListener("click", () => {
    downloadText(`dm_merge_decisions_${new Date().toISOString().slice(0, 10)}.json`, decisionStore.exportJson(), "application/json");
  });
  const importFileEl = panel.querySelector<HTMLInputElement>('[data-role="import-file"]')!;
  panel.querySelector<HTMLButtonElement>('[data-role="import-btn"]')!.addEventListener("click", () => importFileEl.click());
  importFileEl.addEventListener("change", async () => {
    const file = importFileEl.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = decisionStore.importJson(text);
      rebuildAllPanels();
      alert(`${count}件の選択状態をインポートしました。`);
    } catch (e) {
      alert(`インポートに失敗しました: ${String(e)}`);
    } finally {
      importFileEl.value = "";
    }
  });
  panel.querySelector<HTMLButtonElement>('[data-role="reset-btn"]')!.addEventListener("click", () => {
    if (!confirm("すべての選択状態をリセットします。よろしいですか?")) return;
    decisionStore.clearAll();
    rebuildAllPanels();
  });

  return panel;
}
