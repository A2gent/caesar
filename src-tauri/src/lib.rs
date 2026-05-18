#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            reveal_item_in_dir,
            move_local_paths_into_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Caesar desktop app");
}

#[tauri::command]
fn reveal_item_in_dir(path: String) -> Result<(), String> {
    let normalized_path = normalize_local_path(&path)?;
    tauri_plugin_opener::reveal_item_in_dir(normalized_path).map_err(|err| err.to_string())
}

#[tauri::command]
fn move_local_paths_into_directory(paths: Vec<String>, target_dir: String) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let target_dir_path = normalize_local_path(&target_dir)?;
    let target_metadata = std::fs::metadata(&target_dir_path)
        .map_err(|err| format!("Failed to read target folder: {err}"))?;
    if !target_metadata.is_dir() {
        return Err("Drop target is not a folder.".to_string());
    }

    let target_dir_canonical = std::fs::canonicalize(&target_dir_path)
        .map_err(|err| format!("Failed to resolve target folder: {err}"))?;

    let mut moved_paths = Vec::with_capacity(paths.len());
    for raw_source in paths {
        let source_path = normalize_local_path(&raw_source)?;
        let source_metadata = std::fs::metadata(&source_path)
            .map_err(|err| format!("Failed to read source item {raw_source}: {err}"))?;
        let source_canonical = std::fs::canonicalize(&source_path)
            .map_err(|err| format!("Failed to resolve source item {raw_source}: {err}"))?;

        if source_canonical == target_dir_canonical {
            return Err("Cannot move a folder into itself.".to_string());
        }
        if source_metadata.is_dir() && target_dir_canonical.starts_with(&source_canonical) {
            return Err("Cannot move a folder into one of its descendants.".to_string());
        }

        let file_name = source_path
            .file_name()
            .ok_or_else(|| format!("Source item has no file name: {raw_source}"))?;
        let destination_path = target_dir_path.join(file_name);
        if destination_path.exists() {
            return Err(format!(
                "An item named '{}' already exists in the target folder.",
                file_name.to_string_lossy(),
            ));
        }

        std::fs::rename(&source_path, &destination_path).map_err(|err| {
            format!(
                "Failed to move '{}' to '{}': {err}",
                source_path.display(),
                destination_path.display(),
            )
        })?;
        moved_paths.push(destination_path.to_string_lossy().to_string());
    }

    Ok(moved_paths)
}

fn normalize_local_path(path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is required.".to_string());
    }

    let without_file_scheme = trimmed.strip_prefix("file://").unwrap_or(trimmed);
    let decoded = percent_decode_file_path(without_file_scheme)?;
    Ok(std::path::PathBuf::from(decoded))
}

fn percent_decode_file_path(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("Invalid percent-encoded file path.".to_string());
            }
            let hex = &input[index + 1..index + 3];
            let value = u8::from_str_radix(hex, 16)
                .map_err(|_| "Invalid percent-encoded file path.".to_string())?;
            decoded.push(value);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(decoded).map_err(|_| "Invalid UTF-8 file path.".to_string())
}
