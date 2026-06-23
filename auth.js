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

async function forgotPassword() {
  const emailInput = document.getElementById("authEmail");
  const statusEl = document.getElementById("authStatus");

  const email = emailInput.value.trim();

  if (!email) {
    statusEl.textContent = "Enter your email address above, then click Forgot Password.";
    return;
  }

  const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/reset-password.html"
  });

  if (error) {
    statusEl.textContent = `Error: ${error.message}`;
    console.error(error);
    return;
  }

  statusEl.textContent = "Password reset email sent — check your inbox.";
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
  const submitBtn = document.getElementById("authSubmitBtn");
  const forgotBtn = document.getElementById("forgotPasswordBtn");
  const authModeTitle = document.getElementById("authModeTitle");
  const authModeText = document.getElementById("authModeText");
  const authBtns = document.querySelectorAll(".authBtn");
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");

  let currentAuthMode = "login";

  function setMode(mode) {
    currentAuthMode = mode;
    authBtns.forEach(btn => btn.classList.remove("active"));

    if (mode === "signup") {
      if (authModeTitle) authModeTitle.textContent = "Create your account";
      if (authModeText) authModeText.textContent = "Start your SAT prep and unlock the full experience.";
      if (signUpBtn) signUpBtn.classList.add("active");
      if (submitBtn) submitBtn.textContent = "Sign Up";
      if (forgotBtn) forgotBtn.style.display = "none";
    } else {
      if (authModeTitle) authModeTitle.textContent = "Welcome back";
      if (authModeText) authModeText.textContent = "Log in to continue your prep.";
      if (logInBtn) logInBtn.classList.add("active");
      if (submitBtn) submitBtn.textContent = "Log In";
      if (forgotBtn) forgotBtn.style.display = "block";
    }
  }

  // Switch mode on tab click — do NOT submit yet
  if (signUpBtn) {
    signUpBtn.addEventListener("click", () => setMode("signup"));
  }
  if (logInBtn) {
    logInBtn.addEventListener("click", () => setMode("login"));
  }

  // Submit button actually runs the auth
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      if (currentAuthMode === "signup") {
        signUp();
      } else {
        logIn();
      }
    });
  }

  // Forgot password
  if (forgotBtn) {
    forgotBtn.addEventListener("click", forgotPassword);
  }

  function handleEnterKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (currentAuthMode === "signup") {
        signUp();
      } else {
        logIn();
      }
    }
  }

  if (emailInput) emailInput.addEventListener("keydown", handleEnterKey);
  if (passwordInput) passwordInput.addEventListener("keydown", handleEnterKey);

  // Default to login mode
  setMode("login");
  checkCurrentUser();
});
