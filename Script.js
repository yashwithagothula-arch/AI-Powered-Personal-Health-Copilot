"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const STORAGE_KEY = "healthCopilotCleanV1";
const todayKey = () => new Date().toLocaleDateString("en-CA");

function defaultState() {
  return {
    date: todayKey(),
    medicines: [],
    history: [],
    water: 0,
    waterGoal: 8,
    waterEnabled: false,
    waterInterval: 60,
    waterLastAt: Date.now(),
    waterReminderDay: "",
    sleep: {
      bedtime: "22:00",
      wakeTime: "06:00",
      goal: 8,
      enabled: false,
      firedDay: ""
    },
    mood: "",
    moodDate: "",
    profile: { name: "", email: "", focus: "Balanced wellness" },
    notifications: [],
    dark: false,
    chat: []
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return defaultState();

    const base = defaultState();
    const state = {
      ...base,
      ...saved,
      sleep: { ...base.sleep, ...(saved.sleep || {}) },
      profile: { ...base.profile, ...(saved.profile || {}) }
    };

    if (!Array.isArray(state.medicines)) state.medicines = [];
    if (!Array.isArray(state.history)) state.history = [];
    if (!Array.isArray(state.notifications)) state.notifications = [];
    if (!Array.isArray(state.chat)) state.chat = [];

    if (state.date !== todayKey()) {
      state.date = todayKey();
      state.water = 0;
      state.waterLastAt = Date.now();
      state.waterReminderDay = "";
      state.medicines.forEach(m => {
        m.status = "Pending";
        m.takenAt = "";
      });
      state.mood = "";
      state.moodDate = "";
    }

    state.water = Math.max(0, Number(state.water) || 0);
    state.waterGoal = Math.max(1, Number(state.waterGoal) || 8);
    return state;
  } catch (error) {
    console.warn("Could not read saved demo data.", error);
    return defaultState();
  }
}

let state = loadState();
let toastTimer = null;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save data.", error);
    showToast("Could not save data in this browser.");
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function showHome() {
  $("#homePage").classList.remove("hidden");
  $("#appShell").classList.add("hidden");
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showPage(page) {
  const validPages = [
    "dashboard", "medicines", "wellness",
    "assistant", "notifications", "profile"
  ];
  if (!validPages.includes(page)) return;

  $("#homePage").classList.add("hidden");
  $("#appShell").classList.remove("hidden");

  $$(".app-page").forEach(section => section.classList.add("hidden"));
  const selected = $("#page-" + page);
  if (selected) selected.classList.remove("hidden");

  $$(".nav-item[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  const names = {
    dashboard: "Dashboard",
    medicines: "Medicines",
    wellness: "Wellness",
    assistant: "AI Copilot",
    notifications: "Notifications",
    profile: "My Profile"
  };

  $("#currentPageName").textContent = names[page];
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (page === "notifications") updateNotificationPermission();
  if (page === "assistant") renderChat();
  renderAll();
}

function notify(message) {
  state.notifications.unshift({
    id: Date.now() + Math.random(),
    message,
    time: new Date().toISOString()
  });
  state.notifications = state.notifications.slice(0, 60);
  saveState();
  renderNotifications();

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Health Copilot", {
        body: message,
        tag: "health-copilot-" + todayKey()
      });
    } catch (error) {
      console.warn("Browser notification unavailable.", error);
    }
  } else {
    showToast(message);
  }
}

// GLOBAL NAVIGATION
document.addEventListener("click", event => {
  const goButton = event.target.closest("[data-go]");
  if (goButton) {
    showPage(goButton.dataset.go);
    return;
  }

  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    showPage(pageButton.dataset.page);
    return;
  }

  const moodButton = event.target.closest("[data-mood]");
  if (moodButton) setMood(moodButton.dataset.mood);

  const promptButton = event.target.closest("[data-prompt]");
  if (promptButton) {
    $("#chatInput").value = promptButton.dataset.prompt;
    $("#chatForm").requestSubmit();
  }
});

$("#backHome").addEventListener("click", showHome);
$("#mobileMenu").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});
$("#notificationShortcut").addEventListener("click", () => showPage("notifications"));

// THEME
function applyTheme() {
  document.body.classList.toggle("dark", Boolean(state.dark));
  $("#themeToggle").textContent = state.dark ? "☀" : "☾";
  $("#themeToggle").title = state.dark ? "Switch to light mode" : "Switch to dark mode";
}
$("#themeToggle").addEventListener("click", () => {
  state.dark = !state.dark;
  saveState();
  applyTheme();
});

