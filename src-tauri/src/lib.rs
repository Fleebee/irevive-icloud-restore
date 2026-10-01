use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Manager;

mod tickets;

struct AppState {
    icloud_open: Mutex<bool>,
}

/// Fire JS in the iCloud webview without waiting for a result.
///
/// The script can call `report({...})` to send what it actually did back to
/// the main window (see `icloud_report`). Nothing here waits on that, so a
/// report that never arrives can't hang anything; the main window times out.
fn fire_js(app_handle: &tauri::AppHandle, js_code: &str) -> Result<(), String> {
    let icloud_win = app_handle
        .get_webview_window("icloud")
        .ok_or("iCloud window not open. Click 'Open iCloud' first.")?;

    let wrapped_js = format!(
        r#"(async () => {{
            const report = (r) => {{
                try {{ window.__TAURI_INTERNALS__.invoke("icloud_report", {{ report: r }}); }}
                catch (e) {{ console.error("iRevive report failed:", e); }}
            }};
            // Anything started before the user pressed Cancel stops early.
            const startedAt = Date.now();
            const cancelled = () => (window.__ireviveCancelAt || 0) > startedAt;
            try {{ {js_code} }} catch(e) {{ console.error("iRevive error:", e); }}
        }})();"#,
    );

    icloud_win
        .eval(&wrapped_js)
        .map_err(|e| format!("eval failed: {}", e))
}

#[tauri::command]
async fn open_icloud_window(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    // Check if already open
    if let Some(win) = app_handle.get_webview_window("icloud") {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(json!({"ok": true, "status": "iCloud window focused"}));
    }

    #[allow(unused_mut)]
    let mut url = "https://www.icloud.com/recovery".to_string();
    // Debug builds can load a stand-in page instead, to try the selection
    // scripts without an Apple ID: IREVIVE_ICLOUD_URL=file:///... npm run tauri dev
    #[cfg(debug_assertions)]
    if let Ok(test_url) = std::env::var("IREVIVE_ICLOUD_URL") {
        url = test_url;
    }

    let win = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "icloud",
        tauri::WebviewUrl::External(url.parse().map_err(|e| format!("Bad iCloud URL: {}", e))?),
    )
    .title("iCloud Recovery - Sign In")
    .inner_size(800.0, 700.0)
    .position(50.0, 50.0)
    .build()
    .map_err(|e| format!("Failed to create iCloud window: {}", e))?;

    // Listen for the iCloud window being closed
    let handle = app_handle.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            // Notify the main window that iCloud window was closed
            if let Some(main_win) = handle.get_webview_window("main") {
                let _ = main_win.eval("window.__onICloudClosed && window.__onICloudClosed()");
            }
        }
    });

    *state.icloud_open.lock().map_err(|e| e.to_string())? = true;

    Ok(json!({"ok": true, "status": "iCloud window opened"}))
}

