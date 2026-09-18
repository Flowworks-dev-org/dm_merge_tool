import { parseDataManagerXml, XmlParseError } from "../xml/extract";
import type { ParsedDataManager, PSetDef, ObjectDef, RecordDef } from "../xml/model";
import { diffMaps, countByStatus, type DiffRow } from "../xml/diff";
import { escapeHtml } from "./util";
import { mergePSets, mergeRecords } from "../xml/merge";
import { renderMergePreviewTab } from "./mergePreview";

function renderSummary(
  psetRows: DiffRow<PSetDef>[],
  objectRows: DiffRow<ObjectDef>[],
  recordRows: DiffRow<RecordDef>[],
  a: ParsedDataManager,
  b: ParsedDataManager,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "tab-panel";
  panel.dataset.tabId = "summary";
  const cats: [string, DiffRow<unknown>[]][] = [
    ["CustomPSets(IFCプロパティセット)", psetRows],
    ["Object(オブジェクト⇔IFCマッピング)", objectRows],
    ["RecData(独自レコード定義)", recordRows],
  ];
  panel.innerHTML = `
    <div class="file-meta">
      <div><strong>A:</strong> ${escapeHtml(a.sourceFileName)} <span class="muted">(fileName="${escapeHtml(a.fileName)}", version=${escapeHtml(a.version)}, IfcScheme=${escapeHtml(a.ifcScheme)})</span></div>
      <div><strong>B:</strong> ${escapeHtml(b.sourceFileName)} <span class="muted">(fileName="${escapeHtml(b.fileName)}", version=${escapeHtml(b.version)}, IfcScheme=${escapeHtml(b.ifcScheme)})</span></div>
    </div>
    <table class="summary-table">
      <thead><tr><th>種別</th><th>Aのみ</th><th>Bのみ</th><th>共通・一致</th><th>共通・差分あり</th><th>合計</th></tr></thead>
      <tbody>
        ${cats
          .map(([label, rows]) => {
            const c = countByStatus(rows);
            return `<tr><td>${escapeHtml(label)}</td><td>${c.onlyA}</td><td>${c.onlyB}</td><td>${c.same}</td><td class="${c.diff > 0 ? "emphasize" : ""}">${c.diff}</td><td>${rows.length}</td></tr>`;
          })
          .join("")}
      </tbody>
    </table>
    <p class="muted note">
      ※ 各項目の詳細な比較・採用元の選択は「統合プレビュー」タブで行います。<br />
      ※ criteria / DataSource に含まれる内部バイナリ値はVectorworks独自のシリアライズ形式のためデコードせず、値が一致するかどうかの判定にのみ使用しています。
    </p>
  `;
  return panel;
}

