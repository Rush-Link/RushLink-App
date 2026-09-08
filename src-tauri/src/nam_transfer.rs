use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
};
use tauri_plugin_fs::FsExt;

const NAM_ROOT: &str = "Neural Amp Modeler";
const STAGING_FOLDER: &str = "Tone 3000";

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct NamTransferResult {
    pub name: String,
    pub path: String,
}

fn relative_nam_path(value: &str) -> Result<(PathBuf, String), String> {
    let normalized = value.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.len() < 2
        || !parts[0].eq_ignore_ascii_case(NAM_ROOT)
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|ch| ch.is_control() || "<>:\"|?*".contains(ch))
        })
    {
        return Err("Choose a file inside the Neural Amp Modeler folder.".into());
    }
    let filename = parts.last().expect("validated nonempty path");
    if filename.len() <= 4 || !filename.to_ascii_lowercase().ends_with(".nam") {
        return Err("Only NAM model files can be transferred.".into());
    }
    Ok((
        parts[1..].iter().collect(),
        format!("{NAM_ROOT}/{}", parts[1..].join("/")),
    ))
}

fn require_scope(path: &Path, allowed: &impl Fn(&Path) -> bool) -> Result<(), String> {
    if allowed(path) {
        Ok(())
    } else {
        Err("Choose the HeadRush Neural Amp Modeler folder in the folder dialog to allow this transfer.".into())
    }
}

/// The caller validates the parent and scope before this creates anything.
/// create_new prevents replacing either an existing file or a symlink.
fn copy_to_new_file(
    input: &mut impl Read,
    destination: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                "A NAM file already exists at this destination. Choose another name.".to_string()
            } else {
                format!("Could not create the destination NAM file: {error}")
            }
        })?;
    let result = (|| -> io::Result<()> {
        let copied = io::copy(input, &mut output)?;
        if copied != expected_size {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "The source file changed during transfer.",
            ));
        }
        output.sync_all()
    })();
    // Windows requires our write handle to close before removing a partial file.
    drop(output);
    if let Err(error) = result {
        return match fs::remove_file(destination) {
            Ok(()) => Err(format!("Could not complete the NAM transfer: {error}")),
            Err(cleanup_error) => Err(format!("Could not complete the NAM transfer: {error}. The partial destination could not be removed: {cleanup_error}")),
        };
    }
    Ok(())
}

fn copy_staged_nam(
    nam_root: &Path,
    source_path: &str,
    destination_path: &str,
    allowed: impl Fn(&Path) -> bool,
) -> Result<NamTransferResult, String> {
    let (source_relative, _) = relative_nam_path(source_path)?;
    let (destination_relative, device_path) = relative_nam_path(destination_path)?;
    let source_parts: Vec<_> = source_relative.components().collect();
    if source_parts.len() != 2
        || !source_parts[0]
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(STAGING_FOLDER)
    {
        return Err("Choose the exact NAM file staged in the Tone 3000 folder.".into());
    }
    if !nam_root.is_absolute() {
        return Err("Choose the mounted HeadRush Neural Amp Modeler folder.".into());
    }
    require_scope(nam_root, &allowed)?;
    let root = fs::canonicalize(nam_root)
        .map_err(|error| format!("Could not open the selected NAM folder: {error}"))?;
    if !root.is_dir()
        || !root
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(NAM_ROOT))
    {
        return Err("Select the Neural Amp Modeler folder on the mounted HeadRush.".into());
    }
    require_scope(&root, &allowed)?;

    let source = root.join(source_relative);
    require_scope(&source, &allowed)?;
    let source = fs::canonicalize(&source)
        .map_err(|error| format!("Could not find the staged NAM file on this drive: {error}"))?;
    if !source.starts_with(&root) || !source.is_file() {
        return Err("The staged NAM file must stay inside the selected NAM folder.".into());
    }
    require_scope(&source, &allowed)?;

    let destination = root.join(&destination_relative);
    let parent = destination
        .parent()
        .ok_or("The destination folder is invalid.")?;
    require_scope(parent, &allowed)?;
    let parent = fs::canonicalize(parent).map_err(|error| {
        format!("The destination folder must already exist on the HeadRush: {error}")
    })?;
    if !parent.is_dir() || !parent.starts_with(&root) {
        return Err("The destination must stay inside the selected NAM folder.".into());
    }
    require_scope(&parent, &allowed)?;
    let filename = destination_relative
        .file_name()
        .ok_or("The destination filename is invalid.")?;
    let destination = parent.join(filename);
    require_scope(&destination, &allowed)?;

    let mut input = File::open(&source)
        .map_err(|error| format!("Could not read the staged NAM file: {error}"))?;
    let metadata = input
        .metadata()
        .map_err(|error| format!("Could not inspect the staged NAM file: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("The staged NAM file is empty or is not a regular file.".into());
    }
    copy_to_new_file(&mut input, &destination, metadata.len())?;
    // Keep the staged source: it may already be referenced by a saved rig.
    let name = filename.to_string_lossy();
    Ok(NamTransferResult {
        name: name[..name.len() - 4].to_string(),
        path: device_path,
    })
}

