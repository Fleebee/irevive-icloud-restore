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
const btnAuto = () => document.getElementById("btn-auto");

// ── State ───────────────────────────────────────────────────

let browserLaunched = false;
let totalRestored = 0;

// Auto mode state
let autoModeActive = false;
let autoTimerInterval = null;
let autoTimeoutId = null;
let autoCycleCount = 0;

// Called from Rust when the iCloud window is closed
window.__onICloudClosed = () => {
  browserLaunched = false;
  if (autoModeActive) stopAutoMode();
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
  btnAuto().disabled = !enabled;
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

// ── Auto Mode ──────────────────────────────────────────────

function getAutoWaitMs() {
  const mins = parseInt(document.getElementById("auto-wait-time").value) || 5;
  return mins * 60 * 1000;
}

function startAutoMode() {
  autoModeActive = true;
  autoCycleCount = 0;
  btnAuto().textContent = "Stop Auto";
  btnAuto().classList.add("active");
  btnSelect().disabled = true;
  btnRestore().disabled = true;
  const waitMins = (getAutoWaitMs() / 60000);
  log(`Auto mode started. Will cycle: Select → Wait ${waitMins}m → Restore → Wait ${waitMins}m → Repeat`, "info");
  runAutoCycle();
}

function stopAutoMode() {
  autoModeActive = false;
  clearInterval(autoTimerInterval);
  clearTimeout(autoTimeoutId);
  autoTimerInterval = null;
  autoTimeoutId = null;
  hideAutoTimer();
  btnAuto().textContent = "Auto Mode";
  btnAuto().classList.remove("active");
  if (browserLaunched) {
    btnSelect().disabled = false;
    btnRestore().disabled = false;
  }
  showLoader(false);
  setStatus("connected", "Connected");
  log(`Auto mode stopped. Completed ${autoCycleCount} full cycles.`, "warn");
}

function toggleAutoMode() {
  if (autoModeActive) {
    stopAutoMode();
  } else {
    startAutoMode();
  }
}

async function runAutoCycle() {
  if (!autoModeActive || !browserLaunched) return;

  // Step 1: Select batch
  const count = parseInt(document.getElementById("batch-size").value) || 500;
  try {
    setStatus("working", `Auto: Selecting ${count}...`);
    showLoader(true);
    log(`[Auto] Cycle ${autoCycleCount + 1}: Selecting ${count} items...`);
    await invoke("select_batch", { count });
    updateCounters(count, null);
  } catch (err) {
    log(`[Auto] Selection failed: ${err}`, "error");
  }
  showLoader(false);

  if (!autoModeActive) return;

  // Step 2: Wait 5 minutes for selection to settle
  log(`[Auto] Waiting ${(getAutoWaitMs() / 60000)} minutes for selection to settle...`);
  setStatus("connected", "Auto: Waiting (select)");
  await autoWait("Selecting... Restore in");

  if (!autoModeActive) return;

  // Step 3: Click restore
  try {
    setStatus("working", "Auto: Restoring...");
    showLoader(true);
    log("[Auto] Clicking restore/confirm...");
    await invoke("click_restore");
    const selectedCount = parseInt(countSelected().textContent) || 0;
    if (selectedCount > 0) {
      totalRestored += selectedCount;
      updateCounters(0, totalRestored);
      log(`[Auto] Restore clicked for ${selectedCount} items. Total: ${totalRestored}`, "success");
    } else {
      log("[Auto] Restore/confirm clicked.", "success");
    }
  } catch (err) {
    log(`[Auto] Restore failed: ${err}`, "error");
  }
  showLoader(false);

  if (!autoModeActive) return;

  autoCycleCount++;

  // Step 4: Wait 5 minutes before next cycle
  log(`[Auto] Waiting ${(getAutoWaitMs() / 60000)} minutes before next cycle...`);
  setStatus("connected", "Auto: Waiting (restore)");
  await autoWait("Restoring... Next select in");

  if (!autoModeActive) return;

  // Repeat
  runAutoCycle();
}

function autoWait(label) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const endTime = startTime + getAutoWaitMs();

    showAutoTimer();

    autoTimerInterval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / getAutoWaitMs());

      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

      updateAutoTimer(progress, `${label} ${timeStr}`);

      if (remaining <= 0) {
        clearInterval(autoTimerInterval);
        autoTimerInterval = null;
        hideAutoTimer();
        resolve();
      }
    }, 250);

    autoTimeoutId = setTimeout(() => {
      clearInterval(autoTimerInterval);
      autoTimerInterval = null;
      hideAutoTimer();
      resolve();
    }, getAutoWaitMs());
  });
}

function showAutoTimer() {
  document.getElementById("auto-timer-bar").classList.add("active");
}

function hideAutoTimer() {
  document.getElementById("auto-timer-bar").classList.remove("active");
  document.getElementById("auto-timer-fill").style.width = "0%";
  document.getElementById("auto-timer-label").textContent = "";
}

function updateAutoTimer(progress, label) {
  document.getElementById("auto-timer-fill").style.width = `${progress * 100}%`;
  document.getElementById("auto-timer-label").textContent = label;
}

// ── Init ────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  btnLaunch().addEventListener("click", launchBrowser);
  btnSelect().addEventListener("click", selectBatch);
  btnRestore().addEventListener("click", clickRestore);
  btnAuto().addEventListener("click", toggleAutoMode);
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

  // Auto mode slider label
  const autoSlider = document.getElementById("auto-wait-time");
  const autoSliderValue = document.getElementById("auto-slider-value");
  autoSlider.addEventListener("input", () => {
    autoSliderValue.textContent = `${autoSlider.value} min`;
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
    const fallback = document.getElementById("update-fallback");
    fallback.innerHTML = "";
    log("Downloading update...", "info");
    showLoader(true);

    // Show fallback link after 15 seconds
    const fallbackTimer = setTimeout(() => {
      fallback.innerHTML = `Download taking too long? <a href="https://github.com/Fleebee/irevive-icloud-restore/releases/latest/download/iRevive_aarch64.dmg" class="update-fallback-link">Download manually</a>`;
      fallback.querySelector(".update-fallback-link").addEventListener("click", (e) => {
        e.preventDefault();
        openUrl("https://github.com/Fleebee/irevive-icloud-restore/releases/latest/download/iRevive_aarch64.dmg");
      });
    }, 15000);

    try {
      await update.downloadAndInstall();
      clearTimeout(fallbackTimer);
      showLoader(false);
      modal.classList.remove("active");
      showRestartModal();
    } catch (err) {
      clearTimeout(fallbackTimer);
      showLoader(false);
      log(`Update download failed: ${err}`, "error");
      fallback.innerHTML = `Download failed. <a href="https://github.com/Fleebee/irevive-icloud-restore/releases/latest/download/iRevive_aarch64.dmg" class="update-fallback-link">Download manually</a>`;
      fallback.querySelector(".update-fallback-link").addEventListener("click", (e) => {
        e.preventDefault();
        openUrl("https://github.com/Fleebee/irevive-icloud-restore/releases/latest/download/iRevive_aarch64.dmg");
      });
    }
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
