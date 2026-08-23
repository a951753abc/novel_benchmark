"use strict";

const STORAGE_KEY = "novel-benchmark-review-v1";

const RATING_ITEMS = [
  { key: "characters", label: "人物與關係延續", weight: 10 },
  { key: "plotlines", label: "伏筆及劇情線管理", weight: 10 },
  { key: "voice", label: "文風與敘事聲音延續", weight: 10 },
  { key: "contribution", label: "新章對長期故事的貢獻", weight: 5 },
  { key: "genre", label: "類型能力", weight: 25 },
  { key: "chapterQuality", label: "單章小說品質", weight: 15 },
];

const NEGATIVE_TAGS = [
  "翻譯腔", "兩岸用語不自然混雜", "過度華麗堆形容詞", "大量解釋角色心理",
  "角色聲線同質", "前情重述過多", "結尾強行總結", "短篇化收束",
  "套路化 AI 味", "時間線錯誤", "空間動作不連貫", "角色知識越界",
  "世界規則漂移", "伏筆遺忘", "憑空加關鍵線索", "篡改既有證據",
  "過早解決主線", "重複先前橋段", "多章品質衰退", "長章後段趕收尾",
];

const form = document.querySelector("#assessmentForm");
const consistencyRows = document.querySelector("#consistencyRows");
const saveState = document.querySelector("#saveState");
const toast = document.querySelector("#toast");
const toastMessage = document.querySelector("#toastMessage");
const toastAction = document.querySelector("#toastAction");

let saveTimer;
let toastTimer;
let undoState = null;

function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function buildScoreGroups() {
  document.querySelectorAll(".rating-row").forEach((row) => {
    const key = row.dataset.rating;
    const group = row.querySelector(".score-group");
    for (let score = 1; score <= 5; score += 1) {
      const label = document.createElement("label");
      label.className = "score-choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `rating-${key}`;
      input.value = String(score);
      input.setAttribute("aria-label", `${score} 分`);
      const visible = document.createElement("span");
      visible.textContent = String(score);
      visible.setAttribute("aria-hidden", "true");
      label.append(input, visible);
      group.append(label);
    }
  });
}

function buildNegativeTags() {
  const container = document.querySelector("#negativeTags");
  NEGATIVE_TAGS.forEach((tag) => {
    const label = document.createElement("label");
    label.className = "tag-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "negativeTag";
    input.value = tag;
    const box = document.createElement("span");
    box.setAttribute("aria-hidden", "true");
    const text = document.createElement("b");
    text.textContent = tag;
    label.append(input, box, text);
    container.append(label);
  });
}

function uniqueRowId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConsistencyRow(data = {}) {
  const id = data.id || uniqueRowId();
  const row = document.createElement("article");
  row.className = "consistency-row";
  row.dataset.id = id;
  row.innerHTML = `
    <div class="field consistency-row__item">
      <label for="item-${id}">狀態表項目</label>
      <input id="item-${id}" data-field="item" type="text" list="consistencyItems" placeholder="例如：各角色知道的資訊">
    </div>
    <div class="consistency-row__controls">
      <div class="field">
        <label for="score-${id}">一致性得分</label>
        <select id="score-${id}" data-field="score">
          <option value="">未判定</option>
          <option value="2">2 · 正確延續</option>
          <option value="1">1 · 遺漏／輕微</option>
          <option value="0">0 · 明顯矛盾</option>
        </select>
      </div>
      <div class="field">
        <label for="severity-${id}">嚴重度</label>
        <select id="severity-${id}" data-field="severity">
          <option value="">無／不重複計</option>
          <option value="P0">P0 · 系列核心</option>
          <option value="P1">P1 · 長期線</option>
          <option value="P2">P2 · 局部錯誤</option>
          <option value="P3">P3 · 細節級</option>
        </select>
      </div>
    </div>
    <div class="field consistency-row__evidence">
      <label for="row-evidence-${id}">證據</label>
      <textarea id="row-evidence-${id}" data-field="evidence" rows="5" placeholder="0 分或 P0／P1 必須引出對撞原句；其餘也應簡述核對依據。"></textarea>
    </div>
    <button class="button button--text button--danger consistency-row__remove" data-remove-row type="button">移除此列</button>
  `;

  row.querySelector('[data-field="item"]').value = data.item || "";
  row.querySelector('[data-field="score"]').value = data.score === 0 ? "0" : String(data.score || "");
  row.querySelector('[data-field="severity"]').value = data.severity || "";
  row.querySelector('[data-field="evidence"]').value = data.evidence || "";
  consistencyRows.append(row);
  return row;
}

