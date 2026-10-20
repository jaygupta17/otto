//! The "This computer" workspace: find (or install) OpenCode v2 and run
//! `opencode serve` on 127.0.0.1, detached so agents keep working when Otto
//! quits.
//!
//! An existing v2 install anywhere on the user's PATH is used as is. If there
//! is none, the official v2 binary (the npm package the opencode.ai/v2/install
//! script downloads) goes into Otto's own data folder, so a v1 install in
//! ~/.opencode/bin is never overwritten. The server reads the user's normal
//! OpenCode config, which is the point of running locally.

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone)]
pub struct Found {
    path: String,
    version: String,
    /// Installed by Otto (in its data folder) rather than found on the system.
    managed: bool,
}

const BIN: &str = if cfg!(windows) { "opencode.exe" } else { "opencode" };

fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Otto's own folder for OpenCode: the binary it installs, server logs and pids.
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("opencode");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// The PATH a terminal would have. Apps launched from the Dock or Finder get a
/// bare one, and the agent needs the user's git, node, bun and so on.
fn login_path() -> String {
    static P: OnceLock<String> = OnceLock::new();
    P.get_or_init(|| {
        let current = std::env::var("PATH").unwrap_or_default();
        if cfg!(windows) {
            return current;
        }
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut cmd = Command::new(shell);
        cmd.args(["-ilc", "printf '__OTTO__%s__OTTO__' \"$PATH\""]);
        let found = run(cmd, Duration::from_secs(8)).ok().and_then(|out| {
            let s = out.split("__OTTO__").nth(1)?.to_string();
            (!s.is_empty()).then_some(s)
        });
        found.unwrap_or(current)
    })
    .clone()
}

/// Run to completion with a deadline; returns stdout+stderr.
fn run(mut cmd: Command, timeout: Duration) -> Result<String, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let mut out = String::new();
                if let Some(mut o) = child.stdout.take() {
                    let _ = o.read_to_string(&mut out);
                }
                if let Some(mut e) = child.stderr.take() {
                    let _ = e.read_to_string(&mut out);
                }
                return if status.success() { Ok(out) } else { Err(last_lines(&out)) };
            }
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                return Err("Timed out.".into());
            }
            None => std::thread::sleep(Duration::from_millis(40)),
        }
    }
}

fn last_lines(s: &str) -> String {
    let lines: Vec<&str> = s.trim().lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(6)..].join("\n")
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_: &mut Command) {}

/// Oldest OpenCode with everything the app relies on. `/api/info` — the
/// handshake in `provisionLocal` — only exists from 2.0.26; earlier v2 builds
/// 404 it and the setup just spins until it times out. Apps need 2.1.0: it's
/// the first build that lets a plugin ask for approval (`permission.assert`).
const MIN_VERSION: (u32, u32, u32) = (2, 1, 0);

/// "opencode v2.0.27" → "2.0.27", only when new enough to drive.
fn v2_version(bin: &Path) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.arg("--version").env("PATH", login_path());
    let out = run(cmd, Duration::from_secs(15)).ok()?;
    let v = out
        .split_whitespace()
        .map(|w| w.trim_start_matches('v'))
        .find(|w| w.split('.').count() >= 3 && w.split('.').all(|p| p.chars().next().is_some_and(|c| c.is_ascii_digit())))?;
    let n: Vec<u32> = v.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    let key = (n.first().copied()?, n.get(1).copied().unwrap_or(0), n.get(2).copied().unwrap_or(0));
    (key >= MIN_VERSION).then(|| v.to_string())
}

fn managed_bin(dir: &Path) -> PathBuf {
    dir.join("bin").join(BIN)
}

fn find(dir: &Path) -> Option<Found> {
    let h = home();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&login_path()).collect();
    for d in [".opencode/bin", ".bun/bin", ".local/bin", ".npm-global/bin"] {
        dirs.push(h.join(d));
    }
    if cfg!(windows) {
        if let Some(a) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(a).join("npm"));
        }
    } else {
        dirs.push("/opt/homebrew/bin".into());
        dirs.push("/usr/local/bin".into());
    }
    let mut seen = std::collections::HashSet::new();
    for d in dirs {
        let p = d.join(BIN);
        let Ok(real) = fs::canonicalize(&p) else { continue };
        if !seen.insert(real) {
            continue;
        }
        if let Some(version) = v2_version(&p) {
            return Some(Found { path: p.to_string_lossy().into(), version, managed: false });
        }
    }
    let m = managed_bin(dir);
    let version = v2_version(&m)?;
    Some(Found { path: m.to_string_lossy().into(), version, managed: true })
}

#[tauri::command]
pub async fn local_find_opencode(app: AppHandle) -> Option<Found> {
    let dir = data_dir(&app).ok()?;
    tauri::async_runtime::spawn_blocking(move || find(&dir)).await.ok().flatten()
}

