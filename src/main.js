const { invoke } = window.__TAURI__.core;
const { openUrl } = window.__TAURI__["opener"];

// ── DOM refs ────────────────────────────────────────────────

const logArea = () => document.getElementById("log-area");
const statusDot = () => document.getElementById("status-dot");
const statusText = () => document.getElementById("status-text");
const countTotal = () => document.getElementById("count-total");
const countSelected = () => document.getElementById("count-selected");
const countRestored = () => document.getElementById("count-restored");

const btnLaunch = () => document.getElementById("btn-launch");
const btnScan = () => document.getElementById("btn-scan");
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

function updateCounters(total, selected, restored) {
  if (total !== undefined && total !== null) countTotal().textContent = total;
  if (selected !== undefined && selected !== null) countSelected().textContent = selected;
  if (restored !== undefined && restored !== null) countRestored().textContent = restored;
}

function enableActionButtons(enabled) {
  btnScan().disabled = !enabled;
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

async function scanPage() {
  try {
    setStatus("working", "Scanning...");
    showLoader(true);
    log("Scanning page for selectable elements...");
    const r = await invoke("scan_page");
    setStatus("connected", "Connected");

    if (r && r.ok) {
      // Items are represented by multiple overlapping selectors (checkbox + aria + row),
      // so use the highest single count as the true item count
      const total = Math.max(
        r.stdCheckboxes || 0,
        r.ariaCheckboxes || 0,
        r.rows || 0,
        r.listItems || 0,
        r.options || 0
      );
      const checked = Math.max(
        (r.stdCheckboxes || 0) - (r.stdUnchecked || 0),
        (r.ariaCheckboxes || 0) - (r.ariaUnchecked || 0),
        r.selectedRows || 0
      );
      updateCounters(total, checked, undefined);
      log(
        `Scan: ${total} items on page (${checked} selected)`,
        "success"
      );
      log(`  Raw: ${r.stdCheckboxes || 0} checkboxes, ${r.ariaCheckboxes || 0} aria, ${r.rows || 0} rows, ${r.buttons || 0} buttons`);
    } else {
      log(r?.error || "Scan returned no data.", "error");
    }
  } catch (err) {
    setStatus("connected", "Connected");
    log(`Scan failed: ${err}`, "error");
  } finally {
    showLoader(false);
  }
}

async function selectBatch() {
  try {
    setStatus("working", "Selecting 500...");
    showLoader(true);
    log("Selecting next batch of 500 items...");
    const r = await invoke("select_batch");
    setStatus("connected", "Connected");

    if (r && r.ok) {
      // Show only what was just selected - scan will give accurate total
      updateCounters(undefined, r.selected || 0, undefined);
      log(`Selected ${r.selected} items (method: ${r.method})`, "success");
      if (r.selected === 0) {
        log("No unchecked items found. Try scanning first or check if items have loaded.", "warn");
      }
    } else {
      log(r?.error || "Selection returned no data.", "error");
    }
  } catch (err) {
    setStatus("connected", "Connected");
    log(`Selection failed: ${err}`, "error");
  } finally {
    showLoader(false);
  }
}

async function clickRestore() {
  try {
    setStatus("working", "Restoring...");
    showLoader(true);
    log("Clicking restore button...");
    const r = await invoke("click_restore");
    setStatus("connected", "Connected");

    if (r && r.ok) {
      // Try to extract actual count from button text like "Restore 50 Files"
      const btnText = r.buttonText || r.status || "";
      const match = btnText.match(/(\d+)/);
      const restoredCount = match ? parseInt(match[1]) : (parseInt(countSelected().textContent) || 0);
      totalRestored += restoredCount;
      updateCounters(undefined, 0, totalRestored);
      log(`Restore clicked: "${btnText}" (${restoredCount} files)`, "success");
      log(`Total restored this session: ${totalRestored}`);
    } else {
      log(r?.error || "Could not find restore button.", "error");
    }
  } catch (err) {
    setStatus("connected", "Connected");
    log(`Restore failed: ${err}`, "error");
  } finally {
    showLoader(false);
  }
}

// ── Init ────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  btnLaunch().addEventListener("click", launchBrowser);
  btnScan().addEventListener("click", scanPage);
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
  log("iRevive ready. Click ? for instructions.", "info");
});