function collectConsistencyRows() {
  return [...consistencyRows.querySelectorAll(".consistency-row")].map((row) => ({
    id: row.dataset.id,
    item: row.querySelector('[data-field="item"]').value.trim(),
    score: row.querySelector('[data-field="score"]').value,
    severity: row.querySelector('[data-field="severity"]').value,
    evidence: row.querySelector('[data-field="evidence"]').value.trim(),
  }));
}

function checkedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function valueOf(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function collectState() {
  const ratings = {};
  RATING_ITEMS.forEach(({ key }) => {
    ratings[key] = {
      score: form.querySelector(`input[name="rating-${key}"]:checked`)?.value || "",
      evidence: valueOf(`evidence-${key}`),
    };
  });

  return {
    version: 1,
    metadata: {
      manuscriptCode: valueOf("manuscriptCode"),
      genre: valueOf("genre"),
      reviewer: valueOf("reviewer"),
      reviewDate: valueOf("reviewDate"),
    },
    ratings,
    instructions: checkedValues("instruction"),
    instructionConfirmed: document.querySelector("#instructionConfirmed").checked,
    negativeTags: checkedValues("negativeTag"),
    readingIntent: form.querySelector('input[name="readingIntent"]:checked')?.value || "",
    reviewSummary: valueOf("reviewSummary"),
    consistencyRows: collectConsistencyRows(),
    consistencyNote: valueOf("consistencyNote"),
    savedAt: new Date().toISOString(),
  };
}

function setCheckedValues(name, values = []) {
  const selected = new Set(values);
  form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function applyState(state) {
  const metadata = state?.metadata || {};
  ["manuscriptCode", "genre", "reviewer", "reviewDate"].forEach((field) => {
    const element = document.querySelector(`#${field}`);
    element.value = metadata[field] || (field === "reviewDate" ? todayString() : "");
  });

  RATING_ITEMS.forEach(({ key }) => {
    form.querySelectorAll(`input[name="rating-${key}"]`).forEach((input) => {
      input.checked = String(state?.ratings?.[key]?.score || "") === input.value;
    });
    document.querySelector(`#evidence-${key}`).value = state?.ratings?.[key]?.evidence || "";
  });

  setCheckedValues("instruction", state?.instructions);
  document.querySelector("#instructionConfirmed").checked = Boolean(state?.instructionConfirmed);
  setCheckedValues("negativeTag", state?.negativeTags);
  form.querySelectorAll('input[name="readingIntent"]').forEach((input) => {
    input.checked = input.value === (state?.readingIntent || "");
  });
  document.querySelector("#reviewSummary").value = state?.reviewSummary || "";
  document.querySelector("#consistencyNote").value = state?.consistencyNote || "";

  consistencyRows.replaceChildren();
  const rows = state?.consistencyRows?.length ? state.consistencyRows : Array.from({ length: 4 }, () => ({}));
  rows.forEach(createConsistencyRow);
  clearValidationMarks();
  updateScores();
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("無法讀取自動保存資料", error);
    return null;
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
    saveState.classList.add("is-saved");
    saveState.querySelector("span:last-child").textContent = "已自動保存";
  } catch (error) {
    saveState.classList.remove("is-saved");
    saveState.querySelector("span:last-child").textContent = "無法自動保存";
    console.warn("無法保存表單", error);
  }
}

function scheduleSave() {
  saveState.classList.remove("is-saved");
  saveState.querySelector("span:last-child").textContent = "保存中…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistState, 350);
}

function consistencyCalculation(rows = collectConsistencyRows()) {
  const active = rows.filter((row) => row.item || row.score !== "" || row.severity || row.evidence);
  if (!active.length) {
    return { score: 5, reason: "核對單未記錄任何問題，依規則視為沒有一致性問題，換算為 5 分。", rate: 100, completed: 0, incomplete: 0, p0: 0, p1: 0 };
  }

  const incomplete = active.filter((row) => !row.item || row.score === "" || !row.evidence);
  if (incomplete.length) {
    return { score: null, reason: `尚有 ${incomplete.length} 列已開始填寫但資料不完整；填妥項目、得分與證據後才可換算。`, rate: null, completed: active.length - incomplete.length, incomplete: incomplete.length, p0: 0, p1: 0 };
  }

  const completed = active;
  const p0 = completed.filter((row) => row.severity === "P0").length;
  const p1 = completed.filter((row) => row.severity === "P1").length;
  const earned = completed.reduce((sum, row) => sum + Number(row.score), 0);
  const rate = (earned / (completed.length * 2)) * 100;

  if (p0 > 0) return { score: 1, reason: `出現 ${p0} 個 P0，依規則換算為 1 分。`, rate, completed: completed.length, p0, p1 };
  if (p1 >= 2) return { score: 1, reason: `出現 ${p1} 個 P1，依規則換算為 1 分。`, rate, completed: completed.length, p0, p1 };
  if (p1 === 1) return { score: 2, reason: "出現 1 個 P1，依規則換算為 2 分。", rate, completed: completed.length, p0, p1 };

  let score = 2;
  if (rate >= 90) score = 5;
  else if (rate >= 75) score = 4;
  else if (rate >= 60) score = 3;

  return {
    score,
    reason: `無 P0／P1；${completed.length} 項得分率 ${rate.toFixed(1)}%，換算為 ${score} 分。`,
    rate,
    completed: completed.length,
    incomplete: 0,
    p0,
    p1,
  };
}

function reviewCalculation(state = collectState()) {
  let completed = 0;
  let scored = 0;
  let weighted = 0;

  RATING_ITEMS.forEach(({ key, weight }) => {
    const item = state.ratings[key];
    if (item.score) {
      scored += 1;
      weighted += Number(item.score) * (weight / 100);
    }
    if (item.score) completed += 1;
  });

  return { completed, scored, weighted };
}

function overallCalculation(state = collectState()) {
  const review = reviewCalculation(state);
  const consistency = consistencyCalculation(state.consistencyRows);
  const instructionScore = state.instructions.length;
  const canCalculate = review.scored === RATING_ITEMS.length && consistency.score !== null && state.instructionConfirmed;
  const score = canCalculate ? review.weighted + consistency.score * 0.15 + instructionScore * 0.1 : null;
  return { score, review, consistency, instructionScore };
}

function updateScores() {
  const state = collectState();
  const result = overallCalculation(state);
  document.querySelector("#reviewProgress").textContent = `${result.review.completed} / 6`;
  document.querySelector("#consistencyScore").textContent = result.consistency.score ?? "—";
  document.querySelector("#consistencyReason").textContent = result.consistency.reason;
  document.querySelector("#dockConsistency").textContent = `${result.consistency.score ?? "—"} / 5`;
  document.querySelector("#overallScore").textContent = `${result.score === null ? "—" : result.score.toFixed(2)} / 5`;
}

function clearValidationMarks() {
  document.querySelectorAll(".has-error").forEach((element) => element.classList.remove("has-error"));
}

function markField(element) {
  element?.closest(".field, .rating-row, .consistency-row")?.classList.add("has-error");
}

function findWarnings(state = collectState()) {
  clearValidationMarks();
  const warnings = [];
  const requiredMetadata = [
    ["manuscriptCode", "尚未填寫稿件代號"],
    ["genre", "尚未選擇作品類型"],
    ["reviewer", "尚未填寫盲評評審"],
  ];

  requiredMetadata.forEach(([id, message]) => {
    if (!state.metadata[id]) {
      warnings.push(message);
      markField(document.querySelector(`#${id}`));
    }
  });

  RATING_ITEMS.forEach(({ key, label }) => {
    const item = state.ratings[key];
    if (!item.score) {
      warnings.push(`「${label}」尚未評分`);
      document.querySelector(`.rating-row[data-rating="${key}"]`)?.classList.add("has-error");
    }
  });

  if (!state.instructionConfirmed) {
    warnings.push("尚未確認已完成指令遵守核對");
  }

  const incompleteConsistencyRows = [];
  state.consistencyRows.forEach((row, index) => {
    const hasAny = row.item || row.score !== "" || row.severity || row.evidence;
    if (!hasAny) return;
    const element = consistencyRows.querySelectorAll(".consistency-row")[index];
    let incomplete = false;
    if (!row.item) {
      incomplete = true;
      markField(element?.querySelector('[data-field="item"]'));
    }
    if (row.score === "") {
      incomplete = true;
      markField(element?.querySelector('[data-field="score"]'));
    }
    if (!row.evidence) {
      incomplete = true;
      markField(element?.querySelector('[data-field="evidence"]'));
    }
    if (incomplete) incompleteConsistencyRows.push(index + 1);
  });

  if (incompleteConsistencyRows.length) {
    warnings.push(`客觀一致性核對第 ${incompleteConsistencyRows.join("、")} 列尚未完整填寫`);
  }
  return warnings;
}

function mdCell(value) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

function mdText(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function checkMark(checked) {
  return checked ? "[x]" : "[ ]";
}

function buildMarkdown() {
  const state = collectState();
  const result = overallCalculation(state);
  const warnings = findWarnings(state);
  const code = state.metadata.manuscriptCode || "未命名稿件";
  const lines = [
    `# 盲評與客觀一致性紀錄：${code}`,
    "",
    "> 中文長篇小說續寫能力 Benchmark 評審紀錄。分數必須搭配證據閱讀，不應脫離判定脈絡單獨引用。",
    "",
    "## 基本資料",
    "",
    "| 欄位 | 內容 |",
    "| --- | --- |",
    `| 稿件代號 | ${mdCell(state.metadata.manuscriptCode)} |`,
    `| 作品類型 | ${mdCell(state.metadata.genre)} |`,
    `| 盲評評審 | ${mdCell(state.metadata.reviewer)} |`,
    `| 評審日期 | ${mdCell(state.metadata.reviewDate)} |`,
    "",
    "## 一、盲評評分單",
    "",
    "| 評分項目 | 權重 | 分數 | 加權值 | 證據 |",
    "| --- | ---: | ---: | ---: | --- |",
  ];

  RATING_ITEMS.forEach(({ key, label, weight }) => {
    const item = state.ratings[key];
    const contribution = item.score ? (Number(item.score) * weight / 100).toFixed(2) : "—";
    lines.push(`| ${label} | ${weight}% | ${mdCell(item.score)} | ${contribution} | ${mdCell(item.evidence)} |`);
  });

  lines.push(
    "",
    `**盲評加權小計：${result.review.scored === RATING_ITEMS.length ? result.review.weighted.toFixed(2) : `${result.review.weighted.toFixed(2)}（未完成）`}／3.75**`,
    "",
    "### 指令遵守（10%）",
    "",
    "> 換算方式：五項各值 1 分；勾選數即為 0–5 分，再乘以 10% 納入總分。",
    "",
  );

  [...document.querySelectorAll('input[name="instruction"]')].forEach((input) => {
    lines.push(`- ${checkMark(state.instructions.includes(input.value))} ${input.value}`);
  });
  lines.push(
    `- ${checkMark(state.instructionConfirmed)} 已完成逐項核對`,
    "",
    `**指令遵守：${state.instructions.length}／5 分**`,
    "",
    "### 負面問題標籤",
    "",
    state.negativeTags.length ? state.negativeTags.map((tag) => `- ${tag}`).join("\n") : "- 無",
    "",
    `**續讀意願：** ${mdText(state.readingIntent)}`,
    "",
    "### 整體評語",
    "",
    mdText(state.reviewSummary),
    "",
    "## 二、客觀一致性核對單",
    "",
    "| 狀態表項目 | 得分 | 嚴重度 | 證據 |",
    "| --- | ---: | --- | --- |",
  );

  const nonEmptyRows = state.consistencyRows.filter((row) => row.item || row.score !== "" || row.severity || row.evidence);
  if (nonEmptyRows.length) {
    nonEmptyRows.forEach((row) => {
      lines.push(`| ${mdCell(row.item)} | ${mdCell(row.score)} | ${mdCell(row.severity)} | ${mdCell(row.evidence)} |`);
    });
  } else {
    lines.push("| — | — | — | 尚未填寫 | ");
  }

  lines.push(
    "",
    `**§17.1 換算結果：${result.consistency.score ?? "—"}／5 分**`,
    "",
    `換算理由：${result.consistency.reason}`,
    "",
    "### 核對補充",
    "",
    mdText(state.consistencyNote),
    "",
    "## 三、總分摘要",
    "",
    "| 構面 | 權重 | 本次分數 |",
    "| --- | ---: | ---: |",
    `| 盲評六項 | 75% | ${result.review.scored === RATING_ITEMS.length ? (result.review.weighted / 0.75).toFixed(2) : "未完成"}／5 |`,
    `| 跨卷事實一致性 | 15% | ${result.consistency.score ?? "未完成"}／5 |`,
    `| 指令遵守 | 10% | ${state.instructionConfirmed ? result.instructionScore : "未確認"}／5 |`,
    "",
    `## 暫計總分：${result.score === null ? "尚無法計算" : `${result.score.toFixed(2)}／5`}`,
    "",
    "### 完整性核對",
    "",
  );

  if (warnings.length) warnings.forEach((warning) => lines.push(`- [ ] ${warning}`));
  else lines.push("- [x] 必填資訊與各項分數均已完成（盲評證據為選填）");

  lines.push(
    "",
    "---",
    "",
    `匯出時間：${new Date().toLocaleString("zh-TW", { hour12: false })}`,
    "",
    "換算備註：一致性若有 P0 → 1 分；無 P0 且有 1 個 P1 → 2 分；2 個以上 P1 → 1 分；僅 P2／P3 時，依 2／1／0 得分率換算（≥90%：5 分、≥75%：4 分、≥60%：3 分、<60%：2 分）。",
  );
  return { markdown: lines.join("\n"), warnings };
}

function safeFilenamePart(value) {
  return String(value || "未命名稿件").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 60);
}

function downloadMarkdown() {
  const { markdown, warnings } = buildMarkdown();
  const state = collectState();
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilenamePart(state.metadata.manuscriptCode)}-評審紀錄-${state.metadata.reviewDate || todayString()}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  persistState();
  showToast(warnings.length ? `已下載；文件內列出 ${warnings.length} 項待補資料。` : "Markdown 已下載，資料完整。", false);
}