/// The npm target the official installer would pick, e.g. "darwin-arm64".
fn target() -> Result<String, String> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(windows) {
        "windows"
    } else {
        return Err("This platform can't run OpenCode locally.".into());
    };
    let mut arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    // An Intel build of Otto under Rosetta should still get the native binary.
    if os == "darwin" && arch == "x64" {
        let mut c = Command::new("sysctl");
        c.args(["-n", "sysctl.proc_translated"]);
        if run(c, Duration::from_secs(3)).is_ok_and(|o| o.trim() == "1") {
            arch = "arm64";
        }
    }
    let mut t = format!("{os}-{arch}");
    #[cfg(target_arch = "x86_64")]
    if arch == "x64" && !std::arch::is_x86_feature_detected!("avx2") {
        t.push_str("-baseline");
    }
    if os == "linux" {
        let mut c = Command::new("ldd");
        c.arg("--version");
        let musl = Path::new("/etc/alpine-release").exists() || run(c, Duration::from_secs(3)).unwrap_or_else(|e| e).to_lowercase().contains("musl");
        if musl {
            t.push_str("-musl");
        }
    }
    if t.starts_with("windows-arm64") {
        return Err("OpenCode doesn't ship a Windows on ARM build yet.".into());
    }
    Ok(t)
}

fn curl(args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut c = Command::new("curl");
    c.args(["-fsSL", "--retry", "2"]).args(args);
    run(c, timeout).map_err(|e| if e.is_empty() { "Download failed. Are you online?".into() } else { e })
}

/// Download and unpack the latest v2 binary into `dir`; returns its path.
fn download(dir: &Path) -> Result<PathBuf, String> {
    let target = target()?;
    let meta: serde_json::Value = serde_json::from_str(&curl(&["https://opencode.ai/update/api/latest/cli/npm"], Duration::from_secs(30))?)
        .map_err(|_| "Couldn't read OpenCode's latest version.".to_string())?;
    let version = meta["version"].as_str().ok_or("Couldn't read OpenCode's latest version.")?.to_string();
    let scope = meta["metadata"]["package"].as_str().unwrap_or("@opencode/cli").trim_end_matches("/cli").to_string();

    let tmp = dir.join("download");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let tgz = tmp.join("cli.tgz");
    let url = format!("https://registry.npmjs.org/{scope}/cli-{target}/-/cli-{target}-{version}.tgz");
    curl(&["-o", &tgz.to_string_lossy(), &url], Duration::from_secs(600))?;

    let mut tar = Command::new("tar");
    tar.arg("-xzf").arg(&tgz).arg("-C").arg(&tmp);
    run(tar, Duration::from_secs(120)).map_err(|e| format!("Couldn't unpack OpenCode: {e}"))?;

    let bin = managed_bin(dir);
    fs::create_dir_all(bin.parent().unwrap()).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&bin);
    fs::rename(tmp.join("package").join("bin").join(BIN), &bin).map_err(|e| format!("Couldn't install OpenCode: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_dir_all(&tmp);
    Ok(bin)
}

fn install(dir: &Path) -> Result<Found, String> {
    let bin = download(dir)?;
    let version = v2_version(&bin).ok_or("OpenCode installed but didn't start. Check that your system can run it.")?;
    Ok(Found { path: bin.to_string_lossy().into(), version, managed: true })
}

#[tauri::command]
pub async fn local_install_opencode(app: AppHandle) -> Result<Found, String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || install(&dir)).await.map_err(|e| e.to_string())?
}

fn port_free(p: u16) -> bool {
    TcpListener::bind(("127.0.0.1", p)).is_ok()
}

/// `preferred` if nothing is listening there, else the next free port from
/// 4100. Never 4096, OpenCode's default, which the user may run themselves.
#[tauri::command]
pub fn local_free_port(preferred: Option<u16>) -> Result<u16, String> {
    if let Some(p) = preferred.filter(|&p| p != 4096 && port_free(p)) {
        return Ok(p);
    }
    (4100..4200).find(|&p| port_free(p)).ok_or_else(|| "No free port between 4100 and 4199.".into())
}

/// Start `opencode serve` in the background. Its log and pid live in Otto's
/// data folder, one pair per port.
#[tauri::command]
pub fn local_start_server(app: AppHandle, bin: String, port: u16, password: String) -> Result<u32, String> {
    start(&data_dir(&app)?, &bin, port, &password)
}

fn start(dir: &Path, bin: &str, port: u16, password: &str) -> Result<u32, String> {
    let log = fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("serve-{port}.log"))).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(bin);
    cmd.args(["serve", "--hostname", "127.0.0.1", "--port", &port.to_string()])
        .env("OPENCODE_SERVER_PASSWORD", password)
        .env("PATH", login_path())
        .current_dir(home())
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so it outlives Otto and ignores signals sent to Otto's.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_0200); // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start OpenCode: {e}"))?;
    let pid = child.id();
    fs::write(dir.join(format!("serve-{port}.pid")), pid.to_string()).map_err(|e| e.to_string())?;
    // Reap it if it exits while Otto is open; it keeps running if Otto quits.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(pid)
}

