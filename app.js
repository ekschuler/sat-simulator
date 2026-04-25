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
let reviewMode = null;
let isDemoMode = false;
let flagged = {};
let timeLeft = 0;
let activeTestSessionId = null;
let currentModuleFile = "MathT1-Mod1.json";
let currentAttemptId = null;
let activePracticeSessionId = null;
let timerInterval;
let isPaused = false;
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
let practiceSession = {
  pool: [],
  currentIndex: 0,
  mode: "general"
};
let collapsedPracticeDomains = {};
let isPracticeSidebarOpen = window.innerWidth > 600;
let currentMode = "home";
let currentView = "home";
function getSavedTestSession() {
  const raw = localStorage.getItem("satLastTestSession");
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw);
    return saved && saved.mode === "test" ? saved : null;
  } catch (err) {
    console.warn("Failed to parse saved test session:", err);
    return null;
  }
}

function updateUrlForMode(mode) {
  const next = mode === "home"
    ? window.location.pathname
    : `${window.location.pathname}?mode=${encodeURIComponent(mode)}`;

  window.history.replaceState({}, "", next);
}
async function getCurrentSupabaseUser() {
  const { data, error } = await window.supabaseClient.auth.getUser();

  if (error) {
    console.error("Failed to get current user:", error);
    return null;
  }

  return data.user || null;
}
async function getCurrentUserAccessStatus() {
  const user = await getCurrentSupabaseUser();

  if (!user) {
    return "anonymous";
  }

  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("access_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load user access status:", error);
    return "demo";
  }

  return data?.access_status || "demo";
}
async function getLatestSavedTestSessionFromDB() {
  const user = await getCurrentSupabaseUser();

  if (!user) {
    return null;
  }

  const { data, error } = await window.supabaseClient
    .from("test_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to load saved test session:", error);
    return null;
  }

  return data || null;
}
async function getAllTestSessionsForCurrentTest() {
  const user = await getCurrentSupabaseUser();

  if (!user) {
    return [];
  }

  const { data, error } = await window.supabaseClient
    .from("test_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("test_id", "MathT1")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load test sessions for summary:", error);
    return [];
  }

  return data || [];
}
async function savePracticeSessionToDB() {
  if (isDemoMode) {
  console.log("Demo mode — skipping save");
  return null;
}
  
  if (!isPracticeMode || !data) return null;

  const user = await getCurrentSupabaseUser();
  if (!user) {
    console.warn("No logged-in user, skipping practice save.");
    return null;
  }

  const setId = "digital_sat_practice";

let mergedAnswers = { ...answers };

const payloadBase = {
  user_id: user.id,
  set_id: setId,
  status: "in_progress",
  updated_at: new Date().toISOString()
};

  const { data: existingRow, error: lookupError } = await window.supabaseClient
    .from("practice_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("set_id", setId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to look up existing practice session:", lookupError);
    return null;
  }

  let savedRow = null;
  let saveError = null;

  if (existingRow) {
  mergedAnswers = {
    ...(existingRow.answers || {}),
    ...answers
  };

const payload = {
  ...payloadBase,
  current_index: Object.keys(mergedAnswers).length,
  answers: mergedAnswers,
  question_ids: data.questions.map(q => q.id)
};

  const { data: updatedRow, error } = await window.supabaseClient
    .from("practice_sessions")
    .update(payload)
    .eq("id", existingRow.id)
    .select()
    .single();

  savedRow = updatedRow;
  saveError = error;
} else {
  const payload = {
  ...payloadBase,
  current_index: Object.keys(answers || {}).length,
  answers: answers,
  question_ids: data.questions.map(q => q.id)
};

  const { data: insertedRow, error } = await window.supabaseClient
    .from("practice_sessions")
    .insert(payload)
    .select()
    .single();

  savedRow = insertedRow;
  saveError = error;
}
  if (saveError) {
    console.error("Failed to save practice session:", saveError);
    return null;
  }

  activePracticeSessionId = savedRow.id;
  console.log("Practice session saved:", savedRow.id);
  return savedRow;
}
async function getExistingPracticeSession(setId) {
  const user = await getCurrentSupabaseUser();
  if (!user) return null;

  const { data, error } = await window.supabaseClient
    .from("practice_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("set_id", setId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to load practice session:", error);
    return null;
  }

  return data || null;
}
async function getPracticeSessionById(sessionId) {
  const user = await getCurrentSupabaseUser();
  if (!user) return null;

  const { data, error } = await window.supabaseClient
    .from("practice_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load practice session by id:", error);
    return null;
  }

  return data || null;
}
async function getPracticeHistory() {
  const user = await getCurrentSupabaseUser();
  if (!user) return [];

  const { data, error } = await window.supabaseClient
    .from("practice_sessions")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to load practice history:", error);
    return [];
  }

  return data || [];
}
async function getAllPracticeSessions() {
  const user = await getCurrentSupabaseUser();
  if (!user) return [];

  const { data, error } = await window.supabaseClient
    .from("practice_sessions")
    .select("*")
    .eq("user_id", user.id)
    .neq("status", "abandoned")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to load all practice sessions:", error);
    return [];
  }

  return data || [];
}
async function guardSimulatorAccess(params) {
  const isDemo = params.get("demo") === "1";
  const mode = params.get("mode");

  if (isDemo) {
    return true;
  }

  if (mode === "practice" || mode === "test") {
    const accessStatus = await getCurrentUserAccessStatus();

    if (accessStatus === "anonymous") {
      window.location.replace("index.html");
      return false;
    }

    if (accessStatus !== "paid") {
      window.location.replace("dashboard.html?gated=1");
      return false;
    }
  }

  return true;
}
function setAppView(view) {
  currentView = view;

  const homeView = document.getElementById("appHomeView");
  const sessionView = document.getElementById("sessionView");

  if (homeView) homeView.style.display = view === "home" ? "block" : "none";
  if (sessionView) sessionView.style.display = view === "session" ? "block" : "none";

  document.body.classList.toggle("practice-mode", view === "session" && isPracticeMode);
  setActiveNav(view === "home" ? "home" : currentMode);
}