// DATE AND DASHBOARD
function formatDate(date = new Date()) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function updateGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = state.profile.name.trim();
  $("#dashboardGreeting").textContent = `${greeting}${name ? ", " + name : ""} 👋`;
  $("#todayDate").textContent = formatDate();
  $("#topProfileName").textContent = name || "My Profile";
  $("#profileAvatarLarge").textContent = (name || "U").charAt(0).toUpperCase();
  $(".profile-avatar").textContent = (name || "U").charAt(0).toUpperCase();
}

function renderDashboard() {
  const total = state.medicines.length;
  const taken = state.medicines.filter(m => m.status === "Taken").length;
  const medicinePercent = total ? Math.round(taken / total * 100) : 0;
  const waterPercent = Math.min(100, Math.round(state.water / state.waterGoal * 100));

  $("#dashMedicineCount").textContent = `${taken}/${total}`;
  $("#dashMedicineBar").style.width = medicinePercent + "%";
  $("#dashWaterCount").textContent = state.water;
  $("#dashWaterGoalText").textContent = `Goal: ${state.waterGoal} glasses`;
  $("#dashWaterBar").style.width = waterPercent + "%";
  $("#dashWaterPercent").textContent = waterPercent + "%";
  $("#waterRing").style.setProperty("--water-deg", (waterPercent * 3.6) + "deg");
  $("#waterSummary").textContent = `${state.water} of ${state.waterGoal} glasses`;

  const remaining = Math.max(0, state.waterGoal - state.water);
  $("#waterRemaining").textContent = remaining
    ? `${remaining} more to reach your goal`
    : "Daily goal reached. Well done!";

  $("#dashSleepValue").textContent = `${state.sleep.goal} hrs`;
  $("#dashSleepText").textContent = `${formatTime(state.sleep.bedtime)} bedtime`;
  $("#dashSleepBar").style.width = Math.min(100, state.sleep.goal / 8 * 100) + "%";
  $("#dashMoodValue").textContent =
    state.moodDate === todayKey() && state.mood ? state.mood : "Not set";

  const list = $("#dashMedicineList");
  if (!total) {
    list.innerHTML = `<div class="empty-state"><span>💊</span>No medicines added yet.<br>Add your first medicine to begin.</div>`;
  } else {
    list.innerHTML = state.medicines.slice(0, 4).map(m => `
      <div class="compact-item">
        <div class="list-icon">💊</div>
        <div class="list-main">
          <strong>${escapeHTML(m.name)}</strong>
          <small>${escapeHTML(m.dose)} · ${escapeHTML(formatTime(m.time))}</small>
        </div>
        <span class="medicine-status ${m.status === "Taken" ? "status-taken" : "status-pending"}">${escapeHTML(m.status)}</span>
      </div>`).join("");
  }
}

// MEDICINES
$("#medicineForm").addEventListener("submit", event => {
  event.preventDefault();

  const name = $("#medicineName").value.trim();
  const dose = $("#medicineDose").value.trim();
  const time = $("#medicineTime").value;

  if (!name || !dose || !time) {
    showToast("Please fill in the required medicine details.");
    return;
  }

  state.medicines.push({
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    name,
    dose,
    time,
    frequency: $("#medicineFrequency").value,
    notes: $("#medicineNotes").value.trim(),
    status: "Pending",
    takenAt: "",
    addedAt: new Date().toISOString()
  });

  state.history.unshift({
    text: `Added ${name}`,
    time: new Date().toISOString()
  });
  state.history = state.history.slice(0, 50);

  saveState();
  event.target.reset();
  renderAll();
  showToast("Medicine saved successfully.");
});

function updateMedicineStatus(id, status) {
  const medicine = state.medicines.find(m => m.id === id);
  if (!medicine) return;

  medicine.status = status;
  medicine.takenAt = status === "Taken" ? new Date().toISOString() : "";

  state.history.unshift({
    text: `${medicine.name}: ${status}`,
    time: new Date().toISOString()
  });
  state.history = state.history.slice(0, 50);

  saveState();
  renderAll();
  showToast(status === "Taken" ? "Dose marked as taken." : "Dose marked as pending.");
}

function deleteMedicine(id) {
  const medicine = state.medicines.find(m => m.id === id);
  if (!medicine) return;

  state.medicines = state.medicines.filter(m => m.id !== id);
  state.history.unshift({
    text: `Deleted ${medicine.name}`,
    time: new Date().toISOString()
  });
  state.history = state.history.slice(0, 50);

  saveState();
  renderAll();
  showToast("Medicine removed.");
}

