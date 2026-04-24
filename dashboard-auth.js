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
  console.log("practice sessions for cumulative summary:", sessions);
  

  if (!sessions.length) {
    container.innerHTML = `<p style="margin:0; color:#666;">No practice history yet.</p>`;
    return;
  }

  const session = sessions[0];
  const answerMap = session.answers || {};
  const answeredCount = Object.keys(answerMap).length;

  let cumulativeAnswered = 0;
  sessions.forEach(s => {
    cumulativeAnswered += Object.keys(s.answers || {}).length;
  });

  document.getElementById("practiceHistoryMeta").textContent =
    `${cumulativeAnswered} answered`;

  container.innerHTML = `
    <div style="padding:0; margin-top:12px;">
      <div style="display:flex; gap:10px;">
  <button class="secondaryBtn" style="flex:1;" onclick="viewPracticeSummary()">
    Practice Summary
  </button>
</div>
    </div>
  `;
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