/// Page helpers shared by the selection and restore scripts. iCloud's markup
/// isn't ours, so each looks for real checkboxes first, then ARIA ones, then
/// selectable rows.
const PAGE_HELPERS: &str = r#"
    const delay = ms => new Promise(r => setTimeout(r, ms));

    const unselected = () => {
        const boxes = document.querySelectorAll('input[type="checkbox"]:not(:checked)');
        if (boxes.length) return Array.from(boxes);
        const aria = document.querySelectorAll('[role="checkbox"][aria-checked="false"]');
        if (aria.length) return Array.from(aria);
        for (const sel of ['[role="row"]:not([aria-selected="true"])', '[role="listitem"]', '[role="option"]']) {
            const els = document.querySelectorAll(sel);
            if (els.length) return Array.from(els);
        }
        return [];
    };

    const selectedEls = () => {
        for (const sel of ['input[type="checkbox"]:checked', '[role="checkbox"][aria-checked="true"]', '[role="row"][aria-selected="true"]']) {
            const els = document.querySelectorAll(sel);
            if (els.length) return Array.from(els);
        }
        return [];
    };

    const pageText = el => (el?.textContent || "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();

    const selectedCount = () => {
        // iCloud can recycle the selected rows out of the rendered list. The
        // recovery footer still reports the complete selected batch.
        const button = restoreButton();
        const text = pageText(button);
        const match = text.match(/^(?:恢复|恢復|復原|還原|回復)\s*([\d,，]+)\s*(?:个|個)?\s*(?:文件|檔案)$/)
            || text.match(/^(?:restore|recover)\s+([\d,]+)\s+files?$/i);
        return match ? Number(match[1].replace(/[,，]/g, '')) : selectedEls().length;
    };
    const visibleButton = btn => btn.getClientRects().length > 0;
    const buttonEnabled = btn => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
    const restoreButton = () => {
        // The action footer may be a sibling of .file-recovery-modal-content,
        // not its child. Include it while excluding background tiles/nav.
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(btn =>
            visibleButton(btn)
            && /^(restore|recover|恢复|恢復|復原|還原|回復)(?:\s|\d|$)/i.test(pageText(btn))
            && !btn.closest('.tile-article') && !btn.closest('.nav-link'));
        return buttons.find(buttonEnabled) || buttons[0] || null;
    };

    const confirmation = () => {
        const button = Array.from(document.querySelectorAll('button, [role="button"]'))
            .find(btn => visibleButton(btn) && buttonEnabled(btn)
                && /^(ok|done|got it|好|确定|完成|知道了)$/i.test(pageText(btn)));
        if (!button) return null;
        const scope = button.closest('[role="dialog"]') || button.closest('[class*="modal"]') || document;
        const headings = Array.from(scope.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'));
        for (const heading of headings) {
            const text = pageText(heading);
            const match = text.match(/已(?:恢复|恢復|復原|還原|回復)\s*([\d,，]+)\s*(?:个|個)?\s*(?:文件|檔案)/)
                || text.match(/([\d,]+)\s+files?\s+(?:were\s+|was\s+)?(?:restored|recovered)/i)
                || text.match(/(?:restored|recovered)\s+([\d,]+)\s+files?/i);
            if (match) return { button, restored: Number(match[1].replace(/[,，]/g, '')) };
        }
        return null;
    };

    // Apple's "There was a problem loading all restorable files. Try Again",
    // shown when its server fails to list deleted files (HTTP 500). Returns
    // the Try Again button, or null. While the Restore Files dialog is open
    // only its own counts: the tile behind it has a Try Again of its own that
    // can stay up after the dialog's list has loaded.
    const appleErrorRetry = () => {
        const scope = document.querySelector(".file-recovery-modal-content") || document;
        return Array.from(scope.querySelectorAll('button, [role="button"], a'))
            .find(el => /^(try again|重试|再试一次|再试)$/i.test(pageText(el))) || null;
    };
"#;

/// Ticks up to `count` items, then reports how many are actually selected.
///
/// With `wait_ms`, it first waits for iCloud's file list to hold still for
/// `settle_ms`, so it doesn't select from a list that's still loading after a
/// restore. It gives up waiting after `wait_ms` and selects whatever is there.
///
/// If Apple's loading error shows while it waits, it clicks Try Again, up to
/// `max_retries` times and no more than every 20s. It reports an Apple error
/// if the error is still up at the end, or if it showed and no files have
/// loaded since: after Try Again, Apple's page can spin for a long time
/// before failing again.
#[tauri::command]
async fn select_batch(
    app_handle: tauri::AppHandle,
    count: Option<u32>,
    wait_ms: Option<u64>,
    settle_ms: Option<u64>,
    max_retries: Option<u32>,
    ready_when_count: Option<bool>,
    request_id: u64,
) -> Result<Value, String> {
    let n = count.unwrap_or(500).clamp(1, 5000);
    if let Some(win) = app_handle.get_webview_window("icloud") {
        win.unminimize().map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
    }
    let wait_ms = wait_ms.unwrap_or(0);
    let settle_ms = settle_ms.unwrap_or(3000);
    let max_retries = max_retries.unwrap_or(0);
    let ready_when_count = ready_when_count.unwrap_or(false);
    let js = format!(
        r#"
        {PAGE_HELPERS}
        const limit = {n};
        const started = Date.now();

        // A short list might still be growing, so it gets at least 10s.
        let available = unselected().length;
        let stableSince = Date.now();
        let retries = 0;
        let lastRetry = 0;
        let sawAppleError = false;
        while (Date.now() - started < {wait_ms}) {{
            // A growing list need not finish loading once a batch is available.
            if ({ready_when_count} && !appleErrorRetry() && selectedCount() + unselected().length >= limit) break;
            await delay(1000);
            if (cancelled()) break;
            const retry = appleErrorRetry();
            if (retry) sawAppleError = true;
            if (retry && Date.now() - lastRetry >= 20000) {{
                // Out of retries and Apple still can't load the list.
                if (retries >= {max_retries}) break;
                retry.click();
                retries++;
                lastRetry = Date.now();
                stableSince = Date.now();
                continue;
            }}
            const now = unselected().length;
            if (now !== available) {{
                available = now;
                stableSince = Date.now();
                continue;
            }}
            const settle = available >= limit ? {settle_ms} : Math.max({settle_ms}, 10000);
            if (available > 0 && Date.now() - stableSince >= settle) break;
        }}
        const waited = Date.now() - started;
        const loaded = unselected().length;

        const before = selectedCount();
        let clicked = 0;
        const attempted = new WeakSet();
        const clickDeadline = Date.now() + 80000;
        while (!cancelled() && !appleErrorRetry() && clicked < Math.max(0, limit - before)
                && selectedCount() < limit && Date.now() < clickDeadline) {{
            // Refresh references between small groups: React can replace rows.
            const candidates = unselected().filter(el => el.isConnected && !el.disabled
                && el.getAttribute('aria-disabled') !== 'true' && !attempted.has(el))
                .slice(0, Math.min(5, limit - before - clicked));
            if (!candidates.length) break;
            for (const el of candidates) {{
                if (cancelled()) break;
                if (!el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
                attempted.add(el);
                // DOM checkbox clicks do not require scrolling into view.
                if (!el.matches('input[type="checkbox"], [role="checkbox"]')) el.scrollIntoView({{ block: "center" }});
                el.click();
                clicked++;
            }}
            await delay(25);
        }}
        await delay(500);

        report({{
            kind: "select",
            id: {request_id},
            requested: limit,
            clicked,
            selected: Math.max(0, selectedCount() - before),
            total_selected: selectedCount(),
            waited_ms: waited,
            retries,
            cancelled: cancelled(),
            apple_error: !!appleErrorRetry() || (sawAppleError && loaded === 0),
        }});
        "#,
    );

    fire_js(&app_handle, &js)?;
    Ok(json!({"ok": true, "requested": n}))
}

/// Clicks OK on a confirmation dialog if one is up, otherwise Restore. Reports
/// which it clicked and how many items were selected at that moment, which is
/// the number actually sent to be restored.
#[tauri::command]
async fn click_restore(
    app_handle: tauri::AppHandle,
    request_id: u64,
    confirm_only: Option<bool>,
) -> Result<Value, String> {
    if let Some(win) = app_handle.get_webview_window("icloud") {
        win.unminimize().map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
    }
    let confirm_only = confirm_only.unwrap_or(false);
    let js = format!(
        r#"
        {PAGE_HELPERS}
        const send = (action, selected, restored = 0) =>
            report({{ kind: "restore", id: {request_id}, action, selected, restored, apple_error: !!appleErrorRetry() }});

        // Only a success heading plus its confirmation button proves recovery.
        const success = confirmation();
        if (success) {{
            success.button.click();
            send("confirm", 0, success.restored);
            return;
        }}
        if ({confirm_only}) {{ send("pending", selectedCount()); return; }}

        // Otherwise look for the restore/recover button
        const restoreBtn = restoreButton();

        if (!restoreBtn) {{
            send("none", selectedCount());
            return;
        }}

        // Scroll modal/dialog container to bottom first
        const modal =
            restoreBtn.closest('[role="dialog"]') ||
            restoreBtn.closest(".modal") ||
            restoreBtn.closest('[class*="modal"]') ||
            restoreBtn.closest('[class*="dialog"]');
        if (modal) {{
            modal.scrollTop = modal.scrollHeight;
        }}

        // Also scroll any overflow parent
        let parent = restoreBtn.parentElement;
        while (parent) {{
            if (parent.scrollHeight > parent.clientHeight) {{
                parent.scrollTop = parent.scrollHeight;
                break;
            }}
            parent = parent.parentElement;
        }}

        // Both read before the click, since the page clears the selection and
        // greys the button out again once the restore starts.
        const selected = selectedCount();
        const disabled = restoreBtn.disabled || restoreBtn.getAttribute("aria-disabled") === "true";
        restoreBtn.scrollIntoView({{ block: "center", behavior: "instant" }});
        if (!disabled) restoreBtn.click();
        send(disabled ? "disabled" : "restore", selected);
        "#,
    );

    fire_js(&app_handle, &js)?;
    Ok(json!({"ok": true, "status": "Restore/confirm clicked"}))
}

/// Unticks everything currently selected on the page, so the user can start the
/// batch again without reloading iCloud.
#[tauri::command]
async fn deselect_all(app_handle: tauri::AppHandle, request_id: u64) -> Result<Value, String> {
    let js = format!(
        r#"
        {PAGE_HELPERS}
        const before = selectedCount();
        let clicked = 0;
        for (const el of selectedEls()) {{
            if (cancelled()) break;
            if (!el.isConnected) continue;
            el.scrollIntoView({{ block: "center" }});
            el.click();
            clicked++;
            if (clicked % 10 === 0) await delay(5);
        }}
        await delay(300);
        report({{
            kind: "deselect",
            id: {request_id},
            cleared: Math.max(0, before - selectedCount()),
            still_selected: selectedCount(),
        }});
        "#,
    );
    fire_js(&app_handle, &js)?;
    Ok(json!({"ok": true}))
}

/// A read-only look at the iCloud page, run while iRevive is idle: whether
/// Apple's loading error is showing, how many items are there to select, and
/// how many are ticked (which the user may have done by hand).
#[tauri::command]
async fn check_icloud(app_handle: tauri::AppHandle, request_id: u64) -> Result<(), String> {
    let js = format!(
        r#"
        {PAGE_HELPERS}
        const restore = restoreButton();
        const selected = selectedCount();
        report({{
            kind: "status",
            id: {request_id},
            apple_error: !!appleErrorRetry(),
            loaded: unselected().length,
            selected,
            restore_ready: !!restore && buttonEnabled(restore) && selected > 0,
            confirmation_ready: !!confirmation(),
        }});
        "#,
    );
    fire_js(&app_handle, &js)
}

/// Tells anything already running in the iCloud window to stop where it is.
/// Scripts check this between steps, so a long wait ends promptly.
#[tauri::command]
async fn cancel_icloud(app_handle: tauri::AppHandle) -> Result<(), String> {
    let win = app_handle
        .get_webview_window("icloud")
        .ok_or("iCloud window not open.")?;
    win.eval("window.__ireviveCancelAt = Date.now()")
        .map_err(|e| e.to_string())
}

/// Receives `report(...)` calls from scripts running in the iCloud window and
/// passes them to the main window. Only the iCloud window may call it.
#[tauri::command]
fn icloud_report(
    app_handle: tauri::AppHandle,
    webview: tauri::Webview,
    report: Value,
) -> Result<(), String> {
    if webview.label() != "icloud" {
        return Err("Not allowed".into());
    }
    let main_win = app_handle
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    main_win
        .eval(&format!(
            "window.__onICloudReport && window.__onICloudReport({report})"
        ))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn close_icloud_window(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    if let Some(win) = app_handle.get_webview_window("icloud") {
        win.close().map_err(|e| format!("Failed to close: {}", e))?;
    }
    *state.icloud_open.lock().map_err(|e| e.to_string())? = false;
    Ok(json!({"ok": true, "status": "iCloud window closed"}))
}

/// Signs out of iCloud by wiping the webviews' cookies, cache and storage.
/// Every window shares one WebKit data store, so clearing it from the main
/// window covers the iCloud one too. The iCloud window is closed first so it
/// isn't left sitting on a page whose session has just gone.
#[tauri::command]
async fn clear_browsing_data(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    if let Some(win) = app_handle.get_webview_window("icloud") {
        win.close().map_err(|e| format!("Failed to close: {}", e))?;
    }
    *state.icloud_open.lock().map_err(|e| e.to_string())? = false;

    let main_win = app_handle
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    main_win
        .clear_all_browsing_data()
        .map_err(|e| format!("Failed to clear browsing data: {}", e))?;

    Ok(json!({"ok": true, "status": "Browsing data cleared"}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Open as tall as the screen allows. The work area leaves out the
            // menu bar and Dock, so nothing ends up underneath them.
            if let Some(win) = app.get_webview_window("main") {
                if let (Ok(Some(monitor)), Ok(size), Ok(pos)) =
                    (win.current_monitor(), win.outer_size(), win.outer_position())
                {
                    let area = monitor.work_area();
                    let _ = win.set_size(tauri::PhysicalSize::new(size.width, area.size.height));
                    let _ = win.set_position(tauri::PhysicalPosition::new(pos.x, area.position.y));
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            icloud_open: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            open_icloud_window,
            select_batch,
            click_restore,
            icloud_report,
            check_icloud,
            deselect_all,
            cancel_icloud,
            close_icloud_window,
            clear_browsing_data,
            tickets::submit_ticket,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    // Close the iCloud window when the main window is closed
                    if let Some(icloud_win) = window.app_handle().get_webview_window("icloud") {
                        let _ = icloud_win.close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