#[tauri::command]
pub async fn transfer_nam_file(
    app: tauri::AppHandle,
    nam_root: String,
    source_path: String,
    destination_path: String,
) -> Result<NamTransferResult, String> {
    // Dialog.open(directory: true, recursive: true) grants only the selected
    // subtree through this existing fs scope. This command does not extend it.
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        copy_staged_nam(
            Path::new(&nam_root),
            &source_path,
            &destination_path,
            |path| scope.is_allowed(path),
        )
    })
    .await
    .map_err(|error| format!("The NAM transfer could not finish: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        temporary_root: PathBuf,
        directory: PathBuf,
        nam_root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let temporary_root = fs::canonicalize(std::env::temp_dir()).unwrap();
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let directory = temporary_root.join(format!(
                "rushlink-nam-transfer-{}-{nonce}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&directory).unwrap();
            let nam_root = directory.join(NAM_ROOT);
            fs::create_dir(&nam_root).unwrap();
            fs::create_dir(nam_root.join(STAGING_FOLDER)).unwrap();
            fs::create_dir(nam_root.join("User")).unwrap();
            fs::write(
                nam_root.join("Tone 3000/staged.nam"),
                b"{\"model\":\"exact staged bytes\"}",
            )
            .unwrap();
            Self {
                temporary_root,
                directory,
                nam_root,
            }
        }

        fn copy(&self, destination: &str) -> Result<NamTransferResult, String> {
            copy_staged_nam(
                &self.nam_root,
                "Neural Amp Modeler/Tone 3000/staged.nam",
                destination,
                |path| path.starts_with(&self.nam_root),
            )
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Only recursively remove this test's freshly created direct child
            // of the resolved temp directory, never a caller-provided path.
            let resolved = fs::canonicalize(&self.directory).unwrap();
            assert_eq!(resolved, self.directory);
            assert_eq!(resolved.parent(), Some(self.temporary_root.as_path()));
            assert!(resolved
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("rushlink-nam-transfer-"));
            fs::remove_dir_all(resolved).unwrap();
        }
    }

    #[test]
    fn copies_exact_staged_bytes_into_an_existing_user_subfolder_and_preserves_source() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.nam_root.join("User/Clean")).unwrap();
        let result = fixture
            .copy("Neural Amp Modeler/User/Clean/My Amp.NAM")
            .unwrap();
        assert_eq!(
            result,
            NamTransferResult {
                name: "My Amp".into(),
                path: "Neural Amp Modeler/User/Clean/My Amp.NAM".into()
            }
        );
        assert_eq!(
            fs::read(fixture.nam_root.join("User/Clean/My Amp.NAM")).unwrap(),
            fs::read(fixture.nam_root.join("Tone 3000/staged.nam")).unwrap()
        );
    }

    #[test]
    fn refuses_existing_destination_without_changing_either_file() {
        let fixture = Fixture::new();
        fs::write(fixture.nam_root.join("User/Saved.nam"), b"original model").unwrap();
        assert!(fixture
            .copy("Neural Amp Modeler/User/Saved.nam")
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(
            fs::read(fixture.nam_root.join("User/Saved.nam")).unwrap(),
            b"original model"
        );
        assert!(fixture.nam_root.join("Tone 3000/staged.nam").is_file());
    }

    #[test]
    fn rejects_paths_that_escape_nam_or_use_another_file_type() {
        for path in [
            "Neural Amp Modeler/../outside.nam",
            "Neural Amp Modeler/User/../../outside.nam",
            "Neural Amp Modeler/User/./file.nam",
            "/Neural Amp Modeler/User/file.nam",
            "C:/Neural Amp Modeler/User/file.nam",
            "\\\\server\\Neural Amp Modeler\\file.nam",
            "Neural Amp Modeler\\..\\outside.nam",
            "Neural Amp Modeler/User//file.nam",
            "Rigs/file.nam",
            "Neural Amp Modeler/User/file.json",
            "Neural Amp Modeler/User/.nam",
            "Neural Amp Modeler/User/file.nam:stream",
            "Neural Amp Modeler/User /file.nam",
        ] {
            assert!(relative_nam_path(path).is_err(), "accepted {path}");
        }
    }

    #[test]
    fn requires_a_dialog_granted_nam_root_and_destination_scope() {
        let fixture = Fixture::new();
        let source = "Neural Amp Modeler/Tone 3000/staged.nam";
        let destination = "Neural Amp Modeler/User/Saved.nam";
        assert!(
            copy_staged_nam(&fixture.nam_root, source, destination, |_| false)
                .unwrap_err()
                .contains("folder dialog")
        );
        assert!(
            copy_staged_nam(&fixture.directory, source, destination, |_| true)
                .unwrap_err()
                .contains("Select the Neural Amp Modeler folder")
        );
        assert!(
            copy_staged_nam(&fixture.nam_root, source, destination, |path| !path
                .ends_with("Saved.nam"))
            .unwrap_err()
            .contains("folder dialog")
        );
        assert!(!fixture.nam_root.join("User/Saved.nam").exists());
    }

    #[test]
    fn requires_staged_source_and_an_existing_destination_folder() {
        let fixture = Fixture::new();
        assert!(copy_staged_nam(
            &fixture.nam_root,
            "Neural Amp Modeler/User/existing.nam",
            "Neural Amp Modeler/User/Saved.nam",
            |_| true
        )
        .unwrap_err()
        .contains("exact NAM file staged"));
        assert!(fixture
            .copy("Neural Amp Modeler/User/Missing/Saved.nam")
            .unwrap_err()
            .contains("must already exist"));
        assert!(!fixture.nam_root.join("User/Missing").exists());
    }

    #[test]
    fn removes_only_its_new_partial_destination_when_copy_fails() {
        struct FailingReader(bool);
        impl Read for FailingReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if self.0 {
                    return Err(io::Error::new(
                        io::ErrorKind::Other,
                        "test interrupted read",
                    ));
                }
                self.0 = true;
                buffer[..3].copy_from_slice(b"NAM");
                Ok(3)
            }
        }
        let fixture = Fixture::new();
        let destination = fixture.nam_root.join("User/Partial.nam");
        assert!(
            copy_to_new_file(&mut FailingReader(false), &destination, 12)
                .unwrap_err()
                .contains("test interrupted read")
        );
        assert!(!destination.exists());
        assert!(fixture.nam_root.join("Tone 3000/staged.nam").is_file());
    }

    #[test]
    fn rejects_a_source_that_changed_size_without_leaving_a_partial_file() {
        let fixture = Fixture::new();
        let destination = fixture.nam_root.join("User/Partial.nam");
        assert!(copy_to_new_file(&mut b"short".as_slice(), &destination, 20)
            .unwrap_err()
            .contains("source file changed"));
        assert!(!destination.exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_source_or_destination_symlinks_outside_the_selected_nam_root() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = fixture.directory.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("source.nam"), b"outside source").unwrap();
        symlink(
            outside.join("source.nam"),
            fixture.nam_root.join("Tone 3000/escape.nam"),
        )
        .unwrap();
        assert!(copy_staged_nam(
            &fixture.nam_root,
            "Neural Amp Modeler/Tone 3000/escape.nam",
            "Neural Amp Modeler/User/Saved.nam",
            |_| true
        )
        .is_err());
        symlink(&outside, fixture.nam_root.join("User/escape")).unwrap();
        assert!(fixture
            .copy("Neural Amp Modeler/User/escape/Saved.nam")
            .is_err());
        assert!(!outside.join("Saved.nam").exists());
    }
}
