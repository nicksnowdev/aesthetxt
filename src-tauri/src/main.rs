// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn ready() {}

fn main() {

  // this is how you print to terminal from rust
  //let msg = "debug message";
  //println!("Message from Rust: {}", msg);

  tauri::Builder::default()
    .setup(|app| {
      match app.get_cli_matches() {
        // `matches` here is a Struct with { args, subcommand }.
        // `args` is `HashMap<String, ArgData>` where `ArgData` is a struct with { value, occurrences }.
        // `subcommand` is `Option<Box<SubcommandMatches>>` where `SubcommandMatches` is a struct with { name, matches }.
        Ok(matches) => {
          println!("{:?}", matches)
        }
        Err(_) => {}
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![ready])
    .run(tauri::generate_context!())
    .expect("error while running aesthetxt");
}
