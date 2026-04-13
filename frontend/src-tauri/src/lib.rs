#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // Release build only: spawn FastAPI sidecar automatically
            // In dev mode, run the backend manually: uvicorn main:app --reload --port 8000
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_shell::ShellExt;
                let handle = _app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match handle.shell().sidecar("backend") {
                        Ok(cmd) => {
                            match cmd.spawn() {
                                Ok(_) => println!("[Logic Mapper] FastAPI backend started on port 8000"),
                                Err(e) => eprintln!("[Logic Mapper] Backend spawn failed: {}", e),
                            }
                        }
                        Err(e) => eprintln!("[Logic Mapper] Sidecar error: {}", e),
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
