use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    reader: Mutex<Option<BufReader<std::process::ChildStdout>>>,
}

/// Send a JSON message to the child process and read back one JSON line response.
fn send_and_receive(
    stdin: &State<'_, AppState>,
    msg: Value,
) -> Result<Value, String> {
    let mut stdin_lock = stdin
        .stdin
        .lock()
        .map_err(|e| format!("Failed to lock stdin: {}", e))?;
    let mut reader_lock = stdin
        .reader
        .lock()
        .map_err(|e| format!("Failed to lock reader: {}", e))?;

    let writer = stdin_lock
        .as_mut()
        .ok_or("Browser not launched - no stdin available")?;
    let reader = reader_lock
        .as_mut()
        .ok_or("Browser not launched - no reader available")?;

    let mut line = msg.to_string();
    line.push('\n');
    writer
        .write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write to child stdin: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush child stdin: {}", e))?;

    let mut response = String::new();
    reader
        .read_line(&mut response)
        .map_err(|e| format!("Failed to read from child stdout: {}", e))?;

    if response.is_empty() {
        return Err("Child process closed stdout unexpectedly".into());
    }

    serde_json::from_str(&response)
        .map_err(|e| format!("Failed to parse child response: {} (raw: {})", e, response.trim()))
}

#[tauri::command]
fn launch_browser(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Value, String> {
    // Determine bridge script path: next to the executable in production,
    // or in the src-tauri directory during development.
    let bridge_path = app_handle
        .path()
        .resource_dir()
        .map(|d| d.join("playwright-bridge.cjs"))
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_default()
                .join("playwright-bridge.cjs")
        });

    // Fallback: try relative to the tauri source directory during `cargo tauri dev`
    let bridge_path = if bridge_path.exists() {
        bridge_path
    } else {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.join("playwright-bridge.cjs")
    };

    if !bridge_path.exists() {
        return Err(format!(
            "playwright-bridge.cjs not found at {}",
            bridge_path.display()
        ));
    }

    let mut child_proc = Command::new("node")
        .arg(&bridge_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()) // bridge logs go to terminal
        .spawn()
        .map_err(|e| format!("Failed to spawn node process: {}", e))?;

    let child_stdin = child_proc
        .stdin
        .take()
        .ok_or("Failed to capture child stdin")?;
    let child_stdout = child_proc
        .stdout
        .take()
        .ok_or("Failed to capture child stdout")?;

    *state
        .stdin
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = Some(child_stdin);
    *state
        .reader
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = Some(BufReader::new(child_stdout));
    *state
        .child
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = Some(child_proc);

    // Send the launch command
    send_and_receive(&state, json!({"action": "launch"}))
}

#[tauri::command]
fn scan_page(state: State<'_, AppState>) -> Result<Value, String> {
    send_and_receive(&state, json!({"action": "scan"}))
}

#[tauri::command]
fn select_batch(state: State<'_, AppState>, count: Option<u32>) -> Result<Value, String> {
    let n = count.unwrap_or(500);
    send_and_receive(&state, json!({"action": "select", "count": n}))
}

#[tauri::command]
fn click_restore(state: State<'_, AppState>) -> Result<Value, String> {
    send_and_receive(&state, json!({"action": "restore"}))
}

#[tauri::command]
fn dump_html(state: State<'_, AppState>) -> Result<Value, String> {
    send_and_receive(&state, json!({"action": "dump"}))
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> Result<Value, String> {
    send_and_receive(&state, json!({"action": "status"}))
}

#[tauri::command]
fn stop_browser(state: State<'_, AppState>) -> Result<Value, String> {
    // Drop stdin/reader so the child's pipes close
    *state
        .stdin
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = None;
    *state
        .reader
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = None;

    let mut child_lock = state
        .child
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(mut child) = child_lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    Ok(json!({"ok": true, "status": "Browser stopped"}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            reader: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            launch_browser,
            scan_page,
            select_batch,
            click_restore,
            dump_html,
            get_status,
            stop_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
