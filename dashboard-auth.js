async function requireUserOnDashboard() {
  const { data, error } = await window.supabaseClient.auth.getUser();

  if (error || !data.user) {
    window.location.href = "index.html";
    return null;
  }

  console.log("Dashboard user:", data.user.email);
  return data.user;
}

async function logOutFromDashboard() {
  const { error } = await window.supabaseClient.auth.signOut();

  if (error) {
    console.error("Logout error:", error);
    return;
  }

  window.location.href = "index.html";
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireUserOnDashboard();
  if (!user) return;

  const logoutBtn = document.getElementById("dashboardLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      logOutFromDashboard();
    });
  }

  await renderPracticeHistory();
});
async function getPracticeHistory() {
  const { data: userData, error: userError } = await window.supabaseClient.auth.getUser();

  if (userError || !userData?.user) {
    console.error("No user found for practice history");
    return [];
  }

  const user = userData.user;

const { data, error } = await window.supabaseClient
  .from("practice_sessions")
  .select("*")
  .eq("user_id", user.id)
  .neq("status", "abandoned")
  .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to load practice history:", error);
    return [];
  }

  return data || [];
}
async function renderPracticeHistory() {
  const container = document.getElementById("practiceHistoryList");
  if (!container) return;

  container.innerHTML = `<p style="margin:0; color:#666;">Loading practice history...</p>`;

  const sessions = await getPracticeHistory();

  if (!sessions.length) {
    container.innerHTML = `<p style="margin:0; color:#666;">No practice history yet.</p>`;
    return;
  }

  // cumulative count
  let cumulativeAnswered = 0;
  sessions.forEach(session => {
  const answerMap = session.answers || {};
  const answeredCount = Object.keys(answerMap).length;

  const date = new Date(session.updated_at);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  let dateStr;
  if (date.toDateString() === now.toDateString()) {
    dateStr = `Today at ${timeStr}`;
  } else if (date.toDateString() === yesterday.toDateString()) {
    dateStr = `Yesterday at ${timeStr}`;
  } else {
    dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" }) + ` at ${timeStr}`;
  }

  rowsHTML += `
    <div style="
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 14px 16px;
      background: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    ">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:14px; color:#111; margin-bottom:3px;">${dateStr}</div>
        <div style="font-size:13px; color:#666;">
          ${answeredCount} question${answeredCount !== 1 ? "s" : ""} answered
        </div>
      </div>
      <button
        class="secondaryBtn"
        style="font-size:13px; padding:8px 14px; white-space:nowrap;"
        onclick="reviewPracticeSession('${session.id}', 'all')"
      >
        Review
      </button>
    </div>
  `;
});

  rowsHTML += `</div>`;

  // keep the summary button at the bottom
  rowsHTML += `
    <div style="margin-top:14px;">
      <button class="secondaryBtn" style="width:100%;" onclick="viewPracticeSummary()">
        View Cumulative Summary
      </button>
    </div>
  `;

  container.innerHTML = rowsHTML;
}
function resumePracticeSession(setId) {
  const safeSetId = encodeURIComponent(setId || "");
  window.location.href = `simulator.html?mode=practice&resume=1&setId=${safeSetId}`;
}
function reviewPracticeSession(sessionId, mode) {
  const safeSessionId = encodeURIComponent(sessionId);
  const safeMode = encodeURIComponent(mode);

  window.location.href = `simulator.html?mode=practice&review=${safeMode}&sessionId=${safeSessionId}`;
}
function viewPracticeSummary() {
  window.location.href = `simulator.html?mode=practice&review=summary`;
}