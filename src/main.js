const { invoke } = window.__TAURI__.core;
const { openUrl } = window.__TAURI__["opener"];
const { check } = window.__TAURI__["updater"];
const { relaunch } = window.__TAURI__["process"];
const { getVersion } = window.__TAURI__["app"];

// ── DOM refs ────────────────────────────────────────────────

const logArea = () => document.getElementById("log-area");
const statusDot = () => document.getElementById("status-dot");
const statusText = () => document.getElementById("status-text");
const countSelected = () => document.getElementById("count-selected");
const countRestored = () => document.getElementById("count-restored");

const btnLaunch = () => document.getElementById("btn-launch");
const btnSelect = () => document.getElementById("btn-select");
const btnRestore = () => document.getElementById("btn-restore");
const btnClearLog = () => document.getElementById("btn-clear-log");

// ── State ───────────────────────────────────────────────────

let browserLaunched = false;
let totalRestored = 0;

// Called from Rust when the iCloud window is closed
window.__onICloudClosed = () => {
  browserLaunched = false;
  setStatus("disconnected", "Disconnected");
  enableActionButtons(false);
  btnLaunch().disabled = false;
  log("iCloud window closed.", "warn");
};


// ── Logging ─────────────────────────────────────────────────

function log(message, level = "") {
  const area = logArea();
  const entry = document.createElement("div");
  entry.className = "log-entry" + (level ? ` log-${level}` : "");

  const now = new Date();
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(String(message))}`;
  area.appendChild(entry);
  area.scrollTop = area.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ── Status ──────────────────────────────────────────────────

function setStatus(state, text) {
  const dot = statusDot();
  const label = statusText();
  dot.className = "status-dot";
  if (state === "connected" || state === "working") {
    dot.classList.add(state);
  }
  label.textContent = text;
}

function updateCounters(selected, restored) {
  if (selected !== undefined && selected !== null) countSelected().textContent = selected;
  if (restored !== undefined && restored !== null) countRestored().textContent = restored;
}

function enableActionButtons(enabled) {
  btnSelect().disabled = !enabled;
  btnRestore().disabled = !enabled;
}

function showLoader(on) {
  document.getElementById("loader-bar").classList.toggle("active", on);
}

// ── Actions ─────────────────────────────────────────────────

async function launchBrowser() {
  if (browserLaunched) {
    log("Browser already launched.", "warn");
    return;
  }
  try {
    setStatus("working", "Launching...");
    showLoader(true);
    btnLaunch().disabled = true;
    log("Opening iCloud window...");
    const result = await invoke("open_icloud_window");
    browserLaunched = true;
    setStatus("connected", "Connected");
    enableActionButtons(true);
    log(result?.status || "iCloud window opened.", "success");
  } catch (err) {
    setStatus("disconnected", "Disconnected");
    btnLaunch().disabled = false;
    log(`Failed to open iCloud window: ${err}`, "error");
  } finally {
    showLoader(false);
  }
}

async function selectBatch() {
  const count = parseInt(document.getElementById("batch-size").value) || 500;
  try {
    setStatus("working", `Selecting ${count}...`);
    showLoader(true);
    enableActionButtons(false);
    log(`Selecting up to ${count} items... please check the iCloud window and click Restore / Confirm when ready.`);
    await invoke("select_batch", { count });
    // Fire-and-forget: wait ~10 seconds then assume done
    setTimeout(() => {
      setStatus("connected", "Connected");
      showLoader(false);
      enableActionButtons(true);
      updateCounters(count, null);
      log(`Selection sent. Check the iCloud window to verify items are selected.`, "success");
    }, 10000);
  } catch (err) {
    setStatus("connected", "Connected");
    showLoader(false);
    enableActionButtons(true);
    log(`Selection failed: ${err}`, "error");
  }
}

async function clickRestore() {
  try {
    log("Clicking restore/confirm...");
    await invoke("click_restore");
    const selectedCount = parseInt(countSelected().textContent) || 0;
    if (selectedCount > 0) {
      totalRestored += selectedCount;
      updateCounters(0, totalRestored);
      log(`Restore clicked for ${selectedCount} items. Total this session: ${totalRestored}`, "success");
    } else {
      log("Restore/confirm clicked.", "success");
    }
  } catch (err) {
    log(`Restore failed: ${err}`, "error");
  }
}

// ── Init ────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  btnLaunch().addEventListener("click", launchBrowser);
  btnSelect().addEventListener("click", selectBatch);
  btnRestore().addEventListener("click", clickRestore);
  btnClearLog().addEventListener("click", () => {
    logArea().innerHTML = "";
  });

  // Welcome splash - show on first launch
  const modalWelcome = document.getElementById("modal-welcome");
  document.getElementById("btn-welcome-start").addEventListener("click", () => {
    modalWelcome.classList.remove("active");
  });

  // Open external links in welcome screen
  modalWelcome.querySelectorAll(".donate-link, .brand-link, .mail-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl(link.href);
    });
  });

  // Modal handlers
  const modalHelp = document.getElementById("modal-help");
  const modalDonate = document.getElementById("modal-donate");

  document.getElementById("btn-help").addEventListener("click", () => {
    modalHelp.classList.add("active");
  });
document.getElementById("close-help").addEventListener("click", () => {
    modalHelp.classList.remove("active");
  });
  document.getElementById("btn-donate").addEventListener("click", () => {
    modalDonate.classList.add("active");
  });

  // Open external links in system browser
  document.querySelectorAll(".donate-link, .brand-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl(link.href);
    });
  });
  document.getElementById("close-donate").addEventListener("click", () => {
    modalDonate.classList.remove("active");
  });

  // Close modals on overlay click
  [modalHelp, modalDonate].forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("active");
    });
  });

  setStatus("disconnected", "Disconnected");
  getVersion().then(v => {
    document.getElementById("app-version").textContent = `v${v}`;
  });
  log("iRevive ready.", "info");

  // Check for updates silently
  checkForUpdates();
});

async function checkForUpdates() {
  try {
    const update = await check();
    if (update) {
      log(`Update available: v${update.version}`, "info");
      showUpdateModal(update);
    }
  } catch (e) {
    // Silently ignore update check failures
  }
}

function showUpdateModal(update) {
  const modal = document.getElementById("modal-update");
  document.getElementById("update-version").textContent = `v${update.version}`;
  modal.classList.add("active");

  document.getElementById("btn-update-now").onclick = async () => {
    modal.classList.remove("active");
    log("Downloading update...", "info");
    showLoader(true);
    await update.downloadAndInstall();
    showLoader(false);
    // Show restart prompt
    showRestartModal();
  };

  document.getElementById("btn-update-ignore").onclick = () => {
    modal.classList.remove("active");
    log("Update skipped.", "warn");
  };
}

function showRestartModal() {
  const modal = document.getElementById("modal-restart");
  modal.classList.add("active");

  document.getElementById("btn-restart-now").onclick = async () => {
    await relaunch();
  };

  document.getElementById("btn-restart-later").onclick = () => {
    modal.classList.remove("active");
    log("Update installed. Restart to apply.", "info");
  };
}