async function renderHomeView() {
  const saved = await getLatestSavedTestSessionFromDB();
  const resumeCard = document.getElementById("homeResumeCard");
  const resumeMeta = document.getElementById("homeResumeMeta");
  const emptyState = document.getElementById("homeEmptyState");

  if (saved) {
    if (resumeCard) resumeCard.style.display = "block";

    if (resumeMeta) {
      const savedLabel = saved.created_at
        ? new Date(saved.created_at).toLocaleString()
        : "Saved session";

      const questionLabel = Number.isFinite(saved.current_question)
        ? `Question ${saved.current_question + 1}`
        : "Saved progress";

      resumeMeta.textContent = `${savedLabel} • ${questionLabel}`;
    }

    if (emptyState) emptyState.style.display = "none";
  } else {
    if (resumeCard) resumeCard.style.display = "none";
    if (resumeMeta) resumeMeta.textContent = "";
    if (emptyState) emptyState.style.display = "block";
  }
}
function togglePracticeSidebar() {
  isPracticeSidebarOpen = !isPracticeSidebarOpen;

  if (isPracticeSidebarOpen) {
    document.body.classList.add("practice-sidebar-open");
  } else {
    document.body.classList.remove("practice-sidebar-open");
  }
}

function closePracticeSidebar() {
  isPracticeSidebarOpen = false;
  document.body.classList.remove("practice-sidebar-open");
}

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
      collapsedPracticeDomains[domain] = true;
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
function shuffleArray(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
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

async function loadData(forcedMode = null, options = {}) {
  
  // global one-time init lock (survives duplicate script evaluation)
  if (window.__SAT_SIM_LOAD_IN_FLIGHT__) return;
  if (forcedMode) {
  window.__SAT_SIM_DATA_LOADED__ = false;
}
if (window.__SAT_SIM_DATA_LOADED__) return;

window.__SAT_SIM_LOAD_IN_FLIGHT__ = true;

  // keep buttons locked until ready
  isReady = false;
const params = new URLSearchParams(window.location.search);
isDemoMode = params.get("demo") === "1";
const fresh = params.get("fresh") === "1";
const resume = params.get("resume") === "1";
reviewMode = params.get("review");
const reviewSessionId = params.get("sessionId");
const mode = forcedMode || params.get("mode") || "home";
const accessAllowed = await guardSimulatorAccess(params);
if (!accessAllowed) return;
// 🚨 prevent simulator from acting as a home page
if (!params.get("mode") && !forcedMode) {
  window.location.href = "dashboard.html";
  return;
}
console.log("LOAD DATA CALLED WITH MODE:", mode);

if (mode === "home") {
  currentMode = "home";
  setAppView("home");
  renderHomeView();

  const loadingOverlay = document.getElementById("loadingOverlay");
  if (loadingOverlay) loadingOverlay.style.display = "none";

  window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;
  return;
}
if (fresh) {
  current = 0;
  answers = {};
  flagged = {};
  timeLeft = 0;
  activeTestSessionId = null;
  isPaused = false;
  isReady = false;
  window.__SAT_SIM_DATA_LOADED__ = false;
  window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;
}
currentMode = mode;
setAppView("session");
document.body.classList.remove("practice-sidebar-ready");
const isDemo = params.get("demo") === "1";

const file = options.forceFile
  ? options.forceFile
  : (isDemo
      ? "demo.json"
      : (mode === "practice" ? "practice.json" : "MathT1-Mod1.json"));

console.log("Mode:", mode, "File:", file);
currentModuleFile = file;

fetch(file)
    .then(res => res.json())
    .then(async json => {
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
  isPracticeSidebarOpen = window.innerWidth > 600;
  if (isPracticeSidebarOpen) {
    document.body.classList.add("practice-sidebar-open");
  } else {
    document.body.classList.remove("practice-sidebar-open");
  }
} else {
  isPracticeSidebarOpen = false;
  document.body.classList.remove("practice-sidebar-open");
}
if (mode === "test" && options.resume) {
  const rawSaved = localStorage.getItem("satLastTestSession");

  if (rawSaved) {
    try {
      const saved = JSON.parse(rawSaved);
      current = Number.isFinite(saved.current) ? saved.current : 0;
      answers = saved.answers || {};
      flagged = saved.flagged || {};
      timeLeft = Number.isFinite(saved.timeLeft)
        ? saved.timeLeft
        : Math.floor((data.timeSeconds || 0) * timeMultiplier);
    } catch (err) {
      current = 0;
      answers = {};
      flagged = {};
      timeLeft = Math.floor((data.timeSeconds || 0) * timeMultiplier);
    }
  } else {
    current = 0;
    answers = {};
    flagged = {};
    timeLeft = Math.floor((data.timeSeconds || 0) * timeMultiplier);
  }
} else {
  current = 0;
  answers = {};
  flagged = {};
  timeLeft = Math.floor((data.timeSeconds || 0) * timeMultiplier);
}
if (isPracticeMode) {
  const fullPracticePool = [...data.questions];
  const setId = "digital_sat_practice";
  if (reviewMode === "summary") {
  const sessions = await getAllPracticeSessions();

  let answerMap = {};
  sessions.forEach(s => {
    Object.assign(answerMap, s.answers || {});
  });

  const answeredQuestionIds = Object.keys(answerMap);

  practiceQuestionPool = fullPracticePool.filter(q =>
    answeredQuestionIds.includes(String(q.id))
  );

  answers = answerMap;
  data.questions = practiceQuestionPool;
  current = 0;

  resultsSummaryHTML = `
    <div class="appPage">
      <h1 class="appTitle">Practice Summary</h1>
      <p class="appSubtitle">Your cumulative practice progress.</p>

      <div id="scoreSummary" class="scoreBanner appCard" style="text-align:center;"></div>
      <div id="cumulativeBreakdown" style="margin-top:16px;"></div>

<div style="margin-top:16px; text-align:center;">
  <button class="secondaryBtn" onclick="window.location.href='dashboard.html'">
    Back to Dashboard
  </button>
</div>
    </div>
  `;

  document.body.innerHTML = resultsSummaryHTML;
  renderScoreBanner({
  title: "Cumulative Summary",
  showMissed: false
});
  renderCumulativeBreakdown(fullPracticePool, answerMap);
  typesetMath();

  const loadingOverlay = document.getElementById("loadingOverlay");
  if (loadingOverlay) loadingOverlay.style.display = "none";

  return;
}

  if (reviewMode) {
    const reviewSession = await getPracticeSessionById(reviewSessionId);

    if (reviewSession && reviewSession.answers) {
      answers = reviewSession.answers || {};
      reviewReveal = true;

      const sessions = await getAllPracticeSessions();

let answerMap = {};
sessions.forEach(s => {
  Object.assign(answerMap, s.answers || {});
});
      const answeredQuestionIds = Object.keys(answerMap);

      let reviewQuestions = fullPracticePool.filter(q =>
        answeredQuestionIds.includes(String(q.id))
      );
if (reviewMode === "summary") {
  practiceQuestionPool = fullPracticePool.filter(q =>
    answeredQuestionIds.includes(String(q.id))
  );

  practiceSidebarTree = buildPracticeSidebarTree(practiceQuestionPool);
  collapsedPracticeDomains = {};

  data.questions = practiceQuestionPool;
  current = 0;

  resultsSummaryHTML = `
    <div class="appPage">
      <h1 class="appTitle">Practice Summary</h1>
      <p class="appSubtitle">Review your past session from here.</p>

      <div id="scoreSummary" class="scoreBanner appCard" style="text-align:center;"></div>

      <div class="summaryActionsCard">
        <div class="summaryActionsTitle">What would you like to do next?</div>

        <div class="summaryActionsList">
          <button class="summaryAction" onclick="startReview('missed')">
            Review Mistakes
          </button>

          <button class="summaryAction" onclick="startReview('all')">
            Review All
          </button>

          <button class="summaryAction secondary" onclick="window.location.href='dashboard.html'">
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.innerHTML = resultsSummaryHTML;
  renderScoreBanner();
  typesetMath();
  return;
}
      if (reviewMode === "incorrect") {
        reviewQuestions = reviewQuestions.filter(q => {
          const a = answerMap[q.id];

          if (!a) return false;

          if (q.type === "mcq") {
            return a.value !== q.answerIndex;
          }

          if (q.type === "gridin") {
            return !isGridInCorrect(q, a.value);
          }

          return false;
        });
      }

      practiceQuestionPool = reviewQuestions;
      practiceSidebarTree = buildPracticeSidebarTree(practiceQuestionPool);
      collapsedPracticeDomains = {};

      data.questions = reviewQuestions;
      current = 0;
    } else {
      practiceQuestionPool = fullPracticePool;
      practiceSidebarTree = buildPracticeSidebarTree(practiceQuestionPool);
      collapsedPracticeDomains = {};

      setPracticeView(shuffleArray([...practiceQuestionPool]), {
        domain: "",
        topic: "",
        level: "All",
        label: "General Practice"
      });
    }
  } else {
    const existingSession = await getExistingPracticeSession(setId);

    let answeredIds = [];

    if (resume && existingSession) {
  answers = existingSession.answers || {};
  current = existingSession.current_index || 0;

  const answeredIds = Object.keys(existingSession.answers || {});
  const remainingQuestions = fullPracticePool.filter(q => {
    return !answeredIds.includes(String(q.id));
  });

  practiceQuestionPool = remainingQuestions.length > 0
    ? remainingQuestions
    : fullPracticePool;
} else {      
  if (existingSession && existingSession.answers) {
        answeredIds = Object.keys(existingSession.answers);
      }

      const remainingQuestions = fullPracticePool.filter(q => {
        return !answeredIds.includes(String(q.id));
      });

      practiceQuestionPool = remainingQuestions.length > 0
        ? remainingQuestions
        : fullPracticePool;
    }

    practiceSidebarTree = buildPracticeSidebarTree(practiceQuestionPool);
    collapsedPracticeDomains = {};

    setPracticeView(shuffleArray([...practiceQuestionPool]), {
      domain: "",
      topic: "",
      level: "All",
      label: "General Practice"
    });
  }
}
practiceSession.pool = practiceQuestionPool;
practiceSession.currentIndex = 0;

setActiveNav(mode);

const practiceSidebarToggleBtn = document.getElementById("practiceSidebarToggleBtn");

if (mode === "test") {
  isPaused = false;
  startTimer();

  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) {
    pauseBtn.style.display = "inline-block";
    pauseBtn.innerText = "Pause";
  }

  const saveExitBtn = document.getElementById("saveExitBtn");
  if (saveExitBtn) saveExitBtn.style.display = "inline-block";

  const timerWrap = document.querySelector(".timer");
  if (timerWrap) timerWrap.style.display = "block";

  if (practiceSidebarToggleBtn) practiceSidebarToggleBtn.style.display = "none";
  closePracticeSidebar();

} else {
  const timerEl = document.getElementById("timer");
  if (timerEl) timerEl.innerText = "--:--";

  const timerWrap = document.querySelector(".timer");
  if (timerWrap) timerWrap.style.display = "none";

  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) pauseBtn.style.display = "none";

  const saveExitBtn = document.getElementById("saveExitBtn");
  if (saveExitBtn) saveExitBtn.style.display = "none";

  if (practiceSidebarToggleBtn) practiceSidebarToggleBtn.style.display = "inline-block";
}
if (reviewMode) {
  reviewIndices = data.questions.map((_, i) => i);
  reviewPointer = 0;
  reviewReveal = false;
  renderReviewScreen(reviewMode === "incorrect" ? "missed" : "all");
} else {
  renderQuestion();
}
renderPracticeSidebar();
renderPracticeFilters();
requestAnimationFrame(() => {
  document.body.classList.add("practice-sidebar-ready");
});
      appInitialized = true;
      isReady = true;

      document.getElementById("prevBtn").disabled = false;
document.getElementById("nextBtn").disabled = false;

const submitBtn = document.getElementById("submitBtn");
if (submitBtn) {
  if (reviewMode) {
    submitBtn.style.display = "none";
  } else {
    submitBtn.disabled = false;
    submitBtn.style.display = "inline-block";
    submitBtn.innerText = isPracticeMode ? "End Session" : "Submit";
  }
}

const loadingOverlay = document.getElementById("loadingOverlay");
if (loadingOverlay) loadingOverlay.style.display = "none";
    })
    .catch(err => {
      console.error("Failed to load questions.json", err);
      appInitialized = false;
      isReady = false;
      const overlay = document.getElementById("loadingOverlay");
if (overlay) overlay.innerHTML =
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
  if (isPaused) return;

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
function togglePause() {
  isPaused = !isPaused;

  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) {
    pauseBtn.innerText = isPaused ? "Resume" : "Pause";
  }

  const questionEl = document.getElementById("question");
  if (questionEl) {
    questionEl.style.pointerEvents = isPaused ? "none" : "";
    questionEl.style.opacity = isPaused ? "0.55" : "";
  }

  const choicesEl = document.getElementById("choices");
  if (choicesEl) {
    choicesEl.style.pointerEvents = isPaused ? "none" : "";
    choicesEl.style.opacity = isPaused ? "0.55" : "";
  }

  const prevBtn = document.getElementById("prevBtn");
  if (prevBtn) prevBtn.disabled = isPaused;

  const flagBtn = document.getElementById("flagBtn");
  if (flagBtn) flagBtn.disabled = isPaused;

  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = isPaused;

  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) submitBtn.disabled = isPaused;

  const saveExitBtn = document.getElementById("saveExitBtn");
  if (saveExitBtn) saveExitBtn.disabled = isPaused;
}
function renderProgress() {
  const el = document.getElementById("progress");
  if (!el || !data?.questions) return;
if (isPracticeMode && !practiceCurrentTopic) {
  el.innerHTML = "";
  return;
}
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
       <div class="q-num">
  ${reviewMode ? "Review Mode • " : ""}
  Question ${current + 1} of ${data.questions.length}
</div>
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
    updateFlaggedCount();
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
  if (reviewMode) return;

  answers[q.id] = { type: "mcq", value: index };
  delete flagged[q.id];
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
  input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "ArrowRight") {
    e.preventDefault();
    e.stopPropagation();
    nextQuestion();
    return;
  }

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    e.stopPropagation();
    prevQuestion();
  }
});
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

  if (reviewMode) {
  input.disabled = true;
}
  // basic validation guidance (not strict yet)
  const hint = document.createElement("div");
  hint.style.color = "#666";
  hint.style.fontSize = "13px";
  hint.style.marginTop = "8px";
  hint.textContent = buildValidationHint(q.validation);

  
  input.addEventListener("input", () => {
  const v = input.value;
  answers[q.id] = { type: "gridin", value: v };

  if (v.trim() !== "") {
    delete flagged[q.id];
  }

  renderProgress();
});

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  wrapper.appendChild(hint);
  container.appendChild(wrapper);
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
  updateFlaggedCount();
}
function goToNextFlagged() {
  const flaggedIndices = Object.keys(flagged)
    .map(id => data.questions.findIndex(q => String(q.id) === String(id)))
    .filter(i => i !== -1)
    .sort((a, b) => a - b);

  if (!flaggedIndices.length) return;

  const next = flaggedIndices.find(i => i > current);

  if (next !== undefined) {
    current = next;
  } else {
    current = flaggedIndices[0]; // wrap to first
  }

  renderQuestion();
}
function updateFlaggedCount() {
  const btn = document.getElementById("nextFlaggedBtn");
  if (!btn) return;

  const count = Object.keys(flagged || {}).length;
  btn.textContent = `Flagged (${count})`;
}
function normalizeGridIn(s) {
  // Basic normalization: trim spaces
  return (s ?? "").toString().trim();
}

function normalizeGridInValue(value) {
  const raw = String(value ?? "").trim();

  if (!raw) return null;

  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length === 2) {
      const numerator = Number(parts[0]);
      const denominator = Number(parts[1]);

      if (
        Number.isFinite(numerator) &&
        Number.isFinite(denominator) &&
        denominator !== 0
      ) {
        return numerator / denominator;
      }
    }
  }

  const numericValue = Number(raw);
  return Number.isFinite(numericValue) ? numericValue : raw;
}

function isGridInCorrect(q, userValue) {
  const userNormalized = normalizeGridInValue(userValue);
  if (userNormalized === null) return false;

  const accepted = [q.answer, ...(q.answersAccepted || [])]
    .map(normalizeGridInValue)
    .filter(v => v !== null);

  return accepted.some(correctValue => {
    if (
      typeof userNormalized === "number" &&
      typeof correctValue === "number"
    ) {
      return Math.abs(userNormalized - correctValue) < 1e-9;
    }

    return String(userNormalized) === String(correctValue);
  });
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
    const answeredQuestions = data.questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => answers[q.id]);
    if (mode === "missed") {
    reviewIndices = data.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => answers[q.id] && !isQuestionCorrect(q))
      .map(({ i }) => i);

    if (reviewIndices.length === 0) {
      document.body.innerHTML = `
  <div class="appPage">
    <h1 class="appTitle">Great work 🎉</h1>
    <p class="appSubtitle">You answered every question correctly in this module.</p>

    <div class="scoreBanner appCard" style="text-align:center;">
      <div class="scoreMain">No missed questions</div>
      <div class="scoreSub">You earned points on every question in this module.</div>

      <div class="appActionRow">
        <button class="reviewMissedBtn" onclick="backToSummary()">Back to Summary</button>
        <button class="reviewMissedBtn secondary" onclick="startReview('all')">Review answered questions</button>
      </div>
    </div>
  </div>
`;
      return;
    }
   } else {
    reviewIndices = data.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => answers[q.id])
      .map(({ i }) => i);
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
      <div class="${rowClass} reviewChoiceRow" style="cursor:default;">
          <div class="choiceLetter">${letters[idx]}</div>
          <div class="choiceText">${choice}</div>
        </div>
      `;
    }).join("");
  } else if (q.type === "gridin") {
  const gridClass = correct ? "reviewGridInput correct" : "reviewGridInput incorrect";

  answerHTML = `
    <div class="reviewGridWrap" style="margin-top:18px;">
      <div class="reviewGridLabel">Your entered answer:</div>
      <input
        class="${gridClass}"
        type="text"
        value="${userAnswer || ""}"
        disabled
      />
    </div>
  `;
}
  document.body.innerHTML = `
    <div class="appPage">
      <div class="appHeaderRow">
        <button class="reviewMissedBtn secondary" onclick="backToSummary()">Back to Summary</button>
        <div class="appSubtitle" style="margin:0;font-weight:800;color:#111;">${reviewLabel}</div>
      </div>

      <div class="scoreBanner appCard reviewCardSticky" style="text-align:left;">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
          <div class="q-header" style="margin:0 0 16px 0; display:flex; flex-direction:column; align-items:flex-start; gap:6px;">
            <div class="q-skill" style="margin:0;">
              ${formatSkill(q.skill).split(" - ").pop()}
            </div>
            <div class="q-num" style="margin:0;">
              Question ${index + 1} of ${data.questions.length}
            </div>
          </div>

          <div style="display:flex;align-items:flex-end;gap:8px;">
            <div style="display:flex;flex-direction:column;gap:6px;">
              <label for="reviewJumpInput" style="font-size:14px;font-weight:600;color:#444;line-height:1;">
                Go to
              </label>
              <input
                id="reviewJumpInput"
                type="number"
                min="1"
                max="${reviewIndices.length}"
                value="${reviewPointer + 1}"
                style="width:84px;padding:10px 12px;border:1px solid #d0d0d0;border-radius:10px;font-size:15px;line-height:1.2;box-sizing:border-box;"
                onkeydown="if(event.key === 'Enter'){ jumpToReviewQuestion('${mode}') }"
              />
            </div>

            <button
              class="reviewMissedBtn secondary"
              style="align-self:flex-end;"
              onclick="jumpToReviewQuestion('${mode}')"
            >
              Go
            </butaton>
          </div>
        </div>

        <div style="font-weight:800;margin-bottom:10px;">
          ${correct ? "✅ Correct" : "❌ Incorrect"}
        </div>

        <div class="q-stem">${q.stem}</div>

        <div id="reviewAnswerArea" class="reviewAnswerArea" style="margin-top:18px;">
          ${answerHTML}
        </div>

        ${reviewReveal ? `
          <div class="reviewRevealBox" style="margin-top:18px;">
            <div id="reviewExplanation">
              ${q.explanation || "<em>No explanation provided.</em>"}
            </div>
          </div>
        ` : ""}

        <div class="reviewStickyBar">
          <div class="reviewStickyLeft">
            <button class="reviewMissedBtn" onclick="revealReviewAnswer()">
              ${reviewReveal ? "Hide Explanation" : "Show Explanation"}
            </button>
          </div>

          <div class="reviewStickyRight reviewNavRow">
            <button class="reviewMissedBtn secondary" onclick="reviewPrev('${mode}')">Prev</button>
            <button class="reviewMissedBtn secondary" onclick="reviewNext('${mode}')">Next</button>
          </div>
        </div>
      </div>
    </div>
  `;

  typesetMath();
window.scrollTo({ top: 0, behavior: "auto" });
}

function revealReviewAnswer() {
  const wasHidden = !reviewReveal;

  reviewReveal = !reviewReveal;

  const mode = reviewIndices.length === data.questions.length ? "all" : "missed";
  renderReviewScreen(mode);

  // Only scroll when opening, not closing
  if (wasHidden) {
    setTimeout(() => {
      const el = document.getElementById("reviewExplanation");
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    }, 50);
  }
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
function jumpToReviewQuestion(mode) {
  const input = document.getElementById("reviewJumpInput");
  if (!input) return;

  const raw = input.value.trim();
  const num = Number(raw);

  if (!Number.isInteger(num)) {
    input.value = "";
    input.placeholder = "Enter a number";
    return;
  }

  if (num < 1 || num > reviewIndices.length) {
    input.value = "";
    input.placeholder = `1-${reviewIndices.length} only`;
    return;
  }

  reviewPointer = num - 1;
  reviewReveal = false;
  renderReviewScreen(mode);
}
function backToSummary() {
  document.body.innerHTML = resultsSummaryHTML;
  renderScoreBanner();
  typesetMath();
}
window.startReview = startReview;
window.backToSummary = backToSummary;
window.revealReviewAnswer = revealReviewAnswer;
window.reviewPrev = reviewPrev;
window.reviewNext = reviewNext;
window.jumpToReviewQuestion = jumpToReviewQuestion;

function renderScoreBanner(options = {}) {
  const title = options.title || "Session Summary";
const showMissed = options.showMissed !== false;
  const answeredQuestions = data.questions.filter(q => answers[q.id]);
  const totalAnswered = answeredQuestions.length;
  const correct = answeredQuestions.filter(q => isQuestionCorrect(q)).length;
  const missed = totalAnswered - correct;

  const el = document.getElementById("scoreSummary");
  if (!el) return;

  el.innerHTML = `
    <div class="scoreTopRow">
      <div class="scoreMain">${title}</div>
      <div class="scorePercent">${correct}/${totalAnswered}</div>
    </div>
    <div class="summaryReviewButtons">
      <button class="reviewMissedBtn" onclick="startReview('missed')">Review missed questions</button>
      <button class="reviewMissedBtn secondary" onclick="startReview('all')">Review answered questions</button>
    </div>
  `;
}
function renderCumulativeBreakdown(questionPool, answerMap) {
  const breakdownEl = document.getElementById("cumulativeBreakdown");
  if (!breakdownEl) return;

  const tree = {};

  Object.entries(answerMap || {}).forEach(([questionId, answer]) => {
    const q = questionPool.find(item => String(item.id) === String(questionId));
    if (!q) return;

    const domain = getDomain(q.skill);
    const topic = getTopic(q.skill);

    if (!tree[domain]) tree[domain] = {};
    if (!tree[domain][topic]) tree[domain][topic] = { correct: 0, total: 0 };

    tree[domain][topic].total++;

    if (q.type === "mcq" && answer.value === q.answerIndex) {
      tree[domain][topic].correct++;
    }

    if (q.type === "gridin" && isGridInCorrect(q, answer.value)) {
      tree[domain][topic].correct++;
    }
  });

  breakdownEl.innerHTML = `
    <h3 class="appSectionTitle">Skill Breakdown</h3>
    <div class="skillBreakdownGrid">
      ${Object.entries(tree).map(([domain, topics]) => `
        <div class="domainCard">
          <div class="domainRow">
            <span class="domainName">${domain}</span>
          </div>

          ${Object.entries(topics).map(([topic, stats]) => {
            const percent = Math.round((stats.correct / stats.total) * 100);

            return `
              <div class="topicRow">
                <span class="topicName">${topic}</span>
                <span class="scoreChip">${percent}%</span>
              </div>
            `;
          }).join("")}
        </div>
      `).join("")}
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
      collapsedPracticeDomains[domain] = true;
    }
  });
}
function togglePracticeDomain(domain) {
  if (!domain) return;
  collapsedPracticeDomains[domain] = !collapsedPracticeDomains[domain];
  renderPracticeSidebar();
}
function renderPracticeSidebar() {
  if (!isPracticeMode) {
  const sidebar = document.getElementById("practiceSidebar");
  if (sidebar) sidebar.style.display = "none";
  return;
}
  const sidebar = document.getElementById("practiceSidebar");
  if (!sidebar) return;

  ensurePracticeDomainCollapseState();

  let html = `
  <div class="practice-sidebar-card">
    <div class="practice-sidebar-header" style="display:flex;justify-content:space-between;align-items:center;">
      <span class="practice-sidebar-title">Practice Navigator</span>
      <button onclick="closePracticeSidebar()" style="font-size:12px;">Close</button>
    </div>
`;
html += `
  <button
    type="button"
    class="sidebar-topic-btn ${!practiceCurrentDomain && !practiceCurrentTopic ? "active" : ""}"
    onclick='setPracticeView(shuffleArray([...practiceQuestionPool]), { domain: "", topic: "", level: "All", label: "All Questions" })'
    style="margin-bottom:8px;"
  >
    All Questions
  </button>
`;
  if (practiceSelectionLabel) {
    html += `
      <div class="practice-sidebar-subhead">Now practicing</div>
      <div class="practice-sidebar-current">${practiceSelectionLabel}</div>
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
  onclick='togglePracticeDomain(${JSON.stringify(domain)}); selectPracticeDomain(${JSON.stringify(domain)})'
  aria-label="Toggle ${domain}"
>
        <span class="sidebar-domain-chevron">${isCollapsed ? "▸" : "▾"}</span>
      </button>

      <button
  type="button"
  class="sidebar-domain-btn ${isDomainActive ? "active" : ""}"
  onclick='selectPracticeDomain(${JSON.stringify(domain)})'
>
        <span class="sidebar-domain-name">
  <span class="sidebar-domain-chevron-inline">
    ${isCollapsed ? "▸" : "▾"}
  </span>
  ${domain}
</span>
        <span class="sidebar-domain-count">${domainCount}</span>
      </button>
    </div>

    <div class="sidebar-domain-topics" style="display:${isCollapsed ? "none" : "block"};">
`;

   Object.entries(topics).sort(([a], [b]) => a.localeCompare(b)).forEach(([topic, levels]) => {
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

function setPracticeView(questions, {
  domain = "",
  topic = "",
  level = "All",
  label = ""
} = {}) {
  if (!Array.isArray(questions) || questions.length === 0) return;

  data.questions = questions;
  current = 0;

  practiceCurrentDomain = domain;
  practiceCurrentTopic = topic;
  practiceCurrentLevel = level;
  practiceSelectionLabel = label;

  if (domain) {
    collapsedPracticeDomains[domain] = false;
  }

  renderQuestion();
  renderPracticeSidebar();
  renderPracticeFilters();
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

  setPracticeView(domainQuestions, {
    domain,
    topic: "",
    level: "All",
    label: domain
  });
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

  setPracticeView(topicQuestions, {
    domain,
    topic,
    level: "All",
    label: `${domain} → ${topic}`
  });
}

function renderPracticeFilters() {
  const filters = document.getElementById("practiceFilters");
  if (!filters) return;

  if (!isPracticeMode || (!practiceCurrentTopic && !practiceCurrentDomain)) {
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
        onclick='selectPracticeLevelFilter(${JSON.stringify(level)})'
      >
        ${level}
      </button>
    `).join("")}
  `;
}

function selectPracticeLevelFilter(level) {
  console.log("LEVEL BUTTON CLICKED:", level);

  if (!practiceCurrentDomain && !practiceCurrentTopic) return;
  if (practiceCurrentDomain) {
    collapsedPracticeDomains[practiceCurrentDomain] = false;
  }

  let filteredQuestions = [];
  let label = "";

  if (practiceCurrentDomain && practiceCurrentTopic) {
    const topicLevels = practiceSidebarTree?.[practiceCurrentDomain]?.[practiceCurrentTopic];
    if (!topicLevels) return;

    label = `${practiceCurrentDomain} → ${practiceCurrentTopic}`;

    if (level === "All") {
      Object.values(topicLevels).forEach(levelArr => {
        levelArr.forEach(q => filteredQuestions.push(q.question));
      });
    } else {
      const levelQuestions = topicLevels[level] || [];
      filteredQuestions = levelQuestions.map(q => q.question);
      label = `${practiceCurrentDomain} → ${practiceCurrentTopic} → ${level}`;
    }
  } else if (practiceCurrentDomain) {
    const domainTopics = practiceSidebarTree?.[practiceCurrentDomain];
    if (!domainTopics) return;

    label = practiceCurrentDomain;

    Object.values(domainTopics).forEach(topicLevels => {
      if (level === "All") {
        Object.values(topicLevels).forEach(levelArr => {
          levelArr.forEach(q => filteredQuestions.push(q.question));
        });
      } else {
        const levelQuestions = topicLevels[level] || [];
        levelQuestions.forEach(q => filteredQuestions.push(q.question));
      }
    });

    if (level !== "All") {
      label = `${practiceCurrentDomain} → ${level}`;
    }
  }

  setPracticeView(filteredQuestions, {
    domain: practiceCurrentDomain,
    topic: practiceCurrentTopic,
    level,
    label
  });
}
async function submitTest() {
  if (isPracticeMode) {
    await savePracticeSessionToDB();
    endPracticeSession();
    return;
  }
  if (!isReady) return;

if (window.__SAT_SIM_TIMER_INTERVAL__) {
  clearInterval(window.__SAT_SIM_TIMER_INTERVAL__);
  window.__SAT_SIM_TIMER_INTERVAL__ = null;
}
isReady = false;
isPaused = true;
// --- ADAPTIVE ROUTING: if finishing Module 1, go to Module 2 ---
console.log("submitTest moduleId:", data?.moduleId);

if ((data?.moduleId || "").trim().includes("Mod1")) {
  const nextFile = getModule2FileFromModule1();
  loadNextModule(nextFile);
  return;
}
localStorage.setItem("satLastTestSession", JSON.stringify({
  savedAt: new Date().toISOString(),
  mode: "test",
  moduleId: data?.moduleId || "",
  title: data?.title || "SAT Math Module",
  timeLeft,
  answers,
  flagged,
  current,
  totalQuestions: data?.questions?.length || 0
}));

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
  <div class="appPage">
    <h1 class="appTitle">Test Complete</h1>
    <p class="appSubtitle">Here’s your performance summary for this module.</p>
    <div id="scoreSummary" class="scoreBanner"></div>
`;

  // Skill Breakdown
  reviewHTML += `<h3 class="appSectionTitle">Skill Breakdown</h3>`;
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
function endPracticeSession() {
  const answeredQuestions = data.questions.filter(q => answers[q.id]);
  const totalAnswered = answeredQuestions.length;
  const correct = answeredQuestions.filter(q => isQuestionCorrect(q)).length;
  const missed = totalAnswered - correct;

  const tree = {};

  answeredQuestions.forEach(q => {
    const domain = getDomain(q.skill);
    const topic = getTopic(q.skill);

    if (!tree[domain]) tree[domain] = {};
    if (!tree[domain][topic]) {
      tree[domain][topic] = { correct: 0, total: 0 };
    }

    tree[domain][topic].total++;

    if (isQuestionCorrect(q)) {
      tree[domain][topic].correct++;
    }
  });

  let breakdownHTML = `<div class="skillBreakdownGrid">`;

  Object.entries(tree).forEach(([domain, topics]) => {
    breakdownHTML += `
      <div class="domainCard">
        <div class="domainRow">
          <span class="domainName">${domain}</span>
        </div>
    `;

    Object.entries(topics).forEach(([topic, stats]) => {
      breakdownHTML += `
        <div class="topicRow">
          <span class="topicName">${topic}</span>
         <span class="scoreChip" style="
  background: ${
    stats.correct / stats.total >= 0.8 ? '#dcfce7' :
    stats.correct / stats.total >= 0.5 ? '#fef9c3' :
    '#fee2e2'
  };
  color: ${
    stats.correct / stats.total >= 0.8 ? '#166534' :
    stats.correct / stats.total >= 0.5 ? '#854d0e' :
    '#991b1b'
  };
">
  ${Math.round((stats.correct / stats.total) * 100)}%
</span>
        </div>
      `;
    });

    breakdownHTML += `</div>`;
  });

  breakdownHTML += `</div>`;

  resultsSummaryHTML = `
    <div class="appPage">
      <h1 class="appTitle">Practice Session Complete</h1>
      <p class="appSubtitle">Here’s your session summary.</p>

      <div class="scoreBanner appCard" style="text-align:center;">
        <div class="scoreTopRow">
  <div class="scoreMain">Session Summary</div>
  <div class="scorePercent">${correct}/${totalAnswered}</div>
</div>

<div class="summaryActionsCard">
  <div class="summaryActionsTitle">What would you like to do next?</div>

<div class="summaryActionsList">

  ${isDemoMode ? "" : `
  <button class="summaryAction primary" onclick="restartPractice()">
    Continue practice
  </button>
  `}

  <button class="summaryAction" onclick="startReview('missed')">
    Review mistakes
  </button>

  <button class="summaryAction" onclick="startReview('all')">
    Review all answers
  </button>

  ${isDemoMode
    ? `
    <button
  class="summaryAction primary"
  style="font-size:16px;padding:14px 18px;margin-top:8px;"
  onclick="window.location.href='checkout.html'"
>
  Unlock Full Access
</button>
    `
    : `
    <button class="summaryAction secondary" onclick="window.location.href='dashboard.html'">
      Back to dashboard
    </button>
    `
  }
</div>
</div>

      <h3 class="appSectionTitle">Topics Practiced</h3>
      ${breakdownHTML}
    </div>
  `;

  document.body.innerHTML = resultsSummaryHTML;
}
function restartPractice() {
  window.location.href = "simulator.html?mode=practice&fresh=1";
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
const tag = document.activeElement?.tagName;
const isTyping =
  tag === "INPUT" ||
  tag === "TEXTAREA" ||
  document.activeElement?.isContentEditable;

if (!isTyping) {
  if (key === "arrowright") {
    nextQuestion();
    return;
  }

  if (key === "arrowleft") {
    prevQuestion();
    return;
  }
}
  if (key === "enter") {
    
    if (current < data.questions.length - 1) nextQuestion();
    else submitTest();
    return;
  }
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
async function saveAndExitTest() {
  if (!isReady || !data) return;

  if (window.__SAT_SIM_TIMER_INTERVAL__) {
    clearInterval(window.__SAT_SIM_TIMER_INTERVAL__);
    window.__SAT_SIM_TIMER_INTERVAL__ = null;
  }

  const user = await getCurrentSupabaseUser();

  if (!user) {
    alert("You must be logged in to save your test.");
    window.location.href = "index.html";
    return;
  }

  const sessionPayload = {
    user_id: user.id,
    test_id: "MathT1",
    module: data?.moduleId?.includes("Mod2") ? 2 : 1,
    module_file: currentModuleFile,
    attempt_id: currentAttemptId,
    answers,
    flagged,
    current_question: current,
    time_left: timeLeft,
    status: "in_progress"
  };

  let result;

  if (activeTestSessionId) {
    result = await window.supabaseClient
      .from("test_sessions")
      .update(sessionPayload)
      .eq("id", activeTestSessionId)
      .select()
      .single();
  } else {
    result = await window.supabaseClient
      .from("test_sessions")
      .insert(sessionPayload)
      .select()
      .single();
  }

  if (result.error) {
    console.error("Failed to save test session:", result.error);
    alert(`Failed to save test session: ${result.error.message}`);
    return;
  }

  activeTestSessionId = result.data.id;
    localStorage.setItem(
    "satLastTestSession",
    JSON.stringify({
      mode: "test",
      current: Number.isInteger(current) ? current : 0,
      answers: answers && typeof answers === "object" ? answers : {},
      flagged: flagged && typeof flagged === "object" ? flagged : {},
      timeLeft: typeof timeLeft === "number" ? timeLeft : 0,
      savedAt: new Date().toISOString()
    })
  );

  setAppView("home");
  updateUrlForMode("home");
  renderHomeView();
}
function restoreSavedTestSession() {
  const raw = localStorage.getItem("satLastTestSession");
  if (!raw) return false;

  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.mode !== "test") return false;

    timeLeft = typeof saved.timeLeft === "number" ? saved.timeLeft : timeLeft;
    answers = saved.answers && typeof saved.answers === "object" ? saved.answers : {};
    flagged = saved.flagged && typeof saved.flagged === "object" ? saved.flagged : {};
    current = Number.isInteger(saved.current) ? saved.current : 0;

    return true;
  } catch (err) {
    console.warn("Failed to restore saved test session:", err);
    return false;
  }
}
window.resumeSavedTest = resumeSavedTest;

function getSavedTestSession() {
  const raw = localStorage.getItem("satLastTestSession");
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw);
    return saved && saved.mode === "test" ? saved : null;
  } catch (err) {
    return null;
  }
}