$("#medicineList").addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "take") updateMedicineStatus(button.dataset.id, "Taken");
  if (button.dataset.action === "pending") updateMedicineStatus(button.dataset.id, "Pending");
  if (button.dataset.action === "delete") deleteMedicine(button.dataset.id);
});

function renderMedicines() {
  $("#medicineCounter").textContent = `${state.medicines.length} items`;

  if (!state.medicines.length) {
    $("#medicineList").innerHTML = `<div class="empty-state"><span>💊</span>Your medicine list is empty.<br>Add a medicine using the form.</div>`;
  } else {
    $("#medicineList").innerHTML = state.medicines
      .slice().sort((a, b) => a.time.localeCompare(b.time))
      .map(m => `
        <div class="medicine-card">
          <div class="list-icon">💊</div>
          <div class="list-main">
            <strong>${escapeHTML(m.name)}</strong>
            <small>${escapeHTML(m.dose)} · ${escapeHTML(formatTime(m.time))}</small>
            <small>${escapeHTML(m.frequency)}</small>
            ${m.notes ? `<small>${escapeHTML(m.notes)}</small>` : ""}
            <span class="medicine-status ${m.status === "Taken" ? "status-taken" : "status-pending"}">${escapeHTML(m.status)}</span>
          </div>
          <div class="medicine-actions">
            ${m.status === "Taken"
              ? `<button class="small-btn" data-action="pending" data-id="${escapeHTML(m.id)}">Undo</button>`
              : `<button class="small-btn take" data-action="take" data-id="${escapeHTML(m.id)}">✓ Taken</button>`}
            <button class="small-btn delete" data-action="delete" data-id="${escapeHTML(m.id)}" aria-label="Delete ${escapeHTML(m.name)}">Delete</button>
          </div>
        </div>`).join("");
  }

  const history = $("#medicineHistory");
  if (!state.history.length) {
    history.innerHTML = `<div class="empty-state">No medicine activity recorded yet.</div>`;
  } else {
    history.innerHTML = state.history.slice(0, 12).map(item => `
      <div class="history-item">
        <div class="list-icon">◷</div>
        <div><strong>${escapeHTML(item.text)}</strong><small>${escapeHTML(formatDate(new Date(item.time)))}</small></div>
        <span class="history-time">${escapeHTML(new Date(item.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}))}</span>
      </div>`).join("");
  }
}

// WATER TRACKER
function addWater(amount = 1) {
  state.water = Math.max(0, Math.min(1000, state.water + amount));
  state.waterLastAt = Date.now();
  state.waterReminderDay = "";
  saveState();
  renderAll();

  if (amount > 0) {
    $("#waterMessage").textContent = "Nice work! Your water intake has been updated.";
    showToast("Water intake updated 💧");
  } else {
    $("#waterMessage").textContent = "One glass removed.";
  }
}

$("#addWater").addEventListener("click", () => addWater(1));
$("#removeWater").addEventListener("click", () => addWater(-1));
$("#dashboardAddWater").addEventListener("click", () => addWater(1));

$("#waterGoalInput").addEventListener("change", event => {
  const value = Number(event.target.value);
  if (!Number.isFinite(value) || value < 1 || value > 30) {
    event.target.value = state.waterGoal;
    showToast("Choose a goal between 1 and 30 glasses.");
    return;
  }
  state.waterGoal = Math.round(value);
  saveState();
  renderAll();
});

$("#waterReminderEnabled").addEventListener("change", event => {
  state.waterEnabled = event.target.checked;
  state.waterLastAt = Date.now();
  saveState();
  showToast(state.waterEnabled ? "Water reminders enabled while this page is open." : "Water reminders paused.");
});

$("#waterInterval").addEventListener("change", event => {
  state.waterInterval = Number(event.target.value);
  state.waterLastAt = Date.now();
  saveState();
});

function renderWater() {
  const percent = Math.min(100, Math.round(state.water / state.waterGoal * 100));
  $("#wellnessWaterCount").textContent = state.water;
  $("#wellnessWaterBar").style.width = percent + "%";
  $("#wellnessWaterLabel").textContent = `${percent}% of your ${state.waterGoal}-glass goal`;
  $("#waterGoalInput").value = state.waterGoal;
  $("#waterReminderEnabled").checked = state.waterEnabled;
  $("#waterInterval").value = String(state.waterInterval);
}

