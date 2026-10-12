import { E2BClient } from "/Users/jay/personal/lab/omnipi/src/lib/providers/e2b";
import { wrapScript } from "/Users/jay/personal/lab/omnipi/src/lib/providers/boat";

// What model/provider did the failing sessions use, and does the server have
// a provider credential at all? One exec, flat python, no heredocs.
const NUL = String.fromCharCode(0);
const script = `
python3 -c 'import sqlite3,json; db=sqlite3.connect("/home/user/.local/share/opencode/opencode.db"); rows=db.execute("select id,data from session order by rowid desc limit 10").fetchall(); [print(i, json.loads(d).get("id","")[:24], (json.loads(d).get("title") or "")[:22]) for i,(tid,d) in enumerate(rows)]'
echo "== per-session model =="
python3 -c 'import sqlite3,json; db=sqlite3.connect("/home/user/.local/share/opencode/opencode.db"); rows=db.execute("select id,data from session order by rowid desc limit 10").fetchall(); [print(json.loads(d).get("id","")[:24], json.dumps(json.loads(d).get("model") or {})[:120]) for i,(tid,d) in enumerate(rows)]'
echo "== is there an auth/credential file? =="
find /home/user -maxdepth 4 -name "auth.json" 2>/dev/null | head
echo "== env keys the server process has =="
P=$(pgrep -f "opencode serve" | head -1)
tr "${NUL}" "\\n" < "/proc/$P/environ" 2>/dev/null | grep -iE "^(OPENCODE|ANTHROPIC|OPENAI|XAI|GOOGLE|GROQ|OPENROUTER|ZEN|API_KEY)" | sed "s/=.*/=<set>/"
echo DONE
`;

const e2b = new E2BClient(process.env.K!);
const ref = await e2b.connect("iv0qwpj7q4a3lt1oin3uf", 1800);
const r = await e2b.exec(ref, wrapScript(script), 40);
console.log(r.stdout || "(no output)");
console.log("exitCode:", r.exitCode);