function showHomeView() {
  const homeView = document.getElementById("appHomeView");
  const sessionView = document.getElementById("sessionView");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const saved = getSavedTestSession();

  if (homeView) homeView.style.display = "block";
  if (sessionView) sessionView.style.display = "none";
  if (loadingOverlay) loadingOverlay.style.display = "none";

  const resumeCard = document.getElementById("homeResumeCard");
  const resumeMeta = document.getElementById("homeResumeMeta");
  const emptyState = document.getElementById("homeEmptyState");

  if (saved) {
    if (resumeCard) resumeCard.style.display = "block";
    if (emptyState) emptyState.style.display = "none";
    if (resumeMeta) {
      resumeMeta.textContent = saved.savedAt
        ? `Saved ${new Date(saved.savedAt).toLocaleString()}`
        : "Saved session";
    }
  } else {
    if (resumeCard) resumeCard.style.display = "none";
    if (emptyState) emptyState.style.display = "block";
    if (resumeMeta) resumeMeta.textContent = "";
  }

  setActiveNav("home");
}

async function resumeSavedTest() {
  const saved = await getLatestSavedTestSessionFromDB();
  currentAttemptId = saved.attempt_id || null;

  if (!saved) {
    alert("No saved test session found.");
    return;
  }

  activeTestSessionId = saved.id;
  currentMode = "test";
  setAppView("session");
  updateUrlForMode("test");

  localStorage.setItem(
    "satLastTestSession",
    JSON.stringify({
      mode: "test",
      current: Number.isInteger(saved.current_question) ? saved.current_question : 0,
      answers: saved.answers && typeof saved.answers === "object" ? saved.answers : {},
      flagged: saved.flagged && typeof saved.flagged === "object" ? saved.flagged : {},
      timeLeft: typeof saved.time_left === "number" ? saved.time_left : 0
    })
  );
  isPaused = false;
  window.__SAT_SIM_DATA_LOADED__ = false;
  window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;
  loadData("test", { resume: true, forceFile: saved.module_file });
}
function setActiveNav(mode) {
  const home = document.getElementById("navHomeBtn");
  const practice = document.getElementById("navPracticeBtn");
  const test = document.getElementById("navTestBtn");

  if (home) home.classList.remove("active");
  if (practice) practice.classList.remove("active");
  if (test) test.classList.remove("active");

  if (mode === "home" && home) home.classList.add("active");
  if (mode === "practice" && practice) practice.classList.add("active");
  if (mode === "test" && test) test.classList.add("active");
}
function goToMode(nextMode) {
  if (nextMode === "home") {
    currentMode = "home";
    setAppView("home");
    renderHomeView();
    closePracticeSidebar();
    updateUrlForMode("home");
    return;
  }

if (nextMode === "practice") {
  currentMode = "practice";

  window.__SAT_SIM_DATA_LOADED__ = false;
  window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;

  setAppView("session");
  updateUrlForMode("practice");
  loadData("practice");
  return;
}
  if (nextMode === "test") {
    restartFullTest();
    return;
  }
}

