const storageKey = "zfl16-movable-type-workshop";
const LOG_LIMIT = 200;

const PAPERS = {
  postcard: { cols: 16, rows: 10, label: "明信片" },
  bookmark: { cols: 7, rows: 18, label: "书签" },
  square: { cols: 12, rows: 12, label: "方形小笺" }
};

const CATEGORY_NAMES = {
  type: "字模",
  board: "版面",
  draft: "草稿",
  export: "导出",
  restore: "恢复"
};

const starterInventory = [
  { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
  { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
  { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
  { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
];

const defaultState = {
  inventory: starterInventory,
  selectedTypeId: starterInventory[0].id,
  placements: [],
  drafts: [],
  log: [],
  lastRestore: null,
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

let state = loadState();

// 界面状态（不持久化）
let logFilter = "all";
let logSortAsc = false;
let compareIds = [];
let noticeState = null;
let editingTypeId = null;

const els = {
  paperSize: document.querySelector("#paperSize"),
  flowMode: document.querySelector("#flowMode"),
  gridGap: document.querySelector("#gridGap"),
  workTitle: document.querySelector("#workTitle"),
  stage: document.querySelector("#stage"),
  typeList: document.querySelector("#typeList"),
  typeForm: document.querySelector("#typeForm"),
  charInput: document.querySelector("#charInput"),
  styleInput: document.querySelector("#styleInput"),
  sizeInput: document.querySelector("#sizeInput"),
  quantityInput: document.querySelector("#quantityInput"),
  wearInput: document.querySelector("#wearInput"),
  typeSubmitBtn: document.querySelector("#typeSubmitBtn"),
  cancelEditBtn: document.querySelector("#cancelEditBtn"),
  inventorySearch: document.querySelector("#inventorySearch"),
  styleFilter: document.querySelector("#styleFilter"),
  selectedTypeLabel: document.querySelector("#selectedTypeLabel"),
  shortageBadge: document.querySelector("#shortageBadge"),
  usageList: document.querySelector("#usageList"),
  draftList: document.querySelector("#draftList"),
  placedCount: document.querySelector("#placedCount"),
  inventoryCount: document.querySelector("#inventoryCount"),
  saveDraftBtn: document.querySelector("#saveDraftBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  clearBoardBtn: document.querySelector("#clearBoardBtn"),
  logCount: document.querySelector("#logCount"),
  logFilters: document.querySelector("#logFilters"),
  logSortBtn: document.querySelector("#logSortBtn"),
  undoRestoreBtn: document.querySelector("#undoRestoreBtn"),
  noticeArea: document.querySelector("#noticeArea"),
  comparePanel: document.querySelector("#comparePanel"),
  logList: document.querySelector("#logList")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...parsed.settings }
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function getGrid() {
  return PAPERS[state.settings.paperSize] || PAPERS.postcard;
}

function placementKey(row, col) {
  return `${row}:${col}`;
}

function getSelectedType() {
  return state.inventory.find((item) => item.id === state.selectedTypeId) || null;
}

function getUsage() {
  return state.placements.reduce((acc, placement) => {
    acc[placement.typeId] = (acc[placement.typeId] || 0) + 1;
    return acc;
  }, {});
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString("zh-CN", { hour12: false });
}

// ---------- 操作日志 ----------

function takeSnapshot() {
  return {
    inventory: structuredClone(state.inventory),
    placements: structuredClone(state.placements)
  };
}

function snapshotsEqual(a, b) {
  return (
    JSON.stringify(a.inventory) === JSON.stringify(b.inventory) &&
    JSON.stringify(a.placements) === JSON.stringify(b.placements)
  );
}

function logOp(category, action, label, detail, before, after) {
  state.log.unshift({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    category,
    action,
    label,
    detail: detail || {},
    before,
    after
  });
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
}

function inventoryStats(inventory) {
  const total = inventory.reduce((sum, item) => sum + item.quantity, 0);
  return `${inventory.length}种${total}枚`;
}

function typeLabel(type) {
  return `${type.char}·${type.style}`;
}

function diffTypeCounts(snapA, snapB) {
  const mapA = new Map(snapA.inventory.map((item) => [item.id, item]));
  const mapB = new Map(snapB.inventory.map((item) => [item.id, item]));
  const added = [];
  const removed = [];
  const changed = [];
  mapB.forEach((item, id) => {
    if (!mapA.has(id)) added.push(item);
  });
  mapA.forEach((item, id) => {
    const other = mapB.get(id);
    if (!other) {
      removed.push(item);
    } else if (other.quantity !== item.quantity) {
      changed.push({ label: typeLabel(item), from: item.quantity, to: other.quantity });
    }
  });
  const sum = (inventory) => inventory.reduce((acc, item) => acc + item.quantity, 0);
  return {
    aKinds: snapA.inventory.length,
    bKinds: snapB.inventory.length,
    aTotal: sum(snapA.inventory),
    bTotal: sum(snapB.inventory),
    added,
    removed,
    changed
  };
}

function diffPlacements(snapA, snapB) {
  const mapA = new Map(snapA.placements.map((item) => [placementKey(item.row, item.col), item]));
  const mapB = new Map(snapB.placements.map((item) => [placementKey(item.row, item.col), item]));
  const invA = new Map(snapA.inventory.map((item) => [item.id, item]));
  const invB = new Map(snapB.inventory.map((item) => [item.id, item]));
  const charOf = (typeId) => invB.get(typeId)?.char || invA.get(typeId)?.char || "？";
  const byPosition = (a, b) => a.row - b.row || a.col - b.col;
  const added = [];
  const removed = [];
  const changed = [];
  mapB.forEach((placement, key) => {
    if (!mapA.has(key)) {
      added.push({ row: placement.row, col: placement.col, char: charOf(placement.typeId) });
    }
  });
  mapA.forEach((placement, key) => {
    const other = mapB.get(key);
    if (!other) {
      removed.push({ row: placement.row, col: placement.col, char: charOf(placement.typeId) });
    } else if (other.typeId !== placement.typeId) {
      changed.push({
        row: placement.row,
        col: placement.col,
        from: charOf(placement.typeId),
        to: charOf(other.typeId)
      });
    }
  });
  added.sort(byPosition);
  removed.sort(byPosition);
  changed.sort(byPosition);
  return { aCount: snapA.placements.length, bCount: snapB.placements.length, added, removed, changed };
}

// ---------- 版本恢复 ----------

function findRestoreConflicts(target) {
  const conflicts = [];
  const { cols, rows } = getGrid();
  const overflow = target.placements.filter((item) => item.row >= rows || item.col >= cols);
  if (overflow.length) {
    const fitting = Object.values(PAPERS)
      .filter((paper) => target.placements.every((item) => item.row < paper.rows && item.col < paper.cols))
      .map((paper) => paper.label);
    conflicts.push(
      `目标版本有 ${overflow.length} 个落字超出当前纸张网格（${cols}列×${rows}行）。` +
        (fitting.length ? `请先将纸张切换为：${fitting.join("、")}。` : "没有能容纳该版面的纸张。")
    );
  }
  const targetIds = new Set(target.inventory.map((item) => item.id));
  const currentById = new Map(state.inventory.map((item) => [item.id, item]));
  state.drafts.forEach((draft) => {
    const missingIds = [...new Set(draft.placements.map((item) => item.typeId).filter((id) => !targetIds.has(id)))];
    if (missingIds.length) {
      const names = missingIds.map((id) => {
        const type = currentById.get(id);
        return type ? typeLabel(type) : "未知字模";
      });
      conflicts.push(`草稿《${draft.title}》引用了目标版本中不存在的字模：${names.join("、")}。请先删除该草稿或调整字模。`);
    }
  });
  return conflicts;
}

function fixSelectedType() {
  if (!state.inventory.some((item) => item.id === state.selectedTypeId)) {
    state.selectedTypeId = state.inventory[0]?.id || null;
  }
}

function restoreToVersion(logId) {
  const entry = state.log.find((item) => item.id === logId);
  if (!entry) return;
  const target = structuredClone(entry.after);
  if (snapshotsEqual(target, takeSnapshot())) {
    showNotice("目标版本与当前字模、版面完全一致，无需恢复。", "info");
    return;
  }
  const conflicts = findRestoreConflicts(target);
  if (conflicts.length) {
    showNotice([`恢复被拒绝：目标版本与当前其他数据存在 ${conflicts.length} 处冲突。`, ...conflicts], "error");
    return;
  }
  const ok = confirm(
    `将字模库与版面恢复到 ${formatTime(entry.time)} 时的状态？\n仅回滚字模与版面，草稿、纸张设置与操作日志保持不变。`
  );
  if (!ok) return;
  const before = takeSnapshot();
  state.lastRestore = {
    logId: entry.id,
    time: new Date().toISOString(),
    prevInventory: structuredClone(state.inventory),
    prevPlacements: structuredClone(state.placements)
  };
  state.inventory = target.inventory;
  state.placements = target.placements;
  fixSelectedType();
  logOp(
    "restore",
    "restore",
    `恢复字模与版面至 ${formatTime(entry.time)} 的版本`,
    { sourceLogId: entry.id, sourceTime: entry.time },
    before,
    takeSnapshot()
  );
  showNotice(`已恢复到 ${formatTime(entry.time)} 的字模与版面；草稿、设置与日志未受影响。如需回退，可「撤销最近一次恢复」。`, "ok");
  renderAll();
}

function undoRestore() {
  const last = state.lastRestore;
  if (!last) return;
  const target = { inventory: structuredClone(last.prevInventory), placements: structuredClone(last.prevPlacements) };
  const conflicts = findRestoreConflicts(target);
  if (conflicts.length) {
    showNotice([`无法撤销恢复：与当前其他数据存在 ${conflicts.length} 处冲突。`, ...conflicts], "error");
    return;
  }
  const ok = confirm("撤销最近一次恢复？字模与版面将回到恢复前的状态，恢复之后所做的改动会被覆盖（仍会保留在日志中）。");
  if (!ok) return;
  const before = takeSnapshot();
  state.inventory = target.inventory;
  state.placements = target.placements;
  state.lastRestore = null;
  fixSelectedType();
  logOp("restore", "undo", `撤销 ${formatTime(last.time)} 的恢复`, { restoredLogId: last.logId }, before, takeSnapshot());
  showNotice("已撤销最近一次恢复。", "ok");
  renderAll();
}

function showNotice(lines, kind) {
  noticeState = { kind, lines: Array.isArray(lines) ? lines : [lines] };
  renderNotice();
}

// ---------- 渲染 ----------

function renderSettings() {
  els.paperSize.value = state.settings.paperSize;
  els.flowMode.value = state.settings.flowMode;
  els.gridGap.value = state.settings.gridGap;
  els.workTitle.value = state.settings.workTitle;
}

function renderStyleFilter() {
  const current = els.styleFilter.value || "all";
  const styles = [...new Set(state.inventory.map((item) => item.style))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.styleFilter.innerHTML = `<option value="all">全部风格</option>${styles
    .map((style) => `<option value="${escapeHtml(style)}">${escapeHtml(style)}</option>`)
    .join("")}`;
  els.styleFilter.value = styles.includes(current) ? current : "all";
}

function renderInventory() {
  const keyword = els.inventorySearch.value.trim();
  const style = els.styleFilter.value;
  const usage = getUsage();
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length}枚字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = usage[item.id] || 0;
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      const editing = item.id === editingTypeId ? "editing" : "";
      return `
        <article class="type-card ${selected} ${editing}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 已用${used}/${item.quantity}</span>
          </div>
          <div class="card-actions">
            <button class="mini-btn" title="修改字模" data-edit-type="${item.id}" type="button">✎</button>
            <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderStage() {
  const { cols, rows } = getGrid();
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const placement = map.get(placementKey(row, col));
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
      cells.push(`
        <button class="cell ${type ? "used" : ""} ${vertical}" data-row="${row}" data-col="${col}" type="button" aria-label="第${row + 1}行第${col + 1}列">
          ${type ? escapeHtml(type.char) : ""}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  const usage = getUsage();
  const entries = state.inventory.filter((item) => usage[item.id]);
  els.placedCount.textContent = `${state.placements.length}个落字`;

  const shortages = entries.filter((item) => usage[item.id] > item.quantity);
  els.shortageBadge.textContent = shortages.length ? `${shortages.length}处超量` : "数量充足";
  els.shortageBadge.className = `badge ${shortages.length ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType ? `当前：${selectedType.char} · ${selectedType.style}` : "未选择字模";

  els.usageList.innerHTML =
    entries
      .map((item) => {
        const used = usage[item.id];
        const warn = used > item.quantity ? "warn" : "";
        return `
          <div class="usage-item ${warn}">
            <strong>${escapeHtml(item.char)} ${escapeHtml(item.style)}</strong>
            <span>${used}/${item.quantity}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.draftList.innerHTML =
    state.drafts
      .map(
        (draft) => `
          <article class="draft-item">
            <strong>${escapeHtml(draft.title)}</strong>
            <span>${draft.placements.length}个落字 · ${formatTime(draft.savedAt)}</span>
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `
      )
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

function renderLog() {
  const filtered = state.log.filter((entry) => logFilter === "all" || entry.category === logFilter);
  const ordered = logSortAsc ? [...filtered].reverse() : filtered;
  els.logCount.textContent = `共${state.log.length}条 · 显示${filtered.length}条`;
  els.logFilters.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.logFilter === logFilter);
  });
  els.logSortBtn.textContent = logSortAsc ? "最早在前" : "最新在前";
  els.undoRestoreBtn.disabled = !state.lastRestore;
  els.undoRestoreBtn.title = state.lastRestore ? `撤销 ${formatTime(state.lastRestore.time)} 的恢复` : "暂无可撤销的恢复";

  const emptyText = state.log.length ? "该分类下暂无记录。" : "还没有操作记录，新增字模或落字后会自动记录。";
  els.logList.innerHTML =
    ordered
      .map((entry) => {
        const selected = compareIds.includes(entry.id);
        return `
          <article class="log-item ${selected ? "compare-selected" : ""}">
            <div class="log-main">
              <div class="log-head">
                <span class="log-tag ${entry.category}">${CATEGORY_NAMES[entry.category] || entry.category}</span>
                <time>${formatTime(entry.time)}</time>
              </div>
              <div class="log-label">${escapeHtml(entry.label)}</div>
              <div class="log-stats">字模 ${inventoryStats(entry.before.inventory)} → ${inventoryStats(entry.after.inventory)} ｜ 落字 ${entry.before.placements.length} → ${entry.after.placements.length}</div>
            </div>
            <div class="log-actions">
              <button type="button" class="${selected ? "on" : ""}" data-compare="${entry.id}">${selected ? "已选" : "对比"}</button>
              <button type="button" data-restore="${entry.id}">恢复此版本</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">${emptyText}</p>`;
}

function renderNotice() {
  if (!noticeState) {
    els.noticeArea.hidden = true;
    els.noticeArea.innerHTML = "";
    return;
  }
  const [head, ...rest] = noticeState.lines;
  els.noticeArea.hidden = false;
  els.noticeArea.className = `notice-area ${noticeState.kind}`;
  els.noticeArea.innerHTML =
    `<strong>${escapeHtml(head)}</strong>` +
    (rest.length ? `<ul>${rest.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "");
}

function diffList(lines, emptyText, cap = 20) {
  if (!lines.length) return `<p class="empty">${emptyText}</p>`;
  const shown = lines.slice(0, cap);
  const more = lines.length - shown.length;
  return `<ul>${shown.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}${
    more > 0 ? `<li>…还有 ${more} 条</li>` : ""
  }</ul>`;
}

function renderCompare() {
  const selected = compareIds.map((id) => state.log.find((entry) => entry.id === id)).filter(Boolean);
  if (!selected.length) {
    els.comparePanel.hidden = true;
    els.comparePanel.innerHTML = "";
    return;
  }
  els.comparePanel.hidden = false;
  const head = `<div class="compare-head"><h3>记录对比</h3><button type="button" data-clear-compare>清除选择</button></div>`;
  if (selected.length < 2) {
    els.comparePanel.innerHTML = head + `<p class="compare-meta">已选 1 条记录，请再选 1 条进行对比。</p>`;
    return;
  }
  const [a, b] = [...selected].sort((x, y) => x.time.localeCompare(y.time));
  const typeDiff = diffTypeCounts(a.after, b.after);
  const boardDiff = diffPlacements(a.after, b.after);

  const typeLines = [
    ...typeDiff.added.map((item) => `＋ 新增「${typeLabel(item)}」×${item.quantity}`),
    ...typeDiff.removed.map((item) => `－ 移除「${typeLabel(item)}」×${item.quantity}`),
    ...typeDiff.changed.map((item) => `±「${item.label}」数量 ${item.from} → ${item.to}`)
  ];
  const boardLines = [
    ...boardDiff.added.map((item) => `＋ 第${item.row + 1}行第${item.col + 1}列 落「${item.char}」`),
    ...boardDiff.removed.map((item) => `－ 第${item.row + 1}行第${item.col + 1}列 撤「${item.char}」`),
    ...boardDiff.changed.map((item) => `± 第${item.row + 1}行第${item.col + 1}列「${item.from}」→「${item.to}」`)
  ];

  els.comparePanel.innerHTML = `
    ${head}
    <p class="compare-meta">A：${formatTime(a.time)} · ${escapeHtml(a.label)}<br />B：${formatTime(b.time)} · ${escapeHtml(b.label)}</p>
    <div class="diff-grid">
      <div class="diff-box">
        <h4>字模数量差异</h4>
        <div class="diff-summary">${typeDiff.aKinds}种${typeDiff.aTotal}枚 → ${typeDiff.bKinds}种${typeDiff.bTotal}枚</div>
        ${diffList(typeLines, "字模数量无差异")}
      </div>
      <div class="diff-box">
        <h4>版面落字差异</h4>
        <div class="diff-summary">落字 ${boardDiff.aCount} → ${boardDiff.bCount}</div>
        ${diffList(boardLines, "版面落字无差异")}
      </div>
    </div>
  `;
}

function renderAll() {
  saveState();
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
  renderLog();
  renderCompare();
  renderNotice();
}

// ---------- 业务操作 ----------

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) return;
  const type = state.inventory.find((item) => item.id === typeId);
  if (!type) return;
  const before = takeSnapshot();
  const existingIndex = state.placements.findIndex((item) => item.row === row && item.col === col);
  if (existingIndex >= 0) {
    const existing = state.placements[existingIndex];
    if (existing.typeId === typeId) {
      state.placements.splice(existingIndex, 1);
      logOp("board", "unplace", `移除第${row + 1}行第${col + 1}列落字「${type.char}」`, { row: row + 1, col: col + 1, typeId }, before, takeSnapshot());
    } else {
      const fromType = state.inventory.find((item) => item.id === existing.typeId);
      existing.typeId = typeId;
      logOp(
        "board",
        "replace",
        `第${row + 1}行第${col + 1}列「${fromType ? fromType.char : "未知"}」替换为「${type.char}」`,
        { row: row + 1, col: col + 1, fromTypeId: existing.typeId, toTypeId: typeId },
        before,
        takeSnapshot()
      );
    }
  } else {
    state.placements.push({ row, col, typeId });
    logOp("board", "place", `落字「${type.char}」于第${row + 1}行第${col + 1}列`, { row: row + 1, col: col + 1, typeId }, before, takeSnapshot());
  }
  renderAll();
}

function clearBoard() {
  if (!state.placements.length) return;
  const before = takeSnapshot();
  const removed = state.placements.length;
  state.placements = [];
  logOp("board", "clear", `清空版面（${removed}个落字）`, { removed }, before, takeSnapshot());
  renderAll();
}

function addType(event) {
  event.preventDefault();
  const values = {
    char: els.charInput.value.trim(),
    style: els.styleInput.value.trim(),
    size: Number(els.sizeInput.value),
    quantity: Number(els.quantityInput.value),
    wear: els.wearInput.value
  };
  if (!values.char || !values.style) return;

  if (editingTypeId) {
    const item = state.inventory.find((entry) => entry.id === editingTypeId);
    if (item) {
      const before = takeSnapshot();
      const beforeItem = structuredClone(item);
      Object.assign(item, values);
      const changes = [];
      if (beforeItem.char !== item.char) changes.push(`字 ${beforeItem.char}→${item.char}`);
      if (beforeItem.style !== item.style) changes.push(`风格 ${beforeItem.style}→${item.style}`);
      if (beforeItem.size !== item.size) changes.push(`字号 ${beforeItem.size}→${item.size}`);
      if (beforeItem.quantity !== item.quantity) changes.push(`数量 ${beforeItem.quantity}→${item.quantity}`);
      if (beforeItem.wear !== item.wear) changes.push(`磨损 ${beforeItem.wear}→${item.wear}`);
      if (changes.length) {
        logOp(
          "type",
          "modify",
          `修改字模「${typeLabel(item)}」：${changes.join("，")}`,
          { before: beforeItem, after: structuredClone(item) },
          before,
          takeSnapshot()
        );
      }
    }
    cancelEditType();
    renderAll();
    return;
  }

  const item = { id: crypto.randomUUID(), ...values };
  const before = takeSnapshot();
  state.inventory.unshift(item);
  state.selectedTypeId = item.id;
  logOp("type", "add", `新增字模「${typeLabel(item)}」×${item.quantity}`, { item: structuredClone(item) }, before, takeSnapshot());
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  renderAll();
}

function startEditType(typeId) {
  const item = state.inventory.find((entry) => entry.id === typeId);
  if (!item) return;
  editingTypeId = typeId;
  els.charInput.value = item.char;
  els.styleInput.value = item.style;
  els.sizeInput.value = item.size;
  els.quantityInput.value = item.quantity;
  els.wearInput.value = item.wear;
  els.typeSubmitBtn.textContent = "保存修改";
  els.cancelEditBtn.hidden = false;
  els.typeForm.classList.add("editing");
  renderInventory();
  els.charInput.focus();
}

function cancelEditType() {
  editingTypeId = null;
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  els.typeSubmitBtn.textContent = "加入";
  els.cancelEditBtn.hidden = true;
  els.typeForm.classList.remove("editing");
  renderInventory();
}

function removeType(typeId) {
  const item = state.inventory.find((entry) => entry.id === typeId);
  if (!item) return;
  const before = takeSnapshot();
  const removedPlacements = state.placements.filter((entry) => entry.typeId === typeId).length;
  state.inventory = state.inventory.filter((entry) => entry.id !== typeId);
  state.placements = state.placements.filter((entry) => entry.typeId !== typeId);
  if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
  if (editingTypeId === typeId) cancelEditType();
  logOp(
    "type",
    "remove",
    `移除字模「${typeLabel(item)}」${removedPlacements ? `，连带移除${removedPlacements}个落字` : ""}`,
    { item: structuredClone(item), removedPlacements },
    before,
    takeSnapshot()
  );
  renderAll();
}

function saveDraft() {
  const title = state.settings.workTitle.trim() || "未命名作品";
  const before = takeSnapshot();
  state.drafts.unshift({
    id: crypto.randomUUID(),
    title,
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    savedAt: new Date().toISOString()
  });
  state.drafts = state.drafts.slice(0, 8);
  logOp("draft", "save", `保存草稿《${title}》（${state.placements.length}个落字）`, { title, placements: state.placements.length }, before, takeSnapshot());
  renderAll();
}

function loadDraftById(draftId) {
  const draft = state.drafts.find((item) => item.id === draftId);
  if (!draft) return;
  const before = takeSnapshot();
  state.settings = structuredClone(draft.settings);
  state.placements = structuredClone(draft.placements);
  logOp("draft", "load", `载入草稿《${draft.title}》`, { draftId: draft.id, title: draft.title }, before, takeSnapshot());
  renderAll();
}

function deleteDraftById(draftId) {
  const draft = state.drafts.find((item) => item.id === draftId);
  if (!draft) return;
  const before = takeSnapshot();
  state.drafts = state.drafts.filter((item) => item.id !== draftId);
  logOp("draft", "delete", `删除草稿《${draft.title}》`, { draftId: draft.id, title: draft.title }, before, takeSnapshot());
  renderAll();
}

function exportPreview() {
  const { cols, rows } = getGrid();
  const cell = state.settings.paperSize === "bookmark" ? 44 : 56;
  const gap = state.settings.gridGap;
  const margin = 48;
  const width = cols * cell + (cols - 1) * gap + margin * 2;
  const height = rows * cell + (rows - 1) * gap + margin * 2 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf1";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#2f2921";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = "#22201c";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(state.settings.workTitle || "未命名作品", margin, 50);
  ctx.font = "bold 30px serif";
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    if (!type) return;
    const x = margin + placement.col * (cell + gap);
    const y = margin + 45 + placement.row * (cell + gap);
    ctx.fillStyle = "#2f2921";
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = "#fff5df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.min(type.size + 8, 42)}px serif`;
    ctx.fillText(type.char, x + cell / 2, y + cell / 2);
  });
  const link = document.createElement("a");
  link.download = `${state.settings.workTitle || "movable-type"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();

  const title = state.settings.workTitle || "未命名作品";
  const snap = takeSnapshot();
  logOp(
    "export",
    "export",
    `导出预览图《${title}》`,
    { title, placements: state.placements.length, paperSize: state.settings.paperSize },
    snap,
    structuredClone(snap)
  );
  renderAll();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- 事件 ----------

els.paperSize.addEventListener("change", () => {
  const before = takeSnapshot();
  state.settings.paperSize = els.paperSize.value;
  const { cols, rows } = getGrid();
  const dropped = state.placements.filter((item) => item.row >= rows || item.col >= cols).length;
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  if (dropped) {
    logOp("board", "trim", `切换纸张，裁切 ${dropped} 个超出网格的落字`, { paperSize: state.settings.paperSize, dropped }, before, takeSnapshot());
  }
  renderAll();
});

els.flowMode.addEventListener("change", () => {
  state.settings.flowMode = els.flowMode.value;
  renderAll();
});

els.gridGap.addEventListener("input", () => {
  state.settings.gridGap = Number(els.gridGap.value);
  renderAll();
});

els.workTitle.addEventListener("input", () => {
  state.settings.workTitle = els.workTitle.value;
  saveState();
});

els.typeForm.addEventListener("submit", addType);
els.cancelEditBtn.addEventListener("click", cancelEditType);
els.inventorySearch.addEventListener("input", renderInventory);
els.styleFilter.addEventListener("change", renderInventory);
els.saveDraftBtn.addEventListener("click", saveDraft);
els.exportBtn.addEventListener("click", exportPreview);
els.clearBoardBtn.addEventListener("click", clearBoard);

els.typeList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-type]");
  if (editButton) {
    startEditType(editButton.dataset.editType);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    removeType(deleteButton.dataset.deleteType);
    return;
  }
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  state.selectedTypeId = card.dataset.typeId;
  renderAll();
});

els.typeList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.typeId);
});

els.stage.addEventListener("dragover", (event) => {
  if (event.target.closest(".cell")) event.preventDefault();
});

els.stage.addEventListener("drop", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  event.preventDefault();
  placeType(Number(cell.dataset.row), Number(cell.dataset.col), event.dataTransfer.getData("text/plain"));
});

els.stage.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  placeType(Number(cell.dataset.row), Number(cell.dataset.col));
});

els.draftList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-draft]");
  if (loadButton) {
    loadDraftById(loadButton.dataset.loadDraft);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (deleteButton) {
    deleteDraftById(deleteButton.dataset.deleteDraft);
  }
});

els.logFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-log-filter]");
  if (!button) return;
  logFilter = button.dataset.logFilter;
  renderLog();
});

els.logSortBtn.addEventListener("click", () => {
  logSortAsc = !logSortAsc;
  renderLog();
});

els.undoRestoreBtn.addEventListener("click", undoRestore);

els.comparePanel.addEventListener("click", (event) => {
  if (event.target.closest("[data-clear-compare]")) {
    compareIds = [];
    renderLog();
    renderCompare();
  }
});

els.logList.addEventListener("click", (event) => {
  const compareButton = event.target.closest("[data-compare]");
  if (compareButton) {
    const id = compareButton.dataset.compare;
    if (compareIds.includes(id)) {
      compareIds = compareIds.filter((item) => item !== id);
    } else {
      compareIds.push(id);
      if (compareIds.length > 2) compareIds.shift();
    }
    renderLog();
    renderCompare();
    return;
  }
  const restoreButton = event.target.closest("[data-restore]");
  if (restoreButton) {
    restoreToVersion(restoreButton.dataset.restore);
  }
});

renderAll();