export function mountApp(root: HTMLElement) {
  root.innerHTML = `
    <header class="app-header">
      <h1>Vectorworks Data Manager 統合ツール</h1>
      <p class="muted">
        Vectorworks の「データマネージャ」から書き出した2つのIFCマッピング設定XMLを読み込み、差分を可視化・統合プレビューします。
        ファイルはすべてブラウザ内で処理され、どこにも送信されません。
      </p>
    </header>
    <section class="upload-section">
      <div class="upload-box" data-role="upload-a">
        <label>データマネージャ設定A(xml・FW製もしくは統合版等)<input type="file" accept=".xml" data-role="file-a" /></label>
        <p class="upload-status muted" data-role="status-a">未選択</p>
      </div>
      <div class="upload-box" data-role="upload-b">
        <label>データマネージャ設定B(xml・VWJ製等)<input type="file" accept=".xml" data-role="file-b" /></label>
        <p class="upload-status muted" data-role="status-b">未選択</p>
        <button type="button" class="filter-btn" data-role="skip-b-btn">Bを使わずAのみで進める(Aの再設定用)</button>
      </div>
    </section>
    <p class="error-msg" data-role="error" hidden></p>
    <section class="results" data-role="results" hidden>
      <nav class="tabs" data-role="tabs"></nav>
      <div class="tab-panels" data-role="panels"></div>
    </section>
  `;

  let docA: ParsedDataManager | null = null;
  let docB: ParsedDataManager | null = null;
  const errorEl = root.querySelector<HTMLElement>('[data-role="error"]')!;

  /** Bを使わない場合の空データ。全項目がAのみ(onlyA)として扱われ、競合は発生しない。 */
  function createEmptyDataManager(): ParsedDataManager {
    return {
      fileName: "",
      sourceFileName: "(未使用)",
      version: "",
      ifcScheme: "",
      customPSetsVersion: "",
      criteriaOrderEl: null,
      psets: new Map(),
      objects: new Map(),
      records: new Map(),
    };
  }

  function showError(msg: string | null) {
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  async function handleFile(which: "a" | "b", file: File) {
    const statusEl = root.querySelector<HTMLElement>(`[data-role="status-${which}"]`)!;
    try {
      const text = await file.text();
      const parsed = parseDataManagerXml(text, file.name);
      statusEl.textContent = `${file.name} — PSet:${parsed.psets.size} / Object:${parsed.objects.size} / Record:${parsed.records.size}`;
      statusEl.classList.remove("muted");
      statusEl.classList.add("ok");
      if (which === "a") docA = parsed;
      else docB = parsed;
      showError(null);
      if (docA && docB) buildResults(docA, docB);
    } catch (e) {
      const msg = e instanceof XmlParseError ? e.message : `読み込みエラー(${file.name}): ${String(e)}`;
      showError(msg);
      statusEl.textContent = "読み込み失敗";
      statusEl.classList.add("error");
    }
  }

  root.querySelector<HTMLInputElement>('[data-role="file-a"]')!.addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) handleFile("a", f);
  });
  root.querySelector<HTMLInputElement>('[data-role="file-b"]')!.addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) handleFile("b", f);
  });
  root.querySelector<HTMLButtonElement>('[data-role="skip-b-btn"]')!.addEventListener("click", () => {
    docB = createEmptyDataManager();
    const statusEl = root.querySelector<HTMLElement>('[data-role="status-b"]')!;
    statusEl.textContent = "(未使用: Aのみで進めます)";
    statusEl.classList.remove("error", "ok");
    statusEl.classList.add("muted");
    root.querySelector<HTMLInputElement>('[data-role="file-b"]')!.value = "";
    showError(null);
    if (docA) buildResults(docA, docB);
  });

  function buildResults(a: ParsedDataManager, b: ParsedDataManager) {
    const resultsEl = root.querySelector<HTMLElement>('[data-role="results"]')!;
    const tabsEl = root.querySelector<HTMLElement>('[data-role="tabs"]')!;
    const panelsEl = root.querySelector<HTMLElement>('[data-role="panels"]')!;
    resultsEl.hidden = false;

    const psetRows = diffMaps(a.psets, b.psets, (x, y) => x.raw === y.raw);
    const objectRows = diffMaps(a.objects, b.objects, (x, y) => x.raw === y.raw);
    const recordRows = diffMaps(a.records, b.records, (x, y) => x.raw === y.raw);

    const summaryPanel = renderSummary(psetRows, objectRows, recordRows, a, b);
    const mergedPSets = mergePSets(a.psets, b.psets);
    const mergedRecords = mergeRecords(a.records, b.records);
    const mergePreviewPanel = renderMergePreviewTab(a, b, mergedPSets, mergedRecords);

    const tabs: { id: string; label: string; panel: HTMLElement }[] = [
      { id: "summary", label: "サマリー", panel: summaryPanel },
      { id: "merge-preview", label: "統合プレビュー", panel: mergePreviewPanel },
    ];

    tabsEl.innerHTML = tabs.map((t, i) => `<button type="button" class="tab-btn${i === 0 ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");
    panelsEl.innerHTML = "";
    tabs.forEach((t, i) => {
      if (i !== 0) t.panel.hidden = true;
      panelsEl.appendChild(t.panel);
    });
    tabsEl.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        tabsEl.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const id = btn.dataset.tab;
        tabs.forEach((t) => {
          t.panel.hidden = t.id !== id;
        });
      });
    });
  }
}
