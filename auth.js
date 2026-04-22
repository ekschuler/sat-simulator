async function signUp() {
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const statusEl = document.getElementById("authStatus");

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    statusEl.textContent = "Enter email and password.";
    return;
  }

  const { data, error } = await window.supabaseClient.auth.signUp({
    email,
    password
  });

  if (error) {
    statusEl.textContent = `Sign up error: ${error.message}`;
    console.error(error);
    return;
  }

statusEl.textContent = "Sign up successful.";

if (window.location.pathname.includes("checkout.html")) {
  const { data: profile, error: profileError } = await window.supabaseClient
    .from("profiles")
    .select("access_status")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load profile after login:", profileError);
    window.location.href = "index.html";
    return;
  }

  if (profile?.access_status === "paid") {
    window.location.href = "dashboard.html";
    return;
  }

  window.location.href = "index.html";
} else {
  setTimeout(() => {
    window.location.href = "dashboard.html";
  }, 700);
}

console.log("signUp data:", data);
}

async function logIn() {
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const statusEl = document.getElementById("authStatus");

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    statusEl.textContent = "Enter email and password.";
    return;
  }

  const { data, error } = await window.supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    statusEl.textContent = `Login error: ${error.message}`;
    console.error(error);
    return;
  }

  statusEl.textContent = `Logged in as ${data.user.email}`;

if (window.location.pathname.includes("checkout.html")) {
  const { data: profile, error: profileError } = await window.supabaseClient
    .from("profiles")
    .select("access_status")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load profile after login:", profileError);
    window.location.href = "index.html";
    return;
  }

  if (profile?.access_status === "paid") {
    window.location.href = "dashboard.html";
    return;
  }

  window.location.href = "index.html";
} else {
  setTimeout(() => {
    window.location.href = "dashboard.html";
  }, 700);
}

console.log("login data:", data);
}

async function logOut() {
  const statusEl = document.getElementById("authStatus");

  const { error } = await window.supabaseClient.auth.signOut();

  if (error) {
    statusEl.textContent = `Logout error: ${error.message}`;
    console.error(error);
    return;
  }

  statusEl.textContent = "Logged out.";
}

async function checkCurrentUser() {
  const statusEl = document.getElementById("authStatus");

  const { data } = await window.supabaseClient.auth.getUser();

  if (data?.user) {
  statusEl.textContent = `Already logged in as ${data.user.email}`;

  if (
  !window.location.pathname.includes("checkout.html") &&
  !window.location.pathname.includes("index.html")
) {
  setTimeout(() => {
    window.location.href = "dashboard.html";
  }, 700);
}
} else {
  statusEl.textContent = "";
}
}

document.addEventListener("DOMContentLoaded", () => {
  const signUpBtn = document.getElementById("signUpBtn");
  const logInBtn = document.getElementById("logInBtn");
  let currentAuthMode = "login";
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const authModeTitle = document.getElementById("authModeTitle");
  const authModeText = document.getElementById("authModeText");
  const authBtns = document.querySelectorAll(".authBtn");

if (signUpBtn) {
  signUpBtn.addEventListener("click", () => {
    currentAuthMode = "signup";

    if (authModeTitle) authModeTitle.textContent = "Create your account";
    if (authModeText) authModeText.textContent = "Start your SAT prep and unlock the full experience.";
  authBtns.forEach(btn => btn.classList.remove("active"));
  signUpBtn.classList.add("active");
    signUp();
  });
}
if (logInBtn) {
  logInBtn.addEventListener("click", () => {
    currentAuthMode = "login";

    if (authModeTitle) authModeTitle.textContent = "Welcome back";
    if (authModeText) authModeText.textContent = "Log in to continue your prep.";
  authBtns.forEach(btn => btn.classList.remove("active"));
  logInBtn.classList.add("active");
    logIn();
  });
}

  function handleEnterToLogin(e) {
  if (e.key === "Enter") {
    e.preventDefault();

    if (currentAuthMode === "signup") {
      signUp();
    } else {
      logIn();
    }
  }
}

  if (emailInput) emailInput.addEventListener("keydown", handleEnterToLogin);
  if (passwordInput) passwordInput.addEventListener("keydown", handleEnterToLogin);

  checkCurrentUser();
});