async function copyMarkdown() {
  const { markdown, warnings } = buildMarkdown();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = markdown;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(warnings.length ? `已複製；仍有 ${warnings.length} 項待補資料。` : "Markdown 已複製。", false);
  } catch (error) {
    console.warn("複製失敗", error);
    showToast("無法存取剪貼簿，請改用下載。", false);
  }
}

function showToast(message, allowUndo = false) {
  window.clearTimeout(toastTimer);
  toastMessage.textContent = message;
  toastAction.hidden = !allowUndo;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    undoState = null;
  }, allowUndo ? 10000 : 4500);
}

function loadExample() {
  undoState = collectState();
  const sample = {
    version: 1,
    metadata: {
      manuscriptCode: "MA2-X7",
      genre: "推理小說",
      reviewer: "R03",
      reviewDate: todayString(),
    },
    ratings: {
      characters: { score: "4", evidence: "黎川仍以短句迴避助手追問，延續上一章的不信任；但助手偶爾顯得過度主動，關係張力略被削弱。" },
      plotlines: { score: "4", evidence: "懷錶刻字被帶回，並指向另一間鐘錶行；新增可追查方向但沒有直接揭露真凶，主線仍保有空間。" },
      voice: { score: "3", evidence: "前半維持原作冷靜、節制的第三人稱；後半連續三段直接解釋黎川心理，比既有章節更外顯。" },
      contribution: { score: "4", evidence: "新增鐘錶行線索，也讓黎川必須處理助手擅自行動的後果，案件線與關係線都能繼續推進。" },
      genre: { score: "4", evidence: "新線索可由既有懷錶伏筆推得，沒有憑空落答案；然而助手提前知道窗閂細節，削弱了資訊公平性。" },
      chapterQuality: { score: "4", evidence: "鐘錶行場景有清楚目標與阻力，結尾停在新疑點而非總結；中段心理說明稍拖慢節奏。" },
    },
    instructions: ["輸出完整章節", "長度在 2,100–6,500 字內", "無額外分析與說明", "未寫成獨立短篇", "保留未完成的系列主線"],
    instructionConfirmed: true,
    negativeTags: ["大量解釋角色心理", "角色知識越界"],
    readingIntent: "願意",
    reviewSummary: "本章能用既有懷錶伏筆開出新的調查方向，長線管理與場景推進都穩定。主要問題是助手提前說出窗閂細節：這不只是一句台詞失誤，也會改變讀者取得資訊的順序，需在客觀核對列為 P1。",
    consistencyRows: [
      { item: "各角色知道的資訊", score: "0", severity: "P1", evidence: "狀態表：「林森只知道死者曾造訪旅館，尚不知道窗閂刮痕。」新章第 34 段中，林森在黎川說明前直接說「窗閂是從室內割斷的」。" },
      { item: "人物關係與稱呼", score: "1", severity: "P3", evidence: "林森有一處把「小雪」稱為「雪姊」，其餘 11 處仍沿用「小雪」；一句即可修正。" },
      { item: "未回收伏筆", score: "2", severity: "", evidence: "懷錶刻字仍未揭底，只新增鐘錶行來源，與未回收伏筆清單相容。" },
      { item: "人物所在地", score: "2", severity: "", evidence: "黎川與林森自旅館離開後前往港區鐘錶行，移動時間與上一章結尾相容。" },
    ],
    consistencyNote: "窗閂資訊越界同時影響『各角色知道的資訊』與『案件線索節奏』，但依同一錯誤只計一次嚴重度原則，只在前者記 1 個 P1。",
  };
  applyState(sample);
  persistState();
  showToast("已載入虛構範例。", true);
  document.querySelector("#review").scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearForm() {
  undoState = collectState();
  form.reset();
  document.querySelector("#reviewDate").value = todayString();
  consistencyRows.replaceChildren();
  Array.from({ length: 4 }, () => createConsistencyRow());
  clearValidationMarks();
  updateScores();
  persistState();
  showToast("表單已清空。", true);
}

function undoLastReplace() {
  if (!undoState) return;
  applyState(undoState);
  persistState();
  undoState = null;
  toast.hidden = true;
  window.clearTimeout(toastTimer);
}

function addRowAndFocus() {
  const row = createConsistencyRow();
  row.querySelector('[data-field="item"]').focus();
  scheduleSave();
  updateScores();
}

function initialize() {
  buildScoreGroups();
  buildNegativeTags();
  const savedState = loadSavedState();
  applyState(savedState);

  if (savedState) {
    saveState.classList.add("is-saved");
    saveState.querySelector("span:last-child").textContent = "已恢復上次內容";
  }

  form.addEventListener("input", (event) => {
    event.target.closest(".field")?.classList.remove("has-error");
    if (event.target.matches('input[type="radio"]')) {
      event.target.closest(".rating-row")?.classList.remove("has-error");
    }
    scheduleSave();
    updateScores();
  });
  form.addEventListener("change", () => {
    scheduleSave();
    updateScores();
  });

  consistencyRows.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-row]");
    if (!remove) return;
    const row = remove.closest(".consistency-row");
    undoState = collectState();
    row.remove();
    if (!consistencyRows.children.length) createConsistencyRow();
    updateScores();
    persistState();
    showToast("已移除核對項目。", true);
  });

  document.querySelector("#addConsistencyRow").addEventListener("click", addRowAndFocus);
  document.querySelector("#addConsistencyRowBottom").addEventListener("click", addRowAndFocus);
  document.querySelector("#downloadMarkdown").addEventListener("click", downloadMarkdown);
  document.querySelector("#dockDownload").addEventListener("click", downloadMarkdown);
  document.querySelector("#copyMarkdown").addEventListener("click", copyMarkdown);
  document.querySelector("#printForm").addEventListener("click", () => window.print());
  document.querySelector("#clearForm").addEventListener("click", clearForm);
  document.querySelector("#loadExample").addEventListener("click", loadExample);
  toastAction.addEventListener("click", undoLastReplace);
}

initialize();