/// The last lines of the server log, for setup errors.
#[tauri::command]
pub fn local_server_log(app: AppHandle, port: u16) -> String {
    data_dir(&app).ok().and_then(|d| fs::read_to_string(d.join(format!("serve-{port}.log"))).ok()).map(|s| last_lines(&s)).unwrap_or_default()
}

/// Stop the server Otto started on `port`, if it's still that process.
#[tauri::command]
pub fn local_stop_server(app: AppHandle, port: u16) -> Result<(), String> {
    stop(&data_dir(&app)?, port)
}

fn stop(dir: &Path, port: u16) -> Result<(), String> {
    let pidfile = dir.join(format!("serve-{port}.pid"));
    let Some(pid) = fs::read_to_string(&pidfile).ok().and_then(|s| s.trim().parse::<u32>().ok()) else { return Ok(()) };
    let _ = fs::remove_file(&pidfile);
    // The pid may have been reused since; only stop it if it's still OpenCode.
    let (check, kill): (Command, Command) = if cfg!(windows) {
        let mut c = Command::new("tasklist");
        c.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
        let mut k = Command::new("taskkill");
        k.args(["/PID", &pid.to_string(), "/T", "/F"]);
        (c, k)
    } else {
        let mut c = Command::new("ps");
        c.args(["-p", &pid.to_string(), "-o", "command="]);
        let mut k = Command::new("kill");
        k.arg(pid.to_string());
        (c, k)
    };
    if run(check, Duration::from_secs(5)).is_ok_and(|o| o.contains("opencode")) {
        run(kill, Duration::from_secs(5))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! Run with `OTTO_LOCAL_TEST_DIR=<scratch> cargo test local -- --ignored --nocapture`.
    //! The server test points OpenCode's config and data at that folder, so it
    //! never reads or writes the real ~/.config/opencode.
    use super::*;

    fn scratch() -> PathBuf {
        let d = PathBuf::from(std::env::var("OTTO_LOCAL_TEST_DIR").expect("set OTTO_LOCAL_TEST_DIR"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    #[ignore]
    fn finds_a_v2_install() {
        let f = find(&scratch()).expect("no OpenCode v2 found");
        println!("found {} v{} managed={}", f.path, f.version, f.managed);
        assert!(f.version.starts_with(|c: char| c >= '2'));
    }

    #[test]
    #[ignore]
    fn rejects_v1() {
        let v1 = home().join(".opencode/bin/opencode");
        if v1.exists() {
            println!("~/.opencode/bin/opencode → {:?}", v2_version(&v1));
        }
    }

    #[test]
    #[ignore]
    fn downloads_the_binary() {
        let dir = scratch().join("managed");
        let bin = download(&dir).unwrap();
        let size = fs::metadata(&bin).unwrap().len();
        println!("downloaded {} ({} MB) for {}", bin.display(), size / 1_000_000, target().unwrap());
        assert!(size > 10_000_000);
    }

    #[test]
    #[ignore]
    fn starts_and_stops_a_server() {
        let dir = scratch();
        for (k, sub) in [("XDG_CONFIG_HOME", "config"), ("XDG_DATA_HOME", "data"), ("XDG_STATE_HOME", "state"), ("XDG_CACHE_HOME", "cache")] {
            std::env::set_var(k, dir.join("xdg").join(sub));
        }
        let bin = find(&dir).expect("no OpenCode v2").path;
        let port = local_free_port(None).unwrap();
        assert_ne!(port, 4096);
        let pw = "test-password-otto";
        let pid = start(&dir, &bin, port, pw).unwrap();
        println!("started pid {pid} on {port}");
        // /api/info, not /api/health: the liveness route moved between 2.0.2 and
        // 2.0.26, and an unknown path answers 200 with the web UI's HTML. Assert on
        // the body so this can't pass on a fallback page again.
        let url = format!("http://127.0.0.1:{port}/api/info");
        let mut ok = false;
        for _ in 0..60 {
            if let Ok(body) = curl(&["-u", &format!("opencode:{pw}"), &url], Duration::from_secs(3)) {
                if body.contains("\"version\"") {
                    ok = true;
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let wrong = curl(&["-u", "opencode:wrong", &url], Duration::from_secs(3)).is_ok();
        stop(&dir, port).unwrap();
        std::thread::sleep(Duration::from_millis(800));
        let after = curl(&["-u", &format!("opencode:{pw}"), &url], Duration::from_secs(3)).is_ok();
        println!("healthy={ok} wrong_password_accepted={wrong} up_after_stop={after}");
        assert!(ok && !wrong && !after);
    }
}
