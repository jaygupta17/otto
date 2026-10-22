# Agent schedules

Otto's schedules are plain data plus cron on the machine that runs the agent.
The app and the agent tool (`otto_schedule`) write the same file through the
same protocol, so a person editing in the Schedules view and an agent editing
in chat cannot silently overwrite each other.

## Where it lives

Everything is under `$OTTO_HOME/.otto` (or `$HOME/.otto`):

| Path | What it is |
| --- | --- |
| `schedules.json` | Source of truth: `{ "version": 2, "rev": 3, "schedules": [...] }` |
| `schedules.lock` | Held while one writer changes the file (`mkdir` is the lock) |
| `server.env` | Local API URL and password for the runner, mode 600 |
| `bin/otto-run <id>` | Creates a session and sends the prompt |
| `tasks/<id>.session.json`, `tasks/<id>.prompt.json` | Pre-built request bodies |
| `tasks/<id>.lock` | One run per task at a time; stale after 30 minutes |
| `logs/<id>.log` | Run history (`<iso> ok <sessionID>` / `<iso> error <why>`) |
| `state/<id>.json` | Last run, written by the runner for the schedule card |

Cron entries live in one marked block that Otto owns:

```cron
# >>> otto schedules (managed by Otto; edit in the app) >>>
30 9 * * 1,2,3,4,5 OTTO_DIR='/home/me/.otto' '/home/me/.otto/bin/otto-run' sch_abc123 >/dev/null 2>&1
# <<< otto schedules <<<
```

Everything outside the block is preserved line for line. If `crontab` is
missing or refuses a write, the schedule is still saved (the file is the source
of truth) and the app says cron is not set up.

## Storage protocol

Every mutation is the same sequence, run under `~/.otto/schedules.lock`:

1. `mkdir` the lock folder (fails if another writer holds it; retry 50 times,
   100 ms apart; a lock older than 30 seconds is removed as stale).
2. Read `schedules.json`. v1 files (`{ "schedules": [...] }` or a bare array)
   are accepted and upgraded on the next write.
3. If the caller passed a rev and it is not the file's rev, stop with
   `StaleScheduleError` (carrying the current rev and list). Nothing is written.
4. Mutate one schedule id (create, replace, patch, enable, delete).
5. Write the runner and the changed task payloads; write the new file to a
   temporary path and rename it over `schedules.json` (`rev + 1`).
6. Rewrite the crontab block for all enabled schedules.
7. Release the lock (always, including on errors).

The app's service (`src/lib/scheduleStore.ts` + `src/lib/schedules.ts`) and the
generated plugin (`src/lib/schedulesPlugin.ts`) implement this independently
over their own I/O; both are covered by tests. No caller writes the whole list
from memory: the app sends one schedule plus the rev it read.

Each schedule carries optional `createdBy` (`"user"` or `"agent:<sessionID>"`),
`createdByAgent` (the agent id, for the byline), `lastRun`
(`{ at, ok, sessionID?, error? }`) and a reserved `timezone`.

## The tool

The OpenCode file plugin at `~/.otto/agent-tool/otto-schedule/` registers one
tool, `otto_schedule`. It is installed for every workspace connection, so a
brand-new session can schedule something without anyone opening Schedules
first; opening the view or saving a schedule also ensures it. The runner,
`server.env` and task payloads are prepared the same way, but cron is not
written until the first schedule exists, so a new machine gets no empty managed
block. The plugin goes into the global config as exactly one entry:

```jsonc
{ "plugins": [{ "package": "file:///home/me/.otto/agent-tool/otto-schedule", "options": {} }] }
```

`ensureSchedulePlugin(client)` writes `package.json` and `index.js` only when
their text changed, then adds/replaces the entry. `removeSchedulePlugin(client)`
removes the entry and leaves the files in place. Turning off Settings → General
→ Automation → **Agents can manage schedules** does exactly that: the tool is
gone from new sessions, while `schedules.json`, the runner, existing cron lines
and run history stay, so existing schedules keep firing. Turning it back on
reinstalls the plugin and keeps them.

Parameters:

| Field | Notes |
| --- | --- |
| `action` | `list`, `create`, `update`, `setEnabled`, `delete`, `run` |
| `id` | Required for `update`, `setEnabled`, `delete`, `run` |
| `name`, `prompt` | Required for `create`; updating one leaves the other alone |
| `frequency` | `{ kind: "hourly" \| "daily" \| "weekdays" \| "weekly" \| "custom", minute?, hour?, days?, cron? }` |
| `directory`, `agent`, `model` | `model` is `provider/id` (an optional `#variant` suffix is kept) |
| `enabled` | Defaults to `true` on create; `setEnabled` requires it |
| `timezone` | IANA name; must match the machine's zone today (see limits) |
| `rev` | From `list`; when passed to `update`/`delete`, a newer change is refused with `{ "stale": true, "rev": … }` instead of overwritten |

The tool returns compact JSON: `{ rev, schedules }` for `list`, `{ rev,
schedule, warnings }` for writes, `{ rev, run }` for `run`. A stale refusal is
`{ stale: true, rev, schedules }` — call `list`, adjust, retry. `warnings` can
include `cron-missing` or `cron-failed: …`; the definition is still saved.

Times are machine wall time. An agent-created `daily 09:00` means 09:00 where
the machine is, not where the phone is.

## Permissions

The tool asks before acting, with four actions:

| Action | Used by | Default on install |
| --- | --- | --- |
| `otto_schedule.read` | `list` | allow |
| `otto_schedule.write` | `create`, `update`, `setEnabled` | ask |
| `otto_schedule.delete` | `delete` | ask |
| `otto_schedule.run` | `run` | allow |

The resource passed is the schedule id (or name, when creating). The first
install writes the defaults into the global config's `permissions` list, where
the existing permission editor shows and edits them; it only adds actions that
have no rule yet. Uninstalling the plugin leaves those rules alone.

## Known limits

- **Awake only.** A schedule fires only while the machine (or sandbox) is
  running cron. Sandboxes that hibernate or stop pause their schedules.
- **No catch-up.** A run missed while the machine slept does not fire later.
  The next matching time runs normally.
- **One timezone per machine.** The IANA zone is not stored/used per schedule
  yet: the frequency is converted to a fixed cron line in machine time when it
  is saved. The app interprets the times in the zone of the device that saved
  them, and the agent tool uses the machine's zone; editing from another zone
  can shift a schedule. DST changes also leave the stored line alone (a
  schedule set in summer fires an hour off in winter).
- **Cron must work.** Otto checks `crontab -l` rather than assuming; there is
  no automatic install and no `sudo`. Without cron, schedules save and show a
  notice but never fire.
- **One file per machine.** Schedules are not synced between machines.
- **One run per task.** If a run is still in flight when cron fires again, the
  second run is skipped and `skipped-running` is written to the log.
