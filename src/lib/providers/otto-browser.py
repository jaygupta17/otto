#!/usr/bin/env python3
"""otto-browser: the agent's browser on a Boat machine, as a small CLI.

Chrome runs on the machine's desktop (the screen Otto streams), with a
loopback DevTools port, attached to the Cua Driver through Boat's
`--grant existing-profile` route. Pages come back as short text with refs, so
any model can drive it.

  otto-browser open [url]          start or reuse Chrome, then read the page
  otto-browser go <url>            open a URL in the current tab
  otto-browser read [--query q] [--more]
  otto-browser click <ref>
  otto-browser type <ref> <text> [--replace] [--enter]
  otto-browser press <key>         Enter, Tab, Escape, ArrowDown...
  otto-browser tabs | tab <n>

Installed by Otto. State lives in ~/.otto/browser.json.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

PORT = int(os.environ.get("OTTO_BROWSER_PORT", "9222"))
SESSION = os.environ.get("OTTO_BROWSER_SESSION", "otto")
CUA = os.environ.get("CUA_DRIVER", "/opt/ascii/cua-driver/cua-driver")
SOCK = os.environ.get("CUA_SOCKET", "/run/ascii-cua/driver.sock")
STATE = os.path.expanduser("~/.otto/browser.json")
MAX_LINES = 160
TEXT_ROLES = {"statictext", "heading", "paragraph", "cell", "listitem", "label", "generic", "layouttablecell", "strong", "emphasis", "time", "caption", "definition", "term", "blockquote"}
os.environ.setdefault("DISPLAY", ":0")
os.environ.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")


class Fail(Exception):
    pass


class Ended(Fail):
    """The driver retired our session label (idle); it's been revived, but its browser grant is gone."""


def call(tool, args):
    args = {**args, "session": SESSION}
    p = subprocess.run([CUA, "call", "--socket", SOCK, tool], input=json.dumps(args), capture_output=True, text=True, timeout=90)
    out = (p.stdout or "").strip()
    try:
        r = json.loads(out)
    except ValueError:
        r = None
    text = (out if r is None else json.dumps(r)) + (p.stderr or "")
    if tool != "start_session" and f"session '{SESSION}' has ended" in text:
        call("start_session", {})
        raise Ended("the browser session had ended")
    if r is None:
        raise Fail((out or p.stderr or f"{tool} failed").strip()[:600])
    return r


def refused(r):
    return isinstance(r, dict) and (r.get("status") == "refused" or "refusal" in r or r.get("effect") == "refused")


def why(r):
    ref = r.get("refusal") or {}
    return ref.get("message") or ref.get("code") or json.dumps(r)[:400]


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(st):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        json.dump(st, f)


# ---------------------------------------------------------------- Chrome

def endpoint():
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=2).read()
        return True
    except Exception:
        return False


def pgrep(*args):
    p = subprocess.run(["pgrep", "-u", str(os.getuid()), *args], capture_output=True, text=True)
    return [int(x) for x in p.stdout.split()]


def owner_pid():
    p = subprocess.run(["ss", "-ltnpH", f"sport = :{PORT}"], capture_output=True, text=True)
    for part in p.stdout.replace(",", " ").split():
        if part.startswith("pid="):
            return int(part[4:])
    found = pgrep("-o", "-x", "chrome")
    return found[0] if found else None


