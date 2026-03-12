use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    icloud_open: Mutex<bool>,
}

/// Execute JavaScript in the iCloud webview and get the result back via document.title polling.
async fn eval_in_icloud(
    app_handle: &tauri::AppHandle,
    js_code: &str,
) -> Result<Value, String> {
    let icloud_win = app_handle
        .get_webview_window("icloud")
        .ok_or("iCloud window not open. Click 'Open iCloud' first.")?;

    let sentinel = format!("__IREVIVE_{}", uuid::Uuid::new_v4());

    let wrapped_js = format!(
        r#"(async () => {{
            try {{
                const __r = await (async () => {{ {js_code} }})();
                document.title = "{sentinel}:" + JSON.stringify(__r);
            }} catch(e) {{
                document.title = "{sentinel}:" + JSON.stringify({{ok: false, error: e.message}});
            }}
        }})();"#,
    );

    icloud_win
        .eval(&wrapped_js)
        .map_err(|e| format!("eval failed: {}", e))?;

    // Poll document.title for the result
    for _ in 0..200 {
        // 200 * 50ms = 10 second timeout
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        if let Ok(title) = icloud_win.title() {
            let prefix = format!("{}:", sentinel);
            if title.starts_with(&prefix) {
                let json_str = &title[prefix.len()..];
                // Reset the title
                let _ = icloud_win.eval("document.title = document.title.replace(/^__IREVIVE_.*?:/, '')");
                return serde_json::from_str(json_str).map_err(|e| {
                    format!("Failed to parse response: {} (raw: {})", e, json_str)
                });
            }
        }
    }

    Err("Eval timed out after 10 seconds".into())
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
    .inner_size(1200.0, 900.0)
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
async fn scan_page(app_handle: tauri::AppHandle) -> Result<Value, String> {
    eval_in_icloud(
        &app_handle,
        r#"
        const stdCheckboxes = document.querySelectorAll('input[type="checkbox"]').length;
        const stdUnchecked = document.querySelectorAll('input[type="checkbox"]:not(:checked)').length;
        const ariaCheckboxes = document.querySelectorAll('[role="checkbox"]').length;
        const ariaUnchecked = document.querySelectorAll('[role="checkbox"][aria-checked="false"]').length;
        const rows = document.querySelectorAll('[role="row"]').length;
        const listItems = document.querySelectorAll('[role="listitem"]').length;
        const options = document.querySelectorAll('[role="option"]').length;
        const selectedRows = document.querySelectorAll('[role="row"][aria-selected="true"]').length;
        const buttons = document.querySelectorAll('button, [role="button"]').length;
        return {
            ok: true,
            stdCheckboxes, stdUnchecked,
            ariaCheckboxes, ariaUnchecked,
            rows, listItems, options, selectedRows, buttons
        };
        "#,
    )
    .await
}

#[tauri::command]
async fn select_batch(app_handle: tauri::AppHandle, count: Option<u32>) -> Result<Value, String> {
    let n = count.unwrap_or(500);
    let js = format!(
        r#"
        const limit = {n};
        let count = 0;
        let method = "none-found";

        // Strategy 1: standard unchecked checkboxes
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]:not(:checked)'));
        for (const el of checkboxes.slice(0, limit)) {{
            el.scrollIntoView({{ block: "center" }});
            el.click();
            count++;
        }}
        if (count > 0) return {{ ok: true, selected: count, method: "standard-checkbox" }};

        // Strategy 2: aria checkboxes
        const ariaCheckboxes = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="false"]'));
        for (const el of ariaCheckboxes.slice(0, limit)) {{
            el.scrollIntoView({{ block: "center" }});
            el.click();
            count++;
        }}
        if (count > 0) return {{ ok: true, selected: count, method: "aria-checkbox" }};

        // Strategy 3: selectable rows
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
            }}
            if (count > 0) break;
        }}
        if (count > 0) return {{ ok: true, selected: count, method: "row-click" }};

        return {{ ok: true, selected: 0, method: "none-found" }};
        "#,
    );
    eval_in_icloud(&app_handle, &js).await
}

#[tauri::command]
async fn click_restore(app_handle: tauri::AppHandle) -> Result<Value, String> {
    eval_in_icloud(
        &app_handle,
        r#"
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
        const restoreBtn = allBtns.find(btn => {
            const text = (btn.textContent || "").toLowerCase();
            if (!text.includes("restore") && !text.includes("recover")) return false;
            if (btn.closest(".tile-article")) return false;
            if (btn.closest(".nav-link")) return false;
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

        return {
            ok: true,
            status: "Clicked restore button",
            buttonText: restoreBtn.textContent.trim().slice(0, 80)
        };
        "#,
    )
    .await
}

#[tauri::command]
async fn get_status(app_handle: tauri::AppHandle) -> Result<Value, String> {
    eval_in_icloud(
        &app_handle,
        r#"
        const checkboxes = document.querySelectorAll('input[type="checkbox"]').length;
        const checked = document.querySelectorAll('input[type="checkbox"]:checked').length;
        const ariaCheckboxes = document.querySelectorAll('[role="checkbox"]').length;
        const ariaChecked = document.querySelectorAll('[role="checkbox"][aria-checked="true"]').length;
        const rows = document.querySelectorAll('[role="row"]').length;
        const selectedRows = document.querySelectorAll('[role="row"][aria-selected="true"]').length;
        return { ok: true, checkboxes, checked, ariaCheckboxes, ariaChecked, rows, selectedRows };
        "#,
    )
    .await
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
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            icloud_open: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            open_icloud_window,
            scan_page,
            select_batch,
            click_restore,
            get_status,
            close_icloud_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
