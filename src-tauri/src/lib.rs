use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    icloud_open: Mutex<bool>,
}

/// Fire JS in the iCloud webview without waiting for a result.
fn fire_js(app_handle: &tauri::AppHandle, js_code: &str) -> Result<(), String> {
    let icloud_win = app_handle
        .get_webview_window("icloud")
        .ok_or("iCloud window not open. Click 'Open iCloud' first.")?;

    let wrapped_js = format!(
        r#"(async () => {{ try {{ {js_code} }} catch(e) {{ console.error("iRevive error:", e); }} }})();"#,
    );

    icloud_win
        .eval(&wrapped_js)
        .map_err(|e| format!("eval failed: {}", e))
}

/// Fire JS and update the main window's selected counter in real-time
/// by having the iCloud JS call back via a shared counter.
fn fire_js_with_progress(
    app_handle: &tauri::AppHandle,
    main_handle: tauri::AppHandle,
    js_code: &str,
) -> Result<(), String> {
    let icloud_win = app_handle
        .get_webview_window("icloud")
        .ok_or("iCloud window not open. Click 'Open iCloud' first.")?;

    let wrapped_js = format!(
        r#"(async () => {{
            try {{
                window.__irevive_count = 0;
                window.__irevive_done = false;
                {js_code}
                window.__irevive_done = true;
            }} catch(e) {{
                window.__irevive_done = true;
                console.error("iRevive error:", e);
            }}
        }})();"#,
    );

    icloud_win
        .eval(&wrapped_js)
        .map_err(|e| format!("eval failed: {}", e))?;

    // Spawn a background task to poll the count and update the main window
    tokio::spawn(async move {
        let mut last_count = 0u64;
        let mut stable_ticks = 0u32;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;

            let Some(icloud_win) = main_handle.get_webview_window("icloud") else {
                break;
            };

            // Read count + done state into title
            let _ = icloud_win.eval(
                "document.title = '__IREVIVE_P:' + (window.__irevive_count||0) + ':' + (window.__irevive_done ? 1 : 0);"
            );

            tokio::time::sleep(std::time::Duration::from_millis(50)).await;

            if let Ok(title) = icloud_win.title() {
                if let Some(data) = title.strip_prefix("__IREVIVE_P:") {
                    let parts: Vec<&str> = data.split(':').collect();
                    if parts.len() == 2 {
                        let count = parts[0].parse::<u64>().unwrap_or(0);
                        let done = parts[1] == "1";

                        if count != last_count {
                            last_count = count;
                            stable_ticks = 0;
                            // Update the main window counter
                            if let Some(main_win) = main_handle.get_webview_window("main") {
                                let _ = main_win.eval(&format!(
                                    "document.getElementById('count-selected').textContent = '{count}';"
                                ));
                            }
                        } else {
                            stable_ticks += 1;
                        }

                        if done {
                            // Final update
                            if let Some(main_win) = main_handle.get_webview_window("main") {
                                let _ = main_win.eval(&format!(
                                    "document.getElementById('count-selected').textContent = '{count}'; window.__onSelectDone && window.__onSelectDone({count});"
                                ));
                            }
                            break;
                        }

                        // Safety: if count hasn't changed for 30 seconds, assume done
                        if stable_ticks > 150 {
                            if let Some(main_win) = main_handle.get_webview_window("main") {
                                let _ = main_win.eval(&format!(
                                    "window.__onSelectDone && window.__onSelectDone({last_count});"
                                ));
                            }
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(())
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

    let win = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "icloud",
        tauri::WebviewUrl::External("https://www.icloud.com/recovery".parse().unwrap()),
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

#[tauri::command]
async fn select_batch(app_handle: tauri::AppHandle, count: Option<u32>) -> Result<Value, String> {
    let n = count.unwrap_or(500);
    let main_handle = app_handle.clone();
    let js = format!(
        r#"
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const limit = {n};

        // Strategy 1: standard unchecked checkboxes
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]:not(:checked)'));
        if (checkboxes.length > 0) {{
            for (const el of checkboxes.slice(0, limit)) {{
                el.scrollIntoView({{ block: "center" }});
                el.click();
                window.__irevive_count++;
                if (window.__irevive_count % 10 === 0) await delay(5);
            }}
            return;
        }}

        // Strategy 2: aria checkboxes
        const ariaCheckboxes = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="false"]'));
        if (ariaCheckboxes.length > 0) {{
            for (const el of ariaCheckboxes.slice(0, limit)) {{
                el.scrollIntoView({{ block: "center" }});
                el.click();
                window.__irevive_count++;
                if (window.__irevive_count % 10 === 0) await delay(5);
            }}
            return;
        }}

        // Strategy 3: selectable rows
        const selectors = [
            '[role="row"]:not([aria-selected="true"])',
            '[role="listitem"]',
            '[role="option"]'
        ];
        for (const sel of selectors) {{
            if (window.__irevive_count >= limit) break;
            const els = Array.from(document.querySelectorAll(sel));
            for (const el of els.slice(0, limit - window.__irevive_count)) {{
                el.scrollIntoView({{ block: "center" }});
                el.click();
                window.__irevive_count++;
                if (window.__irevive_count % 10 === 0) await delay(5);
            }}
            if (window.__irevive_count > 0) break;
        }}
        "#,
    );

    fire_js_with_progress(&app_handle, main_handle, &js)?;

    // Return immediately - the background task updates the counter in real-time
    Ok(json!({"ok": true, "started": true, "requested": n}))
}

#[tauri::command]
async fn click_restore(app_handle: tauri::AppHandle) -> Result<Value, String> {
    fire_js(
        &app_handle,
        r#"
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));

        // First check for a confirmation dialog (OK / Done / Got it)
        const confirmBtn = allBtns.find(btn => {
            const text = (btn.textContent || "").trim().toLowerCase();
            return text === "ok" || text === "done" || text === "got it" || text === "close";
        });
        if (confirmBtn) {
            confirmBtn.click();
            return;
        }

        // Otherwise look for the restore/recover button
        const restoreBtn = allBtns.find(btn => {
            const text = (btn.textContent || "").toLowerCase();
            if (!text.includes("restore") && !text.includes("recover")) return false;
            if (btn.closest(".tile-article")) return false;
            if (btn.closest(".nav-link")) return false;
            return true;
        });

        if (!restoreBtn) return;

        // Scroll modal/dialog container to bottom first
        const modal =
            restoreBtn.closest('[role="dialog"]') ||
            restoreBtn.closest(".modal") ||
            restoreBtn.closest('[class*="modal"]') ||
            restoreBtn.closest('[class*="dialog"]');
        if (modal) {
            modal.scrollTop = modal.scrollHeight;
        }

        // Also scroll any overflow parent
        let parent = restoreBtn.parentElement;
        while (parent) {
            if (parent.scrollHeight > parent.clientHeight) {
                parent.scrollTop = parent.scrollHeight;
                break;
            }
            parent = parent.parentElement;
        }

        restoreBtn.scrollIntoView({ block: "center", behavior: "instant" });
        restoreBtn.click();
        "#,
    )?;

    Ok(json!({"ok": true, "status": "Restore/confirm clicked"}))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            close_icloud_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
