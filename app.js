// HARD singleton guard (prevents double-init even if app.js executes twice)
if (window.__SAT_SIM_RUNNING__) {
  console.warn("[SAT] app.js executed again — ignoring to prevent re-init.");
  // Stop here so a second copy can't reset state/timer/current question.
  throw new Error("SAT_SIM_DUPLICATE_EXECUTION_BLOCKED");
}
window.__SAT_SIM_RUNNING__ = true;
window.__SAT_SIM_BOOT_ID__ = (window.__SAT_SIM_BOOT_ID__ || 0) + 1;
console.log("[SAT] Boot instance:", window.__SAT_SIM_BOOT_ID__);
let data;
let current = 0;
let answers = {}; // { [questionId]: { type: "mcq", value: 2 } OR { type:"gridin", value:"12" } }
let flagged = {};
let timeLeft = 0;
let timerInterval;
let isReady = false;
let appInitialized = false;
let loadInFlight = false;
let timeMultiplier = 1; // default normal time
let postSubmitIndex = null; // built at submit: { items: [...], filter: {...} }
let resultsSummaryHTML = "";
let reviewIndices = [];
let reviewPointer = 0;
let reviewReveal = false;
let missedIndexes = [];
let missedPointer = -1;
let isPracticeMode = false;
let practiceQuestionPool = [];
let practiceSidebarTree = {};
let practiceSelectionLabel = "";
let practiceCurrentDomain = "";
let practiceCurrentTopic = "";
let practiceCurrentLevel = "All";
let collapsedPracticeDomains = {};

function formatSkill(s) {
  if (!s) return "";
  if (typeof s === "string") return s;
  const parts = [s.domain, s.topic, s.subtopic, s.skill].filter(Boolean);
  return parts.join(" — ");
}
function getDomain(skill) {
  if (!skill) return "Uncategorized";
  if (typeof skill === "string") return skill; // fallback
  return skill.domain || "Uncategorized";
}
function getTopic(skill) {
  if (!skill || typeof skill === "string") return "General";
  return skill.topic || "General";
}

function getLeafSkill(skill) {
  if (!skill || typeof skill === "string") return "General";
  return skill.skill || "General";
}
function ensurePracticeDomainCollapseState() {
  if (!practiceSidebarTree) return;

  Object.keys(practiceSidebarTree).forEach(domain => {
    if (!(domain in collapsedPracticeDomains)) {
      collapsedPracticeDomains[domain] = false;
    }
  });
}
function typesetMath() {
  if (!window.MathJax) return;

  if (typeof MathJax.typesetPromise === "function") {
    MathJax.typesetPromise();
  } else if (typeof MathJax.typeset === "function") {
    MathJax.typeset();
  }
}
function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function getQuestionLevelLabel(q) {
  if (!q) return "";
  if (q.level === undefined || q.level === null || q.level === "") return "";
  return `Level ${q.level}`;
}

function shouldShowPracticeLevelBadge(q) {
  return Boolean(isPracticeMode && getQuestionLevelLabel(q));
}

function buildPracticeLevelBadgeHTML(q) {
  if (!shouldShowPracticeLevelBadge(q)) return "";
  return `<div class="question-level-badge">${escapeHTML(getQuestionLevelLabel(q))}</div>`;
}
function showValidationOverlay(report) {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  const errorItems = report.errors.map(msg =>
    `<li style="margin:6px 0;">${escapeHTML(msg)}</li>`
  ).join("");

  const warningItems = report.warnings.map(msg =>
    `<li style="margin:6px 0;">${escapeHTML(msg)}</li>`
  ).join("");

  overlay.innerHTML = `
    <div style="
      max-width: 900px;
      width: min(900px, 92vw);
      max-height: 85vh;
      overflow: auto;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      text-align: left;
    ">
      <div style="font-weight: 800; font-size: 22px; margin-bottom: 8px; color: #b00020;">
        questions.json failed validation
      </div>

      <div style="color:#444; margin-bottom:16px; line-height:1.5;">
        Fix the blocking errors below before starting the simulator.
      </div>

      <div style="
        display:inline-block;
        padding:6px 10px;
        border-radius:999px;
        background:#fee2e2;
        color:#991b1b;
        font-weight:700;
        margin-right:8px;
      ">
        Errors: ${report.errors.length}
      </div>

      <div style="
        display:inline-block;
        padding:6px 10px;
        border-radius:999px;
        background:#fef3c7;
        color:#92400e;
        font-weight:700;
      ">
        Warnings: ${report.warnings.length}
      </div>

      <div style="margin-top:22px;">
        <div style="font-weight:700; margin-bottom:8px; color:#991b1b;">Blocking Errors</div>
        ${
          report.errors.length
            ? `<ul style="margin:0; padding-left:20px;">${errorItems}</ul>`
            : `<div style="color:#666;">None</div>`
        }
      </div>

      <div style="margin-top:22px;">
        <div style="font-weight:700; margin-bottom:8px; color:#92400e;">Warnings</div>
        ${
          report.warnings.length
            ? `<ul style="margin:0; padding-left:20px;">${warningItems}</ul>`
            : `<div style="color:#666;">None</div>`
        }
      </div>
    </div>
  `;

  overlay.style.display = "flex";
}