def start_chrome(url):
    restore = []
    if pgrep("-x", "chrome"):
        # A Chrome without the port can't be attached: restart it, tabs and all.
        subprocess.run(["pkill", "-u", str(os.getuid()), "-x", "chrome"])
        for _ in range(40):
            if not pgrep("-x", "chrome"):
                break
            time.sleep(0.25)
        restore = ["--restore-last-session"]
    exe = shutil.which("google-chrome") or "google-chrome"
    log = open("/tmp/otto-browser.log", "ab")
    subprocess.Popen(
        [exe, "--no-first-run", "--no-default-browser-check", "--start-maximized", "--remote-debugging-address=127.0.0.1", f"--remote-debugging-port={PORT}", *restore, *([url] if url else [])],
        stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True,
        # "no" is Chromium's documented opt-out: it hides the "API keys are missing" bar.
        env={**os.environ, "GOOGLE_API_KEY": "no", "GOOGLE_DEFAULT_CLIENT_ID": "no", "GOOGLE_DEFAULT_CLIENT_SECRET": "no"},
    )
    for _ in range(80):
        if endpoint():
            return
        time.sleep(0.25)
    raise Fail("Chrome didn't open its DevTools port. See /tmp/otto-browser.log.")


def attach(url=None):
    """Make sure Chrome is up and attached; returns state with target and tab."""
    if not os.path.exists(SOCK):
        raise Fail("The computer tools aren't running on this machine (no Cua Driver socket).")
    opened = started = False
    if not endpoint():
        start_chrome(url)
        opened, started = bool(url), True
    pid = owner_pid()
    if not pid:
        raise Fail("Chrome is running but its process wasn't found.")
    win = None
    for _ in range(40):
        ws = [w for w in call("list_windows", {"pid": pid}).get("windows", []) if w.get("is_on_screen", True)]
        if ws:
            win = ws[0]["window_id"]
            break
        time.sleep(0.25)
    if not win:
        raise Fail("Chrome has no window on the desktop.")
    if started:
        # Fill the screen the person watches; a restored session keeps its old, smaller bounds.
        subprocess.run(["wmctrl", "-i", "-r", hex(int(win)), "-b", "add,maximized_vert,maximized_horz"], capture_output=True)
    prep = call("browser_prepare", {"pid": pid, "window_id": win, "strategy": {"kind": "existing_profile"}})
    if not prep.get("prepared"):
        raise Fail(why(prep))
    s = call("get_browser_state", {"pid": pid, "window_id": win})
    if s.get("status") != "ok":
        raise Fail(why(s))
    old = load()
    tabs = s.get("tabs", [])
    keep = [t for t in tabs if t.get("url") == old.get("url")]
    active = [t for t in tabs if t.get("active")]
    web = [t for t in tabs if not str(t.get("url", "")).startswith(("chrome:", "about:"))]
    tab = (keep or active or web or tabs or [{}])[0]
    st = {**old, "pid": pid, "window_id": win, "target_id": s["target_id"], "tab_id": tab.get("tab_id"), "url": tab.get("url"), "title": tab.get("title"), "continuation": None}
    save(st)
    return st, opened


def with_target(fn):
    """Run fn(state); if the target or tab went stale, re-attach once and retry."""
    st = load()
    if not st.get("target_id") or not st.get("tab_id"):
        st, _ = attach()
    r = fn(st)
    if refused(r) and any(k in json.dumps(r) for k in ("target", "tab_id", "session", "unknown", "stale", "consent")):
        st, _ = attach()
        r = fn(st)
    return st, r


# ---------------------------------------------------------------- Output

def snapshot(st, query=None, more=False):
    args = {"target_id": st["target_id"], "tab_id": st["tab_id"], "snapshot_format": "semantic_v2"}
    if query:
        args["query"] = query
    if more and st.get("continuation"):
        args["continuation"] = st["continuation"]
    return call("get_browser_state", args)


