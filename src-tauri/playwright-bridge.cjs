/**
 * Playwright bridge script for iCloud Restore GUI.
 *
 * Communication protocol:
 *   - Reads one JSON object per line from stdin
 *   - Writes one JSON object per line to stdout
 *   - All logging goes to stderr (stdout is reserved for the protocol)
 */

const { chromium } = require("playwright");
const readline = require("readline");

const log = (...args) =>
  process.stderr.write(args.map(String).join(" ") + "\n");

let browser = null;
let page = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function handleLaunch() {
  log("[bridge] Launching Chromium (headed)...");
  browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  page = await context.newPage();
  await page.goto("https://www.icloud.com/recovery", {
    waitUntil: "domcontentloaded",
  });
  log("[bridge] Browser launched, navigated to iCloud recovery.");
  return { ok: true, status: "Browser launched" };
}

async function handleScan() {
  if (!page) return { ok: false, error: "Browser not launched" };

  const counts = await page.evaluate(() => {
    const stdCheckboxes = document.querySelectorAll(
      'input[type="checkbox"]'
    ).length;
    const stdUnchecked = document.querySelectorAll(
      'input[type="checkbox"]:not(:checked)'
    ).length;
    const ariaCheckboxes = document.querySelectorAll(
      '[role="checkbox"]'
    ).length;
    const ariaUnchecked = document.querySelectorAll(
      '[role="checkbox"][aria-checked="false"]'
    ).length;
    const rows = document.querySelectorAll('[role="row"]').length;
    const listItems = document.querySelectorAll('[role="listitem"]').length;
    const options = document.querySelectorAll('[role="option"]').length;
    const selectedRows = document.querySelectorAll(
      '[role="row"][aria-selected="true"]'
    ).length;
    const buttons = document.querySelectorAll(
      'button, [role="button"]'
    ).length;
    return {
      stdCheckboxes,
      stdUnchecked,
      ariaCheckboxes,
      ariaUnchecked,
      rows,
      listItems,
      options,
      selectedRows,
      buttons,
    };
  });

  return { ok: true, ...counts };
}

async function handleSelect(count) {
  if (!page) return { ok: false, error: "Browser not launched" };

  let selected = 0;
  let method = "";

  // Strategy 1: standard unchecked checkboxes
  selected = await page.evaluate((n) => {
    const els = Array.from(
      document.querySelectorAll('input[type="checkbox"]:not(:checked)')
    );
    let clicked = 0;
    for (const el of els.slice(0, n)) {
      el.scrollIntoView({ block: "center" });
      el.click();
      clicked++;
    }
    return clicked;
  }, count);

  if (selected > 0) {
    method = "standard-checkbox";
    return { ok: true, selected, method };
  }

  // Strategy 2: aria checkboxes
  selected = await page.evaluate((n) => {
    const els = Array.from(
      document.querySelectorAll('[role="checkbox"][aria-checked="false"]')
    );
    let clicked = 0;
    for (const el of els.slice(0, n)) {
      el.scrollIntoView({ block: "center" });
      el.click();
      clicked++;
    }
    return clicked;
  }, count);

  if (selected > 0) {
    method = "aria-checkbox";
    return { ok: true, selected, method };
  }

  // Strategy 3: selectable rows
  selected = await page.evaluate((n) => {
    const selectors = [
      '[role="row"]:not([aria-selected="true"])',
      '[role="listitem"]',
      '[role="option"]',
    ];
    let clicked = 0;
    for (const sel of selectors) {
      if (clicked >= n) break;
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els.slice(0, n - clicked)) {
        el.scrollIntoView({ block: "center" });
        el.click();
        clicked++;
      }
      if (clicked > 0) break; // use whichever selector worked first
    }
    return clicked;
  }, count);

  if (selected > 0) {
    method = "row-click";
    return { ok: true, selected, method };
  }

  return { ok: true, selected: 0, method: "none-found" };
}

async function handleRestore() {
  if (!page) return { ok: false, error: "Browser not launched" };

  const result = await page.evaluate(() => {
    // Find all buttons / role=button
    const allBtns = Array.from(
      document.querySelectorAll('button, [role="button"]')
    );

    // Filter to those containing restore/recover text, excluding nav/tile
    const restoreBtn = allBtns.find((btn) => {
      const text = (btn.textContent || "").toLowerCase();
      if (!text.includes("restore") && !text.includes("recover")) return false;
      if (btn.closest(".tile-article")) return false;
      if (btn.closest(".nav-link")) return false;
      if (btn.classList.contains("tile-article")) return false;
      if (btn.classList.contains("nav-link")) return false;
      return true;
    });

    if (!restoreBtn) {
      return { ok: false, error: "No restore/recover button found" };
    }

    // Scroll modal/dialog container to bottom first
    const modal =
      restoreBtn.closest('[role="dialog"]') ||
      restoreBtn.closest(".modal") ||
      restoreBtn.closest('[class*="modal"]') ||
      restoreBtn.closest('[class*="dialog"]');
    if (modal) {
      modal.scrollTop = modal.scrollHeight;
    }

    // Scroll the button into view and click
    restoreBtn.scrollIntoView({ block: "center", behavior: "instant" });
    restoreBtn.click();

    return {
      ok: true,
      status: "Clicked restore button",
      buttonText: restoreBtn.textContent.trim().slice(0, 80),
    };
  });

  return result;
}

async function handleDump() {
  if (!page) return { ok: false, error: "Browser not launched" };

  const html = await page.evaluate(() => {
    const main =
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.querySelector("#content") ||
      document.querySelector(".app-content") ||
      document.body;
    // Return a trimmed snippet (first 50000 chars)
    return (main.innerHTML || "").slice(0, 50000);
  });

  return { ok: true, html };
}

async function handleStatus() {
  if (!page) return { ok: false, error: "Browser not launched" };

  const counts = await page.evaluate(() => {
    const checkboxes = document.querySelectorAll(
      'input[type="checkbox"]'
    ).length;
    const checked = document.querySelectorAll(
      'input[type="checkbox"]:checked'
    ).length;
    const ariaCheckboxes = document.querySelectorAll(
      '[role="checkbox"]'
    ).length;
    const ariaChecked = document.querySelectorAll(
      '[role="checkbox"][aria-checked="true"]'
    ).length;
    const rows = document.querySelectorAll('[role="row"]').length;
    const selectedRows = document.querySelectorAll(
      '[role="row"][aria-selected="true"]'
    ).length;
    return { checkboxes, checked, ariaCheckboxes, ariaChecked, rows, selectedRows };
  });

  return { ok: true, ...counts };
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: "Invalid JSON: " + e.message }) + "\n"
    );
    return;
  }

  let response;
  try {
    switch (msg.action) {
      case "launch":
        response = await handleLaunch();
        break;
      case "scan":
        response = await handleScan();
        break;
      case "select":
        response = await handleSelect(msg.count || 500);
        break;
      case "restore":
        response = await handleRestore();
        break;
      case "dump":
        response = await handleDump();
        break;
      case "status":
        response = await handleStatus();
        break;
      default:
        response = { ok: false, error: "Unknown action: " + msg.action };
    }
  } catch (err) {
    response = { ok: false, error: String(err) };
  }

  process.stdout.write(JSON.stringify(response) + "\n");
});

rl.on("close", async () => {
  log("[bridge] stdin closed, shutting down...");
  if (browser) {
    try {
      await browser.close();
    } catch (_) {}
  }
  process.exit(0);
});