function getModule2FileFromModule1() {
  const total = data.questions.length || 0;
  const correct = data.questions.filter(q => isQuestionCorrect(q)).length;
  const ratio = total ? correct / total : 0;

  return ratio >= 0.7 ? "MathT1-Mod2H.json" : "MathT1-Mod2E.json";
}

async function loadNextModule(file) {
  const user = await getCurrentSupabaseUser();

  if (!user) {
    alert("You must be logged in to continue to Module 2.");
    window.location.href = "index.html";
    return;
  }

  if (activeTestSessionId) {
    const { error: completeError } = await window.supabaseClient
      .from("test_sessions")
      .update({ status: "completed" })
      .eq("id", activeTestSessionId);

    if (completeError) {
      console.error("Failed to mark Module 1 session completed:", completeError);
      alert(`Failed to complete Module 1 session: ${completeError.message}`);
      return;
    }
  }

  const nextSessionPayload = {
    user_id: user.id,
    test_id: "MathT1",
    module: 2,
    module_file: file,
    attempt_id: currentAttemptId,
    answers: {},
    flagged: {},
    current_question: 0,
    time_left: 0,
    status: "in_progress"
  };

  const { data: insertedSession, error: insertError } = await window.supabaseClient
    .from("test_sessions")
    .insert(nextSessionPayload)
    .select()
    .single();

  if (insertError) {
    console.error("Failed to create Module 2 session:", insertError);
    alert(`Failed to create Module 2 session: ${insertError.message}`);
    return;
  }

  activeTestSessionId = insertedSession.id;

  localStorage.removeItem("satLastTestSession");

  window.__SAT_SIM_DATA_LOADED__ = false;
  window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;

  appInitialized = false;
  isReady = false;
  isPaused = false;

  currentMode = "test";
  setAppView("session");
  updateUrlForMode("test");

  loadData("test", { forceFile: file });
}
window.restartFullTest = function () {
  localStorage.removeItem("satLastTestSession");

  current = 0;
  answers = {};
  flagged = {};
  timeLeft = 0;
  activeTestSessionId = null;
  isPaused = false;
  isReady = false;
  currentMode = "test";

  window.__SAT_SIM_DATA_LOADED__ = false;
  window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;

  setAppView("session");
  updateUrlForMode("test");
  loadData("test");
};
window.startPracticeMode = function () {
  localStorage.removeItem("satLastTestSession");

  current = 0;
  answers = {};
  flagged = {};
  timeLeft = 0;
  activeTestSessionId = null;
  isPaused = false;
  isReady = false;
  currentMode = "practice";

  window.__SAT_SIM_DATA_LOADED__ = false;
  window.__SAT_SIM_LOAD_IN_FLIGHT__ = false;

  setAppView("session");
  updateUrlForMode("practice");
  loadData("practice");
};
// THEN your load starts AFTER this:
const params = new URLSearchParams(window.location.search);
const initialMode = params.get("mode");

if (!initialMode) {
  window.location.href = "dashboard.html";
} else {
  loadData(initialMode);
}