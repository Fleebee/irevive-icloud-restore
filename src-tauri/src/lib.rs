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
    let js = format!(
        r#"
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const limit = {n};
        let count = 0;

        // Strategy 1: standard unchecked checkboxes
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]:not(:checked)'));
        if (checkboxes.length > 0) {{
            for (const el of checkboxes.slice(0, limit)) {{
                el.scrollIntoView({{ block: "center" }});
                el.click();
                count++;
                if (count % 10 === 0) await delay(5);
            }}
        }}

        // Strategy 2: aria checkboxes
        if (count === 0) {{
            const ariaCheckboxes = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="false"]'));
            for (const el of ariaCheckboxes.slice(0, limit)) {{
                el.scrollIntoView({{ block: "center" }});
                el.click();
                count++;
                if (count % 10 === 0) await delay(5);
            }}
        }}

        // Strategy 3: selectable rows
        if (count === 0) {{
            const selectors = [
                '[role="row"]:not([aria-selected="true"])',
                '[role="listitem"]',
                '[role="option"]'
            ];
            for (const sel of selectors) {{
                if (count >= limit) break;
                const els = Array.from(document.querySelectorAll(sel));
                for (const el of els.slice(0, limit - count)) {{
                    el.scrollIntoView({{ block: "center" }});
                    el.click();
                    count++;
                    if (count % 10 === 0) await delay(5);
                }}
                if (count > 0) break;
            }}
        }}
        "#,
    );

    fire_js(&app_handle, &js)?;
    Ok(json!({"ok": true, "requested": n}))
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
