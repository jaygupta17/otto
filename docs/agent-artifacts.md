# Agent artifacts

The agent shows the user something with one tool, `present`, and Otto draws it
in the Artifact surface beside the chat. There is no artifact file on disk and
no second API: the tool call *is* the artifact.

## The tool

A generated OpenCode file plugin (`src/lib/presentPlugin.ts`), installed on
every connection at `$OTTO_HOME/.otto/agent-tool/otto-present` and added to the
machine's global config as one `{ package: "file://…" }` entry — the same
install shape as the schedule tool (`src/lib/agentTools.ts`).

```jsonc
{
  "source": "out/cover.png",     // required: a workspace path, an http(s) URL, or raw HTML
  "title": "Cover",             // optional: the label in the list
  "as": "image"                 // optional: force image | html | url | text | download
}
```

The plugin only checks the shape and returns a receipt (`{ presented: true }`).
It reads no files: what a source *is*, and whether it may be shown, is decided
where it is drawn, so the rules live in one place.

## How it reaches the surface

1. OpenCode streams the call as a tool part of the session.
2. The app projects it into a `Block` (`src/lib/opencode/projection.ts`).
3. `usePresentRecorder` (`src/hooks/usePresentRecorder.ts`) walks the loaded
   timelines and hands every `present` call to the artifact store
   (`src/state/artifacts.ts`), once per call id.
4. The Artifact surface (`src/components/panel/ArtifactSurface.tsx`) shows the
   session's list, newest first, and renders the selected one.
5. The chat answers with a chip per presentation, under the turn's final words
   (`src/components/chat/PresentChip.tsx`); a click opens that artifact.

A call is recorded when its input has arrived and it hasn't failed. Nothing is
persisted: the list is what this conversation showed.

## What it renders

| Source | Renderer |
| --- | --- |
| an image file | the file preview, fitted to the panel |
| an `.html` file | a sandboxed `<iframe srcDoc>` of the file's text |
| raw markup | a sandboxed `<iframe srcDoc>` |
| an `http(s)` URL, `localhost:port` | a sandboxed `<iframe src>`, via the provider's port forwarding for a dev server |
| text, code, `.pdf` | the file preview (`FileBody`) |
| archive, binary, unknown | a name, a size and a save button |

## Security

- A path is resolved against the session root and refused outside it
  (`resolveArtifactPath` → `insideRoot`), then checked for existence with
  `checkFile` (`src/lib/mdLinks.ts`).
- Frames are `sandbox="allow-scripts allow-forms allow-popups allow-modals
  allow-downloads"` — scripts can run, but with no `allow-same-origin` the page
  has an opaque origin and can't reach this app, its storage or its DOM. There
  is no `allow-top-navigation`.
- Agent markup never goes through `dangerouslySetInnerHTML`; it goes into the
  frame's `srcDoc` and stays there.
- A URL has to pass `isPreviewable` (`src/lib/linkPreview.ts`) before it is
  framed, which refuses loopback, private ranges, CGNAT, link-local addresses
  and local hostnames. A `localhost:port` source is translated to the agent
  machine's forwarded address first, and the result is checked again. Loopback
  is never framed, even on a workspace that runs on this machine: the rule is
  not weakened.