def render(st, s):
    if refused(s):
        raise Fail(why(s))
    page = dict(s.get("page") or {})
    snap = s.get("snapshot") or {}
    # The driver's title can lag a navigation; DevTools has the live one.
    try:
        live = next((t.get("title") for t in devtools("/json/list") if t.get("url") == page.get("url")), None)
        page["title"] = live or page.get("title")
    except Exception:
        pass
    st["url"] = page.get("url") or st.get("url")
    st["title"] = page.get("title")
    st["continuation"] = snap.get("continuation") if not snap.get("complete", True) else None
    save(st)
    items = []
    for r in (s.get("refs") or []) + (s.get("content_refs") or []):
        try:
            n = int(str(r.get("ref", "")).split(":")[1])
        except (IndexError, ValueError):
            n = 0
        items.append((n, r))
    items.sort(key=lambda x: x[0])
    lines, seen = [], set()
    for _, r in items:
        role, name = r.get("role") or "", (r.get("name") or "").strip()
        value = r.get("value")
        if r.get("actions") and role not in TEXT_ROLES:
            if not name and role in ("link", "image", "img", "none", "presentation"):
                continue
            bits = [f"[{r['ref']}]", role]
            if name:
                bits.append(json.dumps(name[:120], ensure_ascii=False))
            if value not in (None, ""):
                bits.append(f"= {json.dumps(str(value)[:80], ensure_ascii=False)}")
            states = r.get("states") or {}
            bits += [k for k in ("checked", "disabled", "expanded", "selected") if states.get(k)]
            lines.append(" ".join(bits))
        elif name and len(name) > 1 and name not in seen and role in TEXT_ROLES:
            seen.add(name)
            lines.append(("# " if role == "heading" else "  ") + name[:200])
    head = f"{page.get('title') or '(untitled)'} | {page.get('url') or st.get('url') or ''}"
    out = [head]
    out += lines[:MAX_LINES]
    if len(lines) > MAX_LINES or st.get("continuation"):
        out.append("… more on the page: otto-browser read --more, or otto-browser read --query <text>")
    return "\n".join(out)


def settle(st=None, before=None):
    """Wait for the page to react: a new URL or title, else a short pause."""
    if not st or before is None:
        time.sleep(1.2)
        return
    for _ in range(16):
        time.sleep(0.4)
        try:
            p = (snapshot(st, query="__otto_probe__").get("page") or {})
        except Fail:
            continue
        if (p.get("url"), p.get("title")) != before:
            time.sleep(0.4)
            return


def page_of(st):
    """The page as last printed. Taking a new snapshot here would retire the refs the caller is using."""
    return (st.get("url"), st.get("title")) if st.get("url") else None


# ---------------------------------------------------------------- Commands

def cmd_open(args):
    url = args[0] if args else None
    st, opened = attach(url)
    if url and not opened:
        before = page_of(st)
        st, r = with_target(lambda s: call("browser_navigate", {"target_id": s["target_id"], "tab_id": s["tab_id"], "url": url}))
        if refused(r):
            raise Fail(why(r))
        settle(st, before)
    print(render(st, snapshot(st)))


def cmd_go(args):
    if not args:
        raise Fail("usage: otto-browser go <url>")
    url = args[0] if "://" in args[0] or args[0].startswith("about:") else "https://" + args[0]
    st0 = load()
    before = page_of(st0) if st0.get("target_id") else None
    st, r = with_target(lambda s: call("browser_navigate", {"target_id": s["target_id"], "tab_id": s["tab_id"], "url": url}))
    if refused(r):
        raise Fail(why(r))
    if r.get("tab_id"):
        st["tab_id"] = r["tab_id"]
    if r.get("target_id"):
        st["target_id"] = r["target_id"]
    settle(st, before)
    print(render(st, snapshot(st)))


def cmd_read(args):
    query = args[args.index("--query") + 1] if "--query" in args and args.index("--query") + 1 < len(args) else None
    st, s = with_target(lambda s: snapshot(s, query=query, more="--more" in args))
    print(render(st, s))


def cmd_click(args):
    if not args:
        raise Fail("usage: otto-browser click <ref>")
    ref = args[0].strip("[]")
    st0 = load()
    before = page_of(st0) if st0.get("target_id") else None

    def click(s):
        r = call("browser_click", {"target_id": s["target_id"], "tab_id": s["tab_id"], "ref": ref})
        if r.get("effect") == "refused":
            r = call("browser_click", {"target_id": s["target_id"], "tab_id": s["tab_id"], "ref": ref, "input_route": "dom_event"})
        return r

    st, r = with_target(click)
    if refused(r):
        raise Fail(why(r) + " (refs change when the page does: run otto-browser read)")
    settle(st, before)
    print(render(st, snapshot(st)))


