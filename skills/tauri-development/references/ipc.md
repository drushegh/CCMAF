# IPC: Commands, Events, Channels, State

## Commands

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {name}!")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])   // EVERY command listed
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```typescript
import { invoke } from "@tauri-apps/api/core";   // /core — /tauri is v1

const greeting = await invoke<string>("greet", { name: "World" });
```

- **Async commands take owned types** — `async fn f(name: String)`, never
  `&str` (borrows can't cross await points; compile error).
- Arguments: JS `camelCase` ↔ Rust `snake_case`, converted automatically.
  `Option<T>` ↔ optional/undefined JS argument.
- All argument types `Deserialize`, return types `Serialize`. Complex enums
  need `#[serde(tag = "type")]`-style representation to be JSON-safe.

## Typed Errors Across IPC

```rust
use thiserror::Error;

#[derive(Debug, Error)]
enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Errors must Serialize to cross the boundary
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::ser::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
fn read_config(path: String) -> Result<Config, AppError> { /* ... */ }
```

Frontend: rejected promise — `try { await invoke(...) } catch (e) { ... }`.

## State

```rust
use std::sync::Mutex;
use tauri::State;

struct AppState { counter: u32 }

#[tauri::command]
fn increment(state: State<'_, Mutex<AppState>>) -> u32 {
    let mut s = state.lock().unwrap();
    s.counter += 1;
    s.counter
}

tauri::Builder::default()
    .manage(Mutex::new(AppState { counter: 0 }))
```

`State<T>` must match the `.manage()`d type exactly — mismatch panics at
runtime. Locking rules from rust-development apply (scope guards, no
blocking in async commands).

## Events — fire-and-forget

```rust
use tauri::Emitter;   // trait must be in scope (Listener for .listen())

#[tauri::command]
fn start_task(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        app.emit("task-progress", 50).unwrap();          // all windows
        // app.emit_to("settings", "notice", msg)        // one window
    });
}
```

```typescript
import { listen, once, emit } from "@tauri-apps/api/event";

const unlisten = await listen<number>("task-progress", (e) => {
  console.log(e.payload);
});
// ALWAYS call unlisten() on component teardown — leaked listeners stack up
await emit("user-action", { action: "click" });          // frontend → Rust
```

No acknowledgement, no response — if you need a result, it's a command.

## Channels — typed streaming (Rust → Frontend, per-invocation)

```rust
use tauri::ipc::Channel;

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum DownloadEvent {
    Progress { percent: u32 },
    Complete { path: String },
}

#[tauri::command]
async fn download(url: String, on_event: Channel<DownloadEvent>) {
    for i in 0..=100 {
        on_event.send(DownloadEvent::Progress { percent: i }).unwrap();
    }
    on_event.send(DownloadEvent::Complete { path: "/downloads/file".into() }).unwrap();
}
```

```typescript
import { invoke, Channel } from "@tauri-apps/api/core";

type DownloadEvent =
  | { event: "Progress"; data: { percent: number } }
  | { event: "Complete"; data: { path: string } };

const channel = new Channel<DownloadEvent>();
channel.onmessage = (msg) => console.log(msg.event, msg.data);
await invoke("download", { url: "https://…", onEvent: channel });
```

Rust enum shape and TS type must agree — keep the
`#[serde(tag = "event", content = "data")]` discriminated form.

## Binary Data — skip JSON overhead

```rust
use tauri::ipc::Response;

#[tauri::command]
fn read_binary_file(path: String) -> Result<Response, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(data))
}
```

Frontend receives `ArrayBuffer`; uploads send a `Uint8Array` as the invoke
body and read it via `tauri::ipc::Request`/`InvokeBody::Raw`.

## Windows

```rust
use tauri::Manager;

#[tauri::command]
fn focus_main(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {   // v2 API
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(&app, "settings",
        tauri::WebviewUrl::App("settings.html".into()))
        .title("Settings")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

New windows need their label covered by a capability or they have no
permissions (see security.md).