function validateQuestionBank(bank) {
  const errors = [];
  const warnings = [];

  if (!bank || typeof bank !== "object" || Array.isArray(bank)) {
    errors.push("Root JSON must be an object.");
    return { ok: false, errors, warnings };
  }

  if (typeof bank.moduleId !== "string" || !bank.moduleId.trim()) {
    errors.push("Missing or invalid root field: moduleId must be a non-empty string.");
  }

  if (!Number.isFinite(bank.timeSeconds) || bank.timeSeconds <= 0) {
    errors.push("Missing or invalid root field: timeSeconds must be a positive number.");
  }

  if (!Array.isArray(bank.questions)) {
    errors.push("Missing or invalid root field: questions must be an array.");
    return { ok: false, errors, warnings };
  }

  if (bank.questions.length === 0) {
    warnings.push("Question bank contains 0 questions.");
  }

  const seenIds = new Set();

  bank.questions.forEach((rawQ, index) => {
    const label = `Question ${index + 1}`;
    const q = rawQ || {};
    const type = q.type || "mcq";

    if (!q || typeof q !== "object" || Array.isArray(q)) {
      errors.push(`${label}: must be an object.`);
      return;
    }

    if (typeof q.id !== "string" || !q.id.trim()) {
      errors.push(`${label}: missing or invalid id.`);
    } else {
      if (seenIds.has(q.id)) {
        errors.push(`${label}: duplicate id "${q.id}".`);
      }
      seenIds.add(q.id);
    }

    if (type !== "mcq" && type !== "gridin") {
      errors.push(`${label} (${q.id || "no id"}): unsupported type "${type}". Allowed types: mcq, gridin.`);
    }

    if (typeof q.stem !== "string" || !q.stem.trim()) {
      errors.push(`${label} (${q.id || "no id"}): missing or invalid stem.`);
    }

    if (typeof q.explanation !== "string" || !q.explanation.trim()) {
      errors.push(`${label} (${q.id || "no id"}): missing or invalid explanation.`);
    }

    if (q.skill != null) {
      if (typeof q.skill === "object" && !Array.isArray(q.skill)) {
        if ("domain" in q.skill && !String(q.skill.domain || "").trim()) {
          warnings.push(`${label} (${q.id || "no id"}): skill.domain is blank.`);
        }
        if ("topic" in q.skill && !String(q.skill.topic || "").trim()) {
          warnings.push(`${label} (${q.id || "no id"}): skill.topic is blank.`);
        }
        if ("skill" in q.skill && !String(q.skill.skill || "").trim()) {
          warnings.push(`${label} (${q.id || "no id"}): skill.skill is blank.`);
        }
      } else if (typeof q.skill !== "string") {
        warnings.push(`${label} (${q.id || "no id"}): skill should be a string or object.`);
      }
    }

    if (type === "mcq") {
      if (!Array.isArray(q.choices)) {
        errors.push(`${label} (${q.id || "no id"}): mcq question must include choices array.`);
      } else {
        if (q.choices.length !== 4) {
          errors.push(`${label} (${q.id || "no id"}): mcq must have exactly 4 choices.`);
        }

        const normalizedChoices = q.choices.map(c => String(c ?? "").trim());

        normalizedChoices.forEach((choice, choiceIndex) => {
          if (!choice) {
            errors.push(`${label} (${q.id || "no id"}): choice ${choiceIndex} is blank.`);
          }
        });

        const dupChoiceSet = new Set();
        normalizedChoices.forEach(choice => {
          if (!choice) return;
          if (dupChoiceSet.has(choice)) {
            warnings.push(`${label} (${q.id || "no id"}): duplicate choice text "${choice}".`);
          } else {
            dupChoiceSet.add(choice);
          }
        });
      }

      if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) {
        errors.push(`${label} (${q.id || "no id"}): mcq answerIndex must be an integer from 0 to 3.`);
      }
    }

    if (type === "gridin") {
      if (typeof q.answer !== "string" || !q.answer.trim()) {
        errors.push(`${label} (${q.id || "no id"}): gridin question must include non-empty answer string.`);
      }

      if (q.answersAccepted != null) {
        if (!Array.isArray(q.answersAccepted)) {
          errors.push(`${label} (${q.id || "no id"}): answersAccepted must be an array when provided.`);
        } else {
          q.answersAccepted.forEach((ans, ansIndex) => {
            if (typeof ans !== "string" || !ans.trim()) {
              errors.push(`${label} (${q.id || "no id"}): answersAccepted[${ansIndex}] must be a non-empty string.`);
            }
          });
        }
      }

      if (q.validation != null) {
        if (typeof q.validation !== "object" || Array.isArray(q.validation)) {
          errors.push(`${label} (${q.id || "no id"}): validation must be an object when provided.`);
        } else {
          if (q.validation.maxChars != null) {
            if (!Number.isInteger(q.validation.maxChars) || q.validation.maxChars <= 0) {
              errors.push(`${label} (${q.id || "no id"}): validation.maxChars must be a positive integer.`);
            }
          }

          const boolFields = ["allowNegative", "allowDecimal", "allowFraction"];
          boolFields.forEach(field => {
            if (q.validation[field] != null && typeof q.validation[field] !== "boolean") {
              errors.push(`${label} (${q.id || "no id"}): validation.${field} must be boolean.`);
            }
          });
        }
      }
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
function validateQuestions(json) {
  const errors = [];
  const ids = new Set();

  if (!json || typeof json !== "object") {
    errors.push("questions.json is not a valid object.");
    return errors;
  }

  if (!Array.isArray(json.questions)) {
    errors.push('"questions" must be an array.');
    return errors;
  }

  json.questions.forEach((q, index) => {
    const label = `Question ${index + 1}`;

    if (!q.id) errors.push(`${label}: missing id`);
    else if (ids.has(q.id)) errors.push(`${label}: duplicate id "${q.id}"`);
    else ids.add(q.id);

    if (!q.type) errors.push(`${label} (${q.id}): missing type`);

    if (!q.stem) errors.push(`${label} (${q.id}): missing stem`);

    if (!q.skill) errors.push(`${label} (${q.id}): missing skill`);

    if (q.type === "mcq") {
      if (!Array.isArray(q.choices))
        errors.push(`${label} (${q.id}): MCQ missing choices`);

      if (typeof q.answerIndex !== "number")
        errors.push(`${label} (${q.id}): MCQ missing answerIndex`);
    }

    if (q.type === "gridin") {
      if (q.answer === undefined || q.answer === "")
        errors.push(`${label} (${q.id}): gridin missing answer`);
    }
  });

  return errors;
}

function loadData() {
  // global one-time init lock (survives duplicate script evaluation)
  if (window.__SAT_SIM_DATA_LOADED__) return;
  if (window.__SAT_SIM_LOAD_IN_FLIGHT__) return;
  window.__SAT_SIM_LOAD_IN_FLIGHT__ = true;

  // keep buttons locked until ready
  isReady = false;
const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "test";

const file = mode === "practice" ? "practice.json" : "questions.json";

console.log("Mode:", mode, "File:", file);

fetch(file)
    .then(res => res.json())
    .then(json => {
      if (window.__SAT_SIM_DATA_LOADED__) return;

      // normalize missing type before validation
      json.questions = Array.isArray(json.questions)
        ? json.questions.map(q => ({ type: q?.type || "mcq", ...q }))
        : json.questions;

      const report = validateQuestionBank(json);

      if (!report.ok) {
        console.error("questions.json validation failed", report);
        appInitialized = false;
        isReady = false;
        showValidationOverlay(report);
        return;
      }

      if (report.warnings.length) {
        console.warn("questions.json validation warnings", report.warnings);
      }

      window.__SAT_SIM_DATA_LOADED__ = true;

      data = json;
      isPracticeMode = data.mode === "practice" || mode === "practice";
      document.body.classList.toggle("practice-mode", isPracticeMode);
      if (isPracticeMode) {
      document.getElementById("practiceSidebar").style.display = "block";
}
      current = 0;
      answers = {};
      flagged = {};
timeLeft = Math.floor((data.timeSeconds || 0) * timeMultiplier);
if (isPracticeMode) {
  practiceQuestionPool = [...data.questions];
  practiceSidebarTree = buildPracticeSidebarTree(practiceQuestionPool);
}

if (mode === "test") {
  startTimer();
} else {
  document.getElementById("timer").innerText = "--:--";
}

renderQuestion();
renderPracticeSidebar();
renderPracticeFilters();

      appInitialized = true;
      isReady = true;

      document.getElementById("prevBtn").disabled = false;
      document.getElementById("nextBtn").disabled = false;
      document.getElementById("submitBtn").disabled = false;
      document.getElementById("loadingOverlay").style.display = "none";
    })
    .catch(err => {
      console.error("Failed to load questions.json", err);
      appInitialized = false;
      isReady = false;
      document.getElementById("loadingOverlay").innerHTML =
        "<div style='text-align:center;'><div style='font-weight:700;font-size:18px;margin-bottom:8px;'>Could not load questions.</div><div style='color:#666;font-size:14px;'>Check Live Server and questions.json.</div></div>";
    })
    .finally(() => {
      window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;
    });
}
function showExplanation(index) {
  const q = data.questions[index];
  const box = document.getElementById(`exp-${index}`);
  if (!box) return;

  // IMPORTANT: use innerHTML so tags + MathJax delimiters are interpreted
  box.innerHTML = q.explanation || "<em>No explanation provided.</em>";
  box.style.display = "block";

  typesetMath();
}
function startTimer() {
  if (window.__SAT_SIM_TIMER_INTERVAL__) {
    clearInterval(window.__SAT_SIM_TIMER_INTERVAL__);
  }

  updateTimerDisplay();

  window.__SAT_SIM_TIMER_INTERVAL__ = setInterval(() => {
    timeLeft = Math.max(0, timeLeft - 1);
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(window.__SAT_SIM_TIMER_INTERVAL__);
      window.__SAT_SIM_TIMER_INTERVAL__ = null;
      submitTest();
    }
  }, 1000);
}
function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  document.getElementById("timer").innerText =
    `${m}:${s.toString().padStart(2, '0')}`;
}
function renderProgress() {
  const el = document.getElementById("progress");
  if (!el || !data?.questions) return;

  el.innerHTML = data.questions.map((q, i) => {
    const isCurrent = i === current;
    const isAnswered = answers[q.id] != null;
    const isFlagged = flagged[q.id] === true;

    const flagIcon = isFlagged ? "⚑" : "";
return `
<div class="pill ${isCurrent ? "current" : ""} ${isAnswered ? "answered" : ""} ${isFlagged ? "flagged" : ""}" onclick="jumpTo(${i})">
  ${i + 1}
  ${isFlagged ? `<span class="flagMark">⚑</span>` : ""}
</div>`;
  }).join("");
}

function jumpTo(i) {
  if (!isReady) return;
  if (i < 0 || i >= data.questions.length) return;
  current = i;
  renderQuestion();
}
function renderQuestion() {
  const q = data.questions[current];
  const flagBtn = document.getElementById("flagBtn");
if (flagBtn) {
  if (flagged[q.id]) {
    flagBtn.textContent = "Unflag";
    flagBtn.style.background = "#fff3cd";
    flagBtn.style.borderColor = "#f59e0b";
  } else {
    flagBtn.textContent = "Flag";
    flagBtn.style.background = "white";
    flagBtn.style.borderColor = "var(--border)";
  }
}
  renderProgress();
  const levelBadgeHTML = buildPracticeLevelBadgeHTML(q);

document.getElementById("question").innerHTML =
  `<div class="q-header">
     <div class="q-header-left">
       <div class="q-num">Question ${current + 1} of ${data.questions.length}</div>
     </div>
     <div class="q-header-right">
       ${levelBadgeHTML}
     </div>
   </div>
   <div class="q-stem">${q.stem}</div>`;

  const choicesDiv = document.getElementById("choices");
choicesDiv.innerHTML = "";
choicesDiv.className = "";

if (q.type === "mcq") {
  choicesDiv.classList.add("choices-mcq");
} else if (q.type === "gridin") {
  choicesDiv.classList.add("choices-gridin");
}

  if (q.type === "mcq") {
    renderMCQ(q, choicesDiv);
  } else if (q.type === "gridin") {
    renderGridIn(q, choicesDiv);
  } else {
    choicesDiv.innerHTML = `<div style="margin-top:16px;color:#b00;">Unknown question type: ${q.type}</div>`;
  }

  typesetMath();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderMCQ(q, container) {
  const letters = ["A", "B", "C", "D"];
  const saved = answers[q.id]?.value;

  q.choices.forEach((choice, index) => {
    const row = document.createElement("div");
    row.className = "choiceRow";
    if (saved === index) row.classList.add("selected");

    const badge = document.createElement("div");
    badge.className = "choiceLetter";
    badge.textContent = letters[index];

    const text = document.createElement("div");
    text.className = "choiceText";
    text.innerHTML = choice;

    row.appendChild(badge);
    row.appendChild(text);

    row.onclick = () => {
      answers[q.id] = { type: "mcq", value: index };
      renderQuestion();
    };

    container.appendChild(row);
  });
}

function renderGridIn(q, container) {
  const wrapper = document.createElement("div");
  wrapper.style.marginTop = "18px";

  const label = document.createElement("div");
  label.style.fontWeight = "600";
  label.style.marginBottom = "8px";
  label.textContent = "Enter your answer:";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type answer here";
  input.style.width = "100%";
  input.style.boxSizing = "border-box";
  input.style.padding = "12px 14px";
  input.style.fontSize = "16px";
  input.style.borderRadius = "12px";
  input.style.border = "1px solid #d0d0d0";

  const saved = answers[q.id]?.value ?? "";
  input.value = saved;

  // basic validation guidance (not strict yet)
  const hint = document.createElement("div");
  hint.style.color = "#666";
  hint.style.fontSize = "13px";
  hint.style.marginTop = "8px";
  hint.textContent = buildValidationHint(q.validation);

  input.addEventListener("input", () => {
    const v = input.value;
    answers[q.id] = { type: "gridin", value: v };
  });

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  wrapper.appendChild(hint);
  container.appendChild(wrapper);
  if (!saved) input.focus();
}

function buildValidationHint(v) {
  if (!v) return "Numbers only. Fractions/decimals may be allowed depending on the question.";
  const parts = [];
  if (v.allowFraction) parts.push("fractions allowed");
  if (v.allowDecimal) parts.push("decimals allowed");
  if (!v.allowNegative) parts.push("no negative");
  if (v.maxChars) parts.push(`max ${v.maxChars} chars`);
  return parts.length ? `Format: ${parts.join(" • ")}` : "";
}

function nextQuestion() {
  if (!isReady) return;
  if (current < data.questions.length - 1) {
    current++;
    renderQuestion();
  }
}

function prevQuestion() {
  if (!isReady) return;
  if (current > 0) {
    current--;
    renderQuestion();
  }
}
function toggleFlag() {
  const q = data.questions[current];
  if (flagged[q.id]) delete flagged[q.id];
  else flagged[q.id] = true;

  renderQuestion(); // updates button + pills
}
function openQuestionMap() {
  const modal = document.getElementById("questionMapModal");
  modal.style.display = "flex";
  renderQuestionMap();
}

function closeQuestionMap() {
  const modal = document.getElementById("questionMapModal");
  modal.style.display = "none";
}

function renderQuestionMap() {
  const grid = document.getElementById("questionMapGrid");

  grid.innerHTML = data.questions.map((q, i) => {

    const isAnswered = answers[q.id] != null;
    const isFlagged = flagged[q.id];
    const isCurrent = i === current;

    return `
      <div
        class="mapPill
        ${isAnswered ? "answered" : ""}
        ${isFlagged ? "flagged" : ""}
        ${isCurrent ? "current" : ""}"
        onclick="jumpTo(${i}); closeQuestionMap();"
      >
        ${i + 1}
      </div>
    `;

  }).join("");
}
function normalizeGridIn(s) {
  // Basic normalization: trim spaces
  return (s ?? "").toString().trim();
}

function isGridInCorrect(q, userValue) {
  const uv = normalizeGridIn(userValue);
  if (!uv) return false;

  // Accept exact matches against answer or answersAccepted
  const accepted = new Set([q.answer, ...(q.answersAccepted || [])].map(normalizeGridIn));
  return accepted.has(uv);
}
function buildPostSubmitIndex() {
  const items = data.questions.map((q, index) => {
    const domain = getDomain(q.skill);
    const topic = getTopic(q.skill);
    const leaf = getLeafSkill(q.skill);

    const a = answers[q.id];
    let correct = false;
    if (q.type === "mcq") correct = a && a.value === q.answerIndex;
    else if (q.type === "gridin") correct = a && isGridInCorrect(q, a.value);

    return {
      index,
      id: q.id,
      domain,
      topic,
      skill: leaf,
      correct,
      flagged: !!flagged[q.id],
      type: q.type
    };
  });

  return {
    items,
    filter: {
      domain: null,
      topic: null,
      skill: null,
      missedOnly: true
    }
  };
}

function applySkillFilter({ domain = null, topic = null, skill = null, missedOnly = true } = {}) {
  if (!postSubmitIndex) return;
  postSubmitIndex.filter = { domain, topic, skill, missedOnly };
  renderFilteredList();
}

function renderFilteredList() {
  const box = document.getElementById("filteredList");
  const title = document.getElementById("filteredTitle");
  if (!box || !title || !postSubmitIndex) return;

  const { items, filter } = postSubmitIndex;

  const labelParts = [];
  if (filter.domain) labelParts.push(filter.domain);
  if (filter.topic) labelParts.push(filter.topic);
  if (filter.skill) labelParts.push(filter.skill);
  const label = labelParts.length ? labelParts.join(" — ") : "All Skills";

  title.textContent = `${label} • ${filter.missedOnly ? "Missed only" : "All questions"}`;

  const filtered = items.filter(it => {
    if (filter.domain && it.domain !== filter.domain) return false;
    if (filter.topic && it.topic !== filter.topic) return false;
    if (filter.skill && it.skill !== filter.skill) return false;
    if (filter.missedOnly && it.correct) return false;
    return true;
  });

  if (!filtered.length) {
    box.innerHTML = `<div style="color:#666;padding:8px 0;">No questions match this filter.</div>`;
    return;
  }

  box.innerHTML = filtered.map(it => {
    const icon = it.correct ? "✅" : "❌";
    const flag = it.flagged ? " ⚑" : "";
    return `
      <div
        onclick="scrollToReviewCard(${it.index})"
        style="display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #e6e6e6;border-radius:10px;cursor:pointer;background:#fff;margin:8px 0;"
      >
        <div style="font-weight:700;">Q${it.index + 1} ${icon}${flag}</div>
        <div style="color:#666;flex:1;text-align:right;">${it.skill}</div>
      </div>
    `;
  }).join("");
}

function scrollToReviewCard(index) {
  const el = document.getElementById(`review-q-${index}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function isQuestionCorrect(q) {
  const a = answers[q.id];
  if (!a) return false;

  if (q.type === "mcq") {
    return a.value === q.answerIndex;
  } else if (q.type === "gridin") {
    return isGridInCorrect(q, a.value);
  }

  return false;
}

function getUserAnswerText(q) {
  const a = answers[q.id];

  if (!a) return "Unanswered";

  if (q.type === "mcq") {
    const letters = ["A", "B", "C", "D"];
    const idx = a.value;
    const choiceText = q.choices?.[idx] ?? "";
    return `${letters[idx] || "?"}. ${stripHTML(choiceText)}`;
  }

  if (q.type === "gridin") {
    return a.value?.toString().trim() || "Unanswered";
  }

  return "Unanswered";
}

function getCorrectAnswerText(q) {
  if (q.type === "mcq") {
    const letters = ["A", "B", "C", "D"];
    const idx = q.answerIndex;
    const choiceText = q.choices?.[idx] ?? "";
    return `${letters[idx] || "?"}. ${stripHTML(choiceText)}`;
  }

  if (q.type === "gridin") {
    const accepted = [q.answer, ...(q.answersAccepted || [])]
      .filter(Boolean)
      .map(v => v.toString().trim());

    return accepted.join(", ");
  }

  return "";
}

function stripHTML(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || div.innerText || "";
}

function startReview(mode) {
  if (mode === "missed") {
    reviewIndices = data.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => !isQuestionCorrect(q))
      .map(({ i }) => i);

    if (reviewIndices.length === 0) {
      document.body.innerHTML = `
        <div style="max-width:900px;margin:40px auto;font-family:system-ui;">
          <h1>Great work 🎉</h1>
          <div class="scoreBanner" style="text-align:center;">
            <div class="scoreMain">No missed questions</div>
            <div class="scoreSub">You earned points on every question in this module.</div>
            <div style="margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
              <button class="reviewMissedBtn" onclick="backToSummary()">Back to Summary</button>
              <button class="reviewMissedBtn secondary" onclick="startReview('all')">Review all questions</button>
            </div>
          </div>
        </div>
      `;
      return;
    }
  } else {
    reviewIndices = data.questions.map((q, i) => i);
  }

  reviewPointer = 0;
  reviewReveal = false;
  renderReviewScreen(mode);
}

function renderReviewScreen(mode) {
  const index = reviewIndices[reviewPointer];
  const q = data.questions[index];
  const correct = isQuestionCorrect(q);
  const userAnswer = getUserAnswerText(q);

  const reviewLabel =
    mode === "missed"
      ? `Missed Question ${reviewPointer + 1} of ${reviewIndices.length}`
      : `Question ${reviewPointer + 1} of ${reviewIndices.length}`;

  let answerHTML = "";

  if (q.type === "mcq") {
    const letters = ["A", "B", "C", "D"];
    const selected = answers[q.id]?.value;

answerHTML = q.choices.map((choice, idx) => {
  const isSelected = selected === idx;
  const isCorrectChoice = idx === q.answerIndex;

  let rowClass = "choiceRow";
  if (isSelected) rowClass += " selected";
  if (reviewReveal && isCorrectChoice) rowClass += " correctReveal";

  return `
    <div class="${rowClass}" style="cursor:default;">
      <div class="choiceLetter">${letters[idx]}</div>
      <div class="choiceText">${choice}</div>
    </div>
  `;
}).join("");
  } else if (q.type === "gridin") {
    answerHTML = `
      <div style="margin-top:18px;">
        <div style="font-weight:600;margin-bottom:8px;">Your entered answer:</div>
        <div class="reviewGridAnswer">${userAnswer}</div>
      </div>
    `;
  }

  let revealHTML = `
    <button class="reviewMissedBtn" onclick="revealReviewAnswer()">
      Reveal Answer & Explanation
    </button>
  `;

  if (reviewReveal) {
    revealHTML += `
      <div class="reviewRevealBox">
        <div id="reviewExplanation" style="margin-top:12px;">
          ${q.explanation || "<em>No explanation provided.</em>"}
        </div>
      </div>
    `;
  }

  document.body.innerHTML = `
    <div style="max-width:900px;margin:40px auto;font-family:system-ui;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
        <button class="reviewMissedBtn secondary" onclick="backToSummary()">Back to Summary</button>
        <div style="font-weight:800;">${reviewLabel}</div>
      </div>

      <div class="scoreBanner" style="text-align:left;">
        <div class="q-header">
          <div class="q-num">Question ${index + 1} of ${data.questions.length}</div>
          <div class="q-skill">${formatSkill(q.skill)}</div>
        </div>

        <div style="font-weight:800;margin-bottom:10px;">
          ${correct ? "✅ Correct" : "❌ Incorrect"}
        </div>
        <div class="q-stem">${q.stem}</div>

        <div id="reviewAnswerArea" style="margin-top:18px;">
          ${answerHTML}
        </div>

        <div style="margin-top:18px;">
          ${revealHTML}
        </div>

        <div class="reviewNavRow">
          <button class="reviewMissedBtn secondary" onclick="reviewPrev('${mode}')">Prev</button>
          <button class="reviewMissedBtn secondary" onclick="reviewNext('${mode}')">Next</button>
        </div>
      </div>
    </div>
  `;

  typesetMath();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function revealReviewAnswer() {
  reviewReveal = true;
  const mode = reviewIndices.length === data.questions.length ? "all" : "missed";
  renderReviewScreen(mode);

  setTimeout(() => {
    const el = document.getElementById("reviewExplanation");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}
function reviewPrev(mode) {
  if (!reviewIndices.length) return;
  reviewPointer = Math.max(0, reviewPointer - 1);
  reviewReveal = false;
  renderReviewScreen(mode);
}

function reviewNext(mode) {
  if (!reviewIndices.length) return;
  reviewPointer = Math.min(reviewIndices.length - 1, reviewPointer + 1);
  reviewReveal = false;
  renderReviewScreen(mode);
}

function backToSummary() {
  document.body.innerHTML = resultsSummaryHTML;
  renderScoreBanner();
  typesetMath();
}

function renderScoreBanner() {
  const total = data.questions.length;
  const score = data.questions.filter(q => isQuestionCorrect(q)).length;
  const answeredCount = Object.keys(answers).length;
  const unanswered = total - answeredCount;
  const incorrect = total - score - unanswered;
  const pct = Math.round((score / total) * 100);

  const el = document.getElementById("scoreSummary");
  if (!el) return;

  el.innerHTML = `
    <div class="scoreTopRow">
      <div class="scoreMain">${score} correct</div>
      <div class="scorePercent">${pct}%</div>
    </div>

    <div class="scoreSub">${incorrect} incorrect • ${unanswered} unanswered</div>

    <div class="scoreBar">
      <div class="scoreBarFill" style="width:${pct}%"></div>
    </div>

    <div class="summaryReviewButtons">
      <button class="reviewMissedBtn" onclick="startReview('missed')">Review missed questions</button>
      <button class="reviewMissedBtn secondary" onclick="startReview('all')">Review all questions</button>
    </div>
  `;
}
function openCalculator() {
  const drawer = document.getElementById("calculatorDrawer");
  if (!drawer) return;
  drawer.classList.add("open");
}

function closeCalculator() {
  const drawer = document.getElementById("calculatorDrawer");
  if (!drawer) return;
  drawer.classList.remove("open");
}
function buildPracticeSidebarTree(questions) {
  const tree = {};

  questions.forEach((q, index) => {
    const domain = q?.skill?.domain || "Uncategorized";
    const topic = q?.skill?.topic || "General";
    const level = `Level ${q.level ?? "?"}`;

    if (!tree[domain]) tree[domain] = {};
    if (!tree[domain][topic]) tree[domain][topic] = {};
    if (!tree[domain][topic][level]) tree[domain][topic][level] = [];

    tree[domain][topic][level].push({
      index,
      id: q.id,
      question: q
    });
  });

  return tree;
}
function ensurePracticeDomainCollapseState() {
  if (!practiceSidebarTree) return;

  Object.keys(practiceSidebarTree).forEach(domain => {
    if (!(domain in collapsedPracticeDomains)) {
      collapsedPracticeDomains[domain] = false;
    }
  });
}
function togglePracticeDomain(domain) {
  if (!domain) return;
  collapsedPracticeDomains[domain] = !collapsedPracticeDomains[domain];
  renderPracticeSidebar();
}
function renderPracticeSidebar() {
  if (!isPracticeMode) return;

  const sidebar = document.getElementById("practiceSidebar");
  if (!sidebar) return;

  ensurePracticeDomainCollapseState();

  let html = `
  <div class="practice-sidebar-card">
    <div class="practice-sidebar-header">
      <span class="practice-sidebar-title">Practice Navigator</span>
    </div>
`;
  if (practiceSelectionLabel) {
    html += `
      <div class="practice-sidebar-subhead">Now practicing</div>
      <div class="practice-sidebar-current">${practiceSelectionLabel.replaceAll(" → ", " · ")}</div>
    `;
  }

  Object.entries(practiceSidebarTree).forEach(([domain, topics]) => {
    const isCollapsed = !!collapsedPracticeDomains[domain];
    const domainCount = Object.values(topics).reduce((domainSum, levelMap) => {
      return domainSum + Object.values(levelMap).reduce((topicSum, arr) => topicSum + arr.length, 0);
    }, 0);

    const isDomainActive =
  practiceCurrentDomain === domain;

  html += `
  <div class="sidebar-domain-block">
    <div class="sidebar-domain-row">
      <button
        type="button"
        class="sidebar-domain-toggle"
        onclick='togglePracticeDomain(${JSON.stringify(domain)})'
        aria-label="Toggle ${domain}"
      >
        <span class="sidebar-domain-chevron">${isCollapsed ? "▸" : "▾"}</span>
      </button>

      <button
        type="button"
        class="sidebar-domain-btn ${isDomainActive ? "active" : ""}"
        onclick='selectPracticeDomain(${JSON.stringify(domain)})'
      >
        <span class="sidebar-domain-name">${domain}</span>
        <span class="sidebar-domain-count">${domainCount}</span>
      </button>
    </div>

    <div class="sidebar-domain-topics" style="display:${isCollapsed ? "none" : "block"};">
`;

    Object.entries(topics).forEach(([topic, levels]) => {
      const topicCount = Object.values(levels).reduce((sum, arr) => sum + arr.length, 0);

      const isTopicActive =
        practiceCurrentDomain === domain &&
        practiceCurrentTopic === topic;

      html += `
        <button
          type="button"
          class="sidebar-topic-btn ${isTopicActive ? "active" : ""}"
          onclick='selectPracticeTopic(${JSON.stringify(domain)}, ${JSON.stringify(topic)})'
        >
          <span class="sidebar-topic-name">${topic}</span>
          <span class="sidebar-topic-count">${topicCount}</span>
        </button>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`;

  sidebar.innerHTML = html;
}
function togglePracticeDomain(domain) {
  if (!domain) return;
  collapsedPracticeDomains[domain] = !collapsedPracticeDomains[domain];
  renderPracticeSidebar();
}
function selectPracticeDomain(domain) {
  const topics = practiceSidebarTree?.[domain];
  if (!topics) return;

  let domainQuestions = [];

  Object.values(topics).forEach(levelMap => {
    Object.values(levelMap).forEach(levelArr => {
      levelArr.forEach(q => domainQuestions.push(q.question));
    });
  });

  data.questions = domainQuestions;

  current = 0;
  answers = {};
  flagged = {};

  practiceCurrentDomain = domain;
  practiceCurrentTopic = "";
  practiceCurrentLevel = "All";

  practiceSelectionLabel = domain;
  collapsedPracticeDomains[domain] = false;

  renderQuestion();
  renderPracticeSidebar();
  renderPracticeFilters();
}
function selectPracticeTopic(domain, topic) {
  console.log("Clicked topic:", domain, topic);
  
  const topicLevels = practiceSidebarTree?.[domain]?.[topic];
  if (!topicLevels) return;
  collapsedPracticeDomains[domain] = false;

  let topicQuestions = [];

  Object.values(topicLevels).forEach(levelArr => {
    levelArr.forEach(q => topicQuestions.push(q.question));
  });

  data.questions = topicQuestions;

  current = 0;
  answers = {};
  flagged = {};

  practiceCurrentDomain = domain;
  practiceCurrentTopic = topic;
  practiceCurrentLevel = "All";

  practiceSelectionLabel = `${domain} → ${topic}`;

  renderQuestion();
  renderPracticeSidebar();
  renderPracticeFilters();
}
function renderPracticeFilters() {
  const filters = document.getElementById("practiceFilters");
  if (!filters) return;

  if (!isPracticeMode || !practiceCurrentTopic) {
    filters.style.display = "none";
    filters.innerHTML = "";
    return;
  }

  filters.style.display = "flex";

  const levels = ["All", "Level 1", "Level 2", "Level 3"];

  filters.innerHTML = `
    <div class="practice-filter-label">Level:</div>
    ${levels.map(level => `
      <button
        class="practice-filter-btn ${practiceCurrentLevel === level ? "active" : ""}"
        onclick="selectPracticeLevelFilter(${JSON.stringify(level)})"
      >
        ${level}
      </button>
    `).join("")}
  `;
}
function selectPracticeLevelFilter(level) {
  if (!practiceCurrentDomain || !practiceCurrentTopic) return;
  collapsedPracticeDomains[practiceCurrentDomain] = false;

  practiceCurrentLevel = level;

  const topicLevels = practiceSidebarTree?.[practiceCurrentDomain]?.[practiceCurrentTopic];
  if (!topicLevels) return;

  let filteredQuestions = [];

  if (level === "All") {
    Object.values(topicLevels).forEach(levelArr => {
      levelArr.forEach(q => filteredQuestions.push(q.question));
    });
    practiceSelectionLabel = `${practiceCurrentDomain} → ${practiceCurrentTopic}`;
  } else {
    const levelQuestions = topicLevels[level] || [];
    filteredQuestions = levelQuestions.map(q => q.question);
    practiceSelectionLabel = `${practiceCurrentDomain} → ${practiceCurrentTopic} → ${level}`;
  }

  data.questions = filteredQuestions;
  current = 0;
  answers = {};
  flagged = {};

  renderQuestion();
  renderPracticeSidebar();
  renderPracticeFilters();
}
function submitTest() {
  if (!isReady) return;
  clearInterval(timerInterval);

  // Build nested skill tree: domain -> topic -> skill -> {correct,total}
  const tree = {};

  data.questions.forEach(q => {
    const domain = getDomain(q.skill);
    const topic = getTopic(q.skill);
    const leaf = getLeafSkill(q.skill);

    if (!tree[domain]) tree[domain] = {};
    if (!tree[domain][topic]) tree[domain][topic] = {};
    if (!tree[domain][topic][leaf]) tree[domain][topic][leaf] = { correct: 0, total: 0 };

    tree[domain][topic][leaf].total++;

    if (isQuestionCorrect(q)) {
      tree[domain][topic][leaf].correct++;
    }
  });

  let reviewHTML = `
    <div style="max-width:900px;margin:40px auto;font-family:system-ui;">
      <h1>Test Complete</h1>
      <div id="scoreSummary" class="scoreBanner"></div>
  `;

  // Skill Breakdown
  reviewHTML += `<h3 style="margin-top:20px;">Skill Breakdown</h3>`;
  reviewHTML += `<div class="skillBreakdownGrid">`;

  Object.entries(tree).forEach(([domain, topics]) => {
    let dCorrect = 0, dTotal = 0;
    Object.values(topics).forEach(skillsObj => {
      Object.values(skillsObj).forEach(st => {
        dCorrect += st.correct;
        dTotal += st.total;
      });
    });

    reviewHTML += `
      <div class="domainCard">
        <div class="domainRow">
          <span class="domainName">${domain}</span>
          <span class="scoreChip">${dCorrect} / ${dTotal}</span>
        </div>
    `;

    Object.entries(topics).forEach(([topic, skills]) => {
      if (!topic || !topic.trim()) return;

      let tCorrect = 0, tTotal = 0;
      Object.values(skills).forEach(st => {
        tCorrect += st.correct;
        tTotal += st.total;
      });

      reviewHTML += `
        <div class="topicRow">
          <span class="topicName">${topic}</span>
          <span class="scoreChip">${tCorrect} / ${tTotal}</span>
        </div>
      `;

      Object.entries(skills).forEach(([skillName, st]) => {
        if (!skillName || !skillName.trim()) return;

        reviewHTML += `
          <div class="skillRow">
            <span>${skillName}</span>
            <span class="scoreChip">${st.correct} / ${st.total}</span>
          </div>
        `;
      });
    });

    reviewHTML += `</div>`;
  });

  reviewHTML += `</div>`;
  reviewHTML += `</div>`;

  resultsSummaryHTML = reviewHTML;

  document.body.innerHTML = resultsSummaryHTML;
  renderScoreBanner();
  typesetMath();
}
function toggleExplanation(index) {
  const el = document.getElementById(`exp-${index}`);
  if (!el) return;

  if (el.style.display === "none") {
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }

  typesetMath();
}
document.addEventListener("keydown", (e) => {
  if (!isReady) return;
if (e.key === "Escape") {
  closeCalculator();
}
  const active = document.activeElement;
  if (active && active.tagName === "INPUT") return;

  const key = e.key.toLowerCase();

  if (key === "a" || key === "b" || key === "c" || key === "d") {
    const q = data.questions[current];
    if (!q || q.type !== "mcq") return;

    const map = { a: 0, b: 1, c: 2, d: 3 };
    answers[q.id] = { type: "mcq", value: map[key] };
    renderQuestion();
    return;
  }

  if (key === "enter") {
    if (current < data.questions.length - 1) nextQuestion();
    else submitTest();
    return;
  }

  if (key === "arrowright") nextQuestion();
  if (key === "arrowleft") prevQuestion();
});
function jumpToFirstMissed() {
  buildMissedIndexList();
  if (!missedIndexes.length) return;

  missedPointer = 0;
  const i = missedIndexes[missedPointer];
  const el = document.getElementById(`review-q-${i}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });

  const label = document.getElementById("missedNavLabel");
  if (label) label.textContent = `Missed ${missedPointer + 1} of ${missedIndexes.length}`;
}
function buildMissedIndexList() {
  missedIndexes = [];
  missedPointer = -1;

  for (let i = 0; i < data.questions.length; i++) {
    const q = data.questions[i];
    const a = answers[q.id];

    let correct = false;
    if (q.type === "mcq") {
      correct = a && a.value === q.answerIndex;
    } else if (q.type === "gridin") {
      correct = a && isGridInCorrect(q, a.value);
    }

    if (!correct) missedIndexes.push(i);
  }
}

function jumpToMissed(delta) {
  if (!missedIndexes || missedIndexes.length === 0) return;

  // if we haven't jumped yet, start at the first missed
  if (missedPointer === -1) missedPointer = 0;
  else missedPointer = (missedPointer + delta + missedIndexes.length) % missedIndexes.length;

  const i = missedIndexes[missedPointer];
  const el = document.getElementById(`review-q-${i}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });

  // Optional: update button label like "Missed 2 of 5"
  const label = document.getElementById("missedNavLabel");
  if (label) label.textContent = `Missed ${missedPointer + 1} of ${missedIndexes.length}`;
}
// THEN your load starts AFTER this:
loadData();