// SLEEP
function formatTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return value || "Not set";
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sleepDuration(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

$("#sleepForm").addEventListener("submit", event => {
  event.preventDefault();
  const goal = Number($("#sleepGoal").value);
  if (!Number.isFinite(goal) || goal < 1 || goal > 24) {
    showToast("Choose a sleep goal between 1 and 24 hours.");
    return;
  }

  state.sleep.bedtime = $("#bedtime").value;
  state.sleep.wakeTime = $("#wakeTime").value;
  state.sleep.goal = goal;
  state.sleep.enabled = $("#sleepReminderEnabled").checked;
  state.sleep.firedDay = "";

  saveState();
  renderAll();
  $("#sleepMessage").textContent = "Your sleep routine has been saved.";
  showToast("Sleep routine saved.");
});

function renderSleep() {
  $("#bedtime").value = state.sleep.bedtime;
  $("#wakeTime").value = state.sleep.wakeTime;
  $("#sleepGoal").value = state.sleep.goal;
  $("#sleepReminderEnabled").checked = state.sleep.enabled;

  $("#sleepSummary").textContent =
    `${formatTime(state.sleep.bedtime)} – ${formatTime(state.sleep.wakeTime)}`;
  $("#sleepGoalSummary").textContent =
    `${state.sleep.goal} hours goal · ${sleepDuration(state.sleep.bedtime, state.sleep.wakeTime).toFixed(1)} hours between selected times`;
}

// MOOD TRACKER
function setMood(mood) {
  state.mood = mood;
  state.moodDate = todayKey();
  saveState();

  $$(".mood-option").forEach(button => {
    button.classList.toggle("selected", button.dataset.mood === mood);
  });

  $("#moodMessage").textContent = `Mood saved: ${mood}. Thank you for checking in with yourself.`;
  renderDashboard();
  showToast("Mood check-in saved.");
}

function renderMood() {
  $$(".mood-option").forEach(button => {
    button.classList.toggle(
      "selected",
      state.moodDate === todayKey() && button.dataset.mood === state.mood
    );
  });
  if (state.moodDate === todayKey() && state.mood) {
    $("#moodMessage").textContent = `Today's mood: ${state.mood}.`;
  }
}

// PROFILE
$("#profileForm").addEventListener("submit", event => {
  event.preventDefault();
  state.profile.name = $("#profileName").value.trim();
  state.profile.email = $("#profileEmail").value.trim();
  state.profile.focus = $("#profileFocus").value;
  saveState();
  updateGreeting();
  $("#profileMessage").textContent = "Profile saved in this browser.";
  showToast("Profile updated.");
});

function renderProfile() {
  $("#profileName").value = state.profile.name;
  $("#profileEmail").value = state.profile.email;
  $("#profileFocus").value = state.profile.focus;
  updateGreeting();
}

// CHAT DEMO
function addChatMessage(text, type) {
  state.chat.push({ text, type, time: new Date().toISOString() });
  state.chat = state.chat.slice(-50);
  saveState();
}

function renderChat() {
  const chatWindow = $("#chatWindow");
  const messages = state.chat.length
    ? state.chat
    : [{
        type: "bot",
        text: "Hi there! 💜 I'm your Health Copilot demo. I can share general wellness tips and help you explore the website. What would you like to work on today?"
      }];

  chatWindow.innerHTML = messages.map(message => `
    <div class="chat-bubble ${message.type === "user" ? "user-bubble" : "bot-bubble"}">${escapeHTML(message.text)}</div>
  `).join("");
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function getDemoReply(message) {
  const text = message.toLowerCase();

  if (/\b(hello|hi|hey)\b/.test(text)) {
    return "Hello! 💜 What healthy habit would you like to focus on today?";
  }
  if (text.includes("water") || text.includes("hydrat")) {
    return "Try keeping a water bottle nearby and logging each glass in the Wellness section. Your hydration needs vary with activity, climate and health, so use a goal that suits you.";
  }
  if (text.includes("sleep") || text.includes("bedtime")) {
    return "A consistent sleep and wake time, a relaxing wind-down routine and a comfortable sleep environment can support better sleep habits. You can set your target in the Wellness section.";
  }
  if (text.includes("medicine") || text.includes("pill") || text.includes("dose")) {
    return "You can record your prescribed medicine and mark a dose as taken in the Medicines section. Always follow the prescription and ask your pharmacist or clinician if you are unsure about a dose.";
  }
  if (text.includes("stress") || text.includes("mood") || text.includes("sad")) {
    return "Try a short pause, gentle breathing or talking with someone you trust. You can also record how you feel in the Wellness section. If distress persists or you feel unsafe, seek support from a qualified professional.";
  }
  if (text.includes("routine") || text.includes("habit") || text.includes("healthy")) {
    return "Start small: choose one or two realistic habits, connect them to a regular part of your day, and track your progress without expecting perfection. The Wellness section can help you keep a simple record.";
  }
  return "I'm a simple demo assistant, so my responses are limited. I can offer general tips about hydration, sleep habits, daily routines and how to use this tracker. For medical concerns, please contact a qualified healthcare professional.";
}

$("#chatForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("#chatInput");
  const message = input.value.trim();
  if (!message) return;

  addChatMessage(message, "user");
  addChatMessage(getDemoReply(message), "bot");
  input.value = "";
  renderChat();
});

$("#clearChat").addEventListener("click", () => {
  state.chat = [];
  saveState();
  renderChat();
  showToast("Chat cleared.");
});

// NOTIFICATIONS
async function enableBrowserNotifications() {
  if (!("Notification" in window)) {
    showToast("This browser does not support notifications.");
    updateNotificationPermission();
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    updateNotificationPermission();

    if (permission === "granted") {
      showToast("Browser notifications enabled.");
    } else {
      showToast("Notification permission was not granted.");
    }
  } catch (error) {
    showToast("Could not request notification permission.");
  }
}

$("#enableNotifications").addEventListener("click", enableBrowserNotifications);

function updateNotificationPermission() {
  let status = "Browser notifications are not supported here.";
  let granted = false;

  if ("Notification" in window) {
    status = `Permission status: ${Notification.permission}`;
    granted = Notification.permission === "granted";
  }

  $("#permissionStatus").textContent = status;
  $("#enableNotifications").textContent = granted ? "Enabled" : "Enable";
  $("#enableNotifications").disabled = granted;
}

function renderNotifications() {
  const container = $("#notificationList");
  if (!state.notifications.length) {
    container.innerHTML = `<div class="empty-state">No notifications yet.</div>`;
    return;
  }

  container.innerHTML = state.notifications.slice(0, 30).map(item => `
    <div class="history-item">
      <div class="list-icon">♧</div>
      <div><strong>${escapeHTML(item.message)}</strong><small>${escapeHTML(formatDate(new Date(item.time)))}</small></div>
      <span class="history-time">${escapeHTML(new Date(item.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}))}</span>
    </div>`).join("");
}

$("#clearNotifications").addEventListener("click", () => {
  state.notifications = [];
  saveState();
  renderNotifications();
  showToast("Notification history cleared.");
});

// IN-PAGE REMINDER CHECKS
function checkReminders() {
  const now = new Date();
  const today = todayKey();
  const currentTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  if (
    state.waterEnabled &&
    Date.now() - state.waterLastAt >= state.waterInterval * 60 * 1000 &&
    state.waterReminderDay !== `${today}-${currentTime}`
  ) {
    state.waterReminderDay = `${today}-${currentTime}`;
    state.waterLastAt = Date.now();
    saveState();
    notify("Time for a hydration check-in 💧");
  }

  if (
    state.sleep.enabled &&
    currentTime === state.sleep.bedtime &&
    state.sleep.firedDay !== today
  ) {
    state.sleep.firedDay = today;
    saveState();
    notify("Your planned bedtime is now. Time to wind down 🌙");
  }

  // Medicine times generate a reminder but do not automatically
  // mark a dose as missed or taken.
  state.medicines.forEach(medicine => {
    if (
      medicine.time === currentTime &&
      medicine.status === "Pending" &&
      medicine.lastReminderDay !== today
    ) {
      medicine.lastReminderDay = today;
      saveState();
      notify(`Medicine reminder: ${medicine.name}. Check your prescription.`);
    }
  });
}

// RESET DEMO DATA
$("#resetData").addEventListener("click", () => {
  const confirmed = window.confirm(
    "Reset all Health Copilot demo data saved in this browser? This cannot be undone."
  );
  if (!confirmed) return;

  state = defaultState();
  saveState();
  applyTheme();
  renderAll();
  showPage("dashboard");
  showToast("Demo data has been reset.");
});

// RENDER
function renderAll() {
  updateGreeting();
  renderDashboard();
  renderMedicines();
  renderWater();
  renderSleep();
  renderMood();
  renderProfile();
  renderNotifications();
}

function init() {
  applyTheme();
  renderAll();
  showHome();

  // Check once per second while the page remains open.
  setInterval(checkReminders, 1000);

  // Avoid showing a stale reminder immediately after a reload.
  if (!state.waterLastAt) {
    state.waterLastAt = Date.now();
    saveState();
  }
}

init();