def cmd_type(args):
    flags = {a for a in args if a in ("--replace", "--enter")}
    rest = [a for a in args if a not in flags]
    if len(rest) < 2:
        raise Fail("usage: otto-browser type <ref> <text> [--replace] [--enter]")
    ref, text = rest[0].strip("[]"), " ".join(rest[1:])
    st, r = with_target(lambda s: call("browser_type", {"target_id": s["target_id"], "tab_id": s["tab_id"], "ref": ref, "text": text, "replace": "--replace" in flags}))
    if refused(r):
        raise Fail(why(r) + " (refs change when the page does: run otto-browser read)")
    if "--enter" in flags:
        before = page_of(st)
        press(st, "Return")
        settle(st, before)
    else:
        settle()
    print(render(st, snapshot(st)))


KEYS = {"enter": "Return", "return": "Return", "esc": "Escape", "escape": "Escape", "tab": "Tab", "space": "space", "backspace": "BackSpace", "up": "Up", "down": "Down", "left": "Left", "right": "Right", "arrowup": "Up", "arrowdown": "Down", "arrowleft": "Left", "arrowright": "Right", "pagedown": "Page_Down", "pageup": "Page_Up"}


def press(st, key):
    r = call("press_key", {"key": KEYS.get(key.lower(), key), "pid": st["pid"], "window_id": st["window_id"], "delivery_mode": "foreground"})
    if refused(r):
        raise Fail(why(r))


def cmd_press(args):
    if not args:
        raise Fail("usage: otto-browser press <key>")
    st = load() or attach()[0]
    before = page_of(st)
    press(st, args[0])
    settle(st, before)
    print(render(st, snapshot(st)))


def devtools(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        body = r.read().decode()
    try:
        return json.loads(body)
    except ValueError:
        return body


def page_tabs(st):
    """Chrome's tabs in a stable order (DevTools lists the most recent first)."""
    pages = [t for t in devtools("/json/list") if t.get("type") == "page"]
    order = [i for i in st.get("order") or [] if any(t["id"] == i for t in pages)]
    order += [t["id"] for t in pages if t["id"] not in order]
    st["order"] = order
    save(st)
    return sorted(pages, key=lambda t: order.index(t["id"]))


def cmd_tabs(args):
    st, _ = attach()
    for i, t in enumerate(page_tabs(st), 1):
        mark = "*" if t.get("url") == st.get("url") else " "
        print(f"{mark} {i}. {t.get('title') or '(untitled)'} | {t.get('url')}")


def cmd_tab(args):
    st = load() if endpoint() else attach()[0]
    tabs = page_tabs(st)
    try:
        t = tabs[int(args[0]) - 1]
    except (IndexError, ValueError):
        raise Fail("usage: otto-browser tab <n>  (see otto-browser tabs)")
    # Bring it to the front on the desktop too, so the person sees the same tab.
    devtools(f"/json/activate/{t['id']}")
    st["url"], st["title"] = t.get("url"), t.get("title")
    save(st)
    st, _ = attach()
    print(render(st, snapshot(st)))


COMMANDS = {"open": cmd_open, "go": cmd_go, "read": cmd_read, "click": cmd_click, "type": cmd_type, "press": cmd_press, "tabs": cmd_tabs, "tab": cmd_tab}


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        return 0
    cmd = argv[0] if argv[0] in COMMANDS else "open"
    args = argv[1:] if argv[0] in COMMANDS else argv
    try:
        try:
            COMMANDS[cmd](args)
        except Ended:
            # Nothing ran: attach afresh under the revived session and do it again.
            save({k: v for k, v in load().items() if k not in ("target_id", "tab_id")})
            COMMANDS[cmd](args)
        return 0
    except Fail as e:
        print(f"otto-browser: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
