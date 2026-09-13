# ACP session ids vs Host Sessions and transcripts

Ticket: [#36](https://github.com/adamk33n3r/cursor-local-remote/issues/36) (part of [#34](https://github.com/adamk33n3r/cursor-local-remote/issues/34)).
Date: 2026-09-13.
Scope: Host Session identity only. Agent Window Continuity is out of scope.

## Verdict

ACP `sessionId` values from `session/new` / `session/load` are **not** the same Session as the Host's print-mode identity.

They share a **UUID shape** (`crypto.randomUUID()`), not a **store**. Print-mode Sessions (what the Host lists, resumes, archives, and exports today) live under `~/.cursor/chats/` plus jsonl transcripts under `~/.cursor/projects/<workspace-key>/agent-transcripts/`. ACP Sessions live under `~/.cursor/acp-sessions/`.

So:

- `session/load` **cannot** resume a print-mode Session.
- Print-mode `--resume` **cannot** load an ACP Session.
- Host list / resume / archive / export **do not** treat an ACP `sessionId` as the same Session unless the Host grows a second identity path.

Cursor ACP docs never claim otherwise. The Agent Client Protocol spec treats `sessionId` as an opaque string. The installed Agent CLI (2026.09.10-fd3934a) implements two separate on-disk stores.

## What the Host uses as Session identity today

The Host in Agent mode spawns print-mode Agent (`-p`, `--output-format stream-json`), stores the print-mode `session_id`, lists by merging that store with jsonl filenames, and resumes with `--resume`.

| Operation | Identity used | Source |
| --- | --- | --- |
| Create / follow-up | `session_id` from the `system`/`init` stream-json event; persisted as sqlite `sessions.id` | [`src/app/api/chat/route.ts`](../../src/app/api/chat/route.ts) (`waitForSessionId` → `upsertSession`); [`src/lib/session-store.ts`](../../src/lib/session-store.ts) |
| Resume | argv `--resume <sessionId>` | [`src/lib/agent-argv.ts`](../../src/lib/agent-argv.ts) |
| List | Merge sqlite rows with jsonl entries whose **directory/file name** is the Session id | [`src/app/api/sessions/route.ts`](../../src/app/api/sessions/route.ts); [`src/lib/transcript-reader.ts`](../../src/lib/transcript-reader.ts) `readCursorSessions` |
| History / watch / export | Resolve `~/.cursor/projects/<key>/agent-transcripts/<sessionId>/` (or `<sessionId>.jsonl`) | [`src/lib/transcript-reader.ts`](../../src/lib/transcript-reader.ts) `resolveJsonlPath`; [`src/app/api/sessions/history/route.ts`](../../src/app/api/sessions/history/route.ts); [`src/components/chat-container.tsx`](../../src/components/chat-container.tsx) export filename |
| Archive | Same string as sqlite primary key; can insert a jsonl-discovered row so archive survives merge | [`src/lib/session-store.ts`](../../src/lib/session-store.ts) `archiveSession`; [`src/app/api/sessions/route.ts`](../../src/app/api/sessions/route.ts) PATCH |

Host id validation is `^[a-zA-Z0-9_-]{1,128}$` ([`src/lib/validation.ts`](../../src/lib/validation.ts)). A UUID fits. Format compatibility is not store compatibility.

Print-mode docs document `session_id` as a UUID on every stream-json event, stable for one Agent execution ([Cursor CLI output format](https://cursor.com/docs/cli/reference/output-format)). `--resume [chatId]` is the documented resume flag ([Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters); [Using Agent in CLI](https://cursor.com/docs/cli/using)).

## Cursor ACP docs (what they settle, what they do not)

[Cursor CLI ACP](https://cursor.com/docs/cli/acp):

- Spawn `agent acp`; JSON-RPC over stdio.
- Flow: `initialize` → `authenticate` (`cursor_login`) → `session/new` **or** `session/load` → `session/prompt`.
- "Create a session with `session/new`". "Resume an existing conversation with `session/load`".
- ACP modes are the same names as CLI: `agent`, `plan`, `ask`.
- The sample client keeps `sessionId` from `session/new` and passes it to `session/prompt`. It does not mention print-mode `session_id`, `--resume`, jsonl, or `~/.cursor/projects`.

Those docs do **not** say ACP `sessionId` equals print-mode `session_id` or a transcript filename.

`agent acp` is a hidden command in the parameter reference ([Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters)). Installed help (`agent acp --help`, Agent 2026.09.10-fd3934a) only says it starts an ACP server.

## ACP spec: opaque `sessionId`, two resume verbs

[Session setup](https://agentclientprotocol.com/protocol/v1/session-setup) and [schema `SessionId`](https://agentclientprotocol.com/protocol/v1/schema):

- `sessionId` is a **string**. Spec examples use values like `sess_abc123def456`, not UUIDs.
- `session/new` **must** return a unique id for that conversation.
- `session/load` exists only if `agentCapabilities.loadSession` is true. The agent restores context and **replays** history as `session/update`, then returns.
- `session/resume` is a **different** method, gated on `sessionCapabilities.resume`, and must **not** replay history. Installed Agent does not advertise this (see below).
- `session/list` is gated on `sessionCapabilities.list`.

The spec does not bind `sessionId` to any on-disk path. Equality with print-mode ids is an implementation choice.

## Installed Agent CLI (2026.09.10-fd3934a)

Inspected on this machine: `agent --version` → `2026.09.10-fd3934a`. Webpack module names below are the bundled originals inside that install (`8412.index.js`, `3484.index.js`, `5098.index.js`, `1661.index.js`).

### Live `initialize`

A stdio client sent `initialize` to `agent acp` (no authenticate, no `session/new`). Result:

```json
{
  "loadSession": true,
  "mcpCapabilities": { "http": true, "sse": true },
  "promptCapabilities": { "audio": false, "embeddedContext": false, "image": true },
  "sessionCapabilities": { "list": {} }
}
```

Auth methods: `cursor_login`. **No** `sessionCapabilities.resume`. Matches bundled `src/acp/cursor-acp-agent.ts` `initialize()`.

### ACP create: UUID into `acp-sessions/`

`newSession` (bundled `src/acp/cursor-acp-agent.ts`):

1. Requires authentication.
2. `const n = crypto.randomUUID()`.
3. Opens an agent store via `src/acp/agent-store.ts` with that UUID and the request `cwd`.
4. Returns `{ sessionId: n, modes, models, configOptions }`.

Store path (bundled `src/acp/acp-storage.ts`):

- Root: `join(cursorUserDir, "acp-sessions")` i.e. `~/.cursor/acp-sessions/`.
- Per Session: `~/.cursor/acp-sessions/<sessionId>/store.db`.
- Sidecar: `meta.json` with `schemaVersion`, absolute `cwd`, optional `title`.

ACP modules in this bundle **do not** mention `agent-transcripts`. Conversation replay for `session/load` reads the agent store (`getFullConversation`), not jsonl (`src/acp/agent-session.ts` `replayConversationHistory`).

### ACP load: only `acp-sessions/<id>/store.db`

`loadSession` (same agent class):

1. Sets `resumeChatId` to the request `sessionId`.
2. `agent-store.ts`: `dbPath = acp-sessions/<id>/store.db`. If `resumeChatId` is set and that file is **missing**, throw `SessionNotFoundError` (`Session "<id>" not found`), mapped to JSON-RPC `invalidParams`.
3. If present, `initAndLoad` + `resetFromDb`, then replay history.

A print-mode Session's sqlite lives under `~/.cursor/chats/`, not `acp-sessions/`. `session/load` will not find it.

### ACP list: only `acp-sessions/`

Bundled `src/acp/session-list.ts`: if `~/.cursor/acp-sessions` is missing, return `[]`. Otherwise `readdir` directories that contain `store.db`, read `meta.json` `cwd`/`title`, optionally filter by absolute `cwd`. `unstable_listSessions` merges that disk list with in-process sessions. It does not scan `chats/` or `projects/*/agent-transcripts/`.

### Print-mode / `--resume`: `chats/<md5(cwd)>/<uuid>/`

Bundled `src/state/index.ts`:

- Chats root: `join(cursorUserDir, "chats")` → `~/.cursor/chats/`.
- Cwd bucket: `md5(resolve(cwd))` hex, 32 chars.
- Session dir: `~/.cursor/chats/<bucket>/<uuid>/`.

New print-mode Session (`3484.index.js` `runAgent`, `sessionStart.kind === "new"`): `crypto.randomUUID()`, directory `join(cwdBucket, uuid)`, `store.db` there.

Resume (`kind === "resume"`): `join(cwdBucket, sessionId, "store.db")` where `cwdBucket` is `md5(resume cwd)` if a cwd was picked, else `md5(process.cwd())`. `--resume <chatId>` copies that string in as `sessionId` (`--resume` help: "Select a session to resume"; docs: `--resume [chatId]`).

`agent create-chat` (`1661.index.js`): same `chats/<md5(cwd)>/<uuid>/store.db` layout; `--new-session-id` must be UUIDv4 and cannot combine with `--resume` (`src/state/requested-session-id.ts`).

Resume picker (`src/state/chat-session-list.ts`): scans **chats** buckets for `store.db`, skips `isSubagent` and `hasConversation === false`. It does not scan `acp-sessions/`.

So `--resume <acpSessionId>` looks for `~/.cursor/chats/<md5(cwd)>/<acpSessionId>/store.db`, not `~/.cursor/acp-sessions/<acpSessionId>/store.db`.

## Transcript files on disk (id format and shape)

Observed locally; no prompts or home paths with a username.

**jsonl transcripts** (`~/.cursor/projects/<workspace-key>/agent-transcripts/`):

- One directory per Session; name is a 36-char lowercase UUID.
- Inner file is `<same-uuid>.jsonl` (basename equals folder name on every checked pair).
- Host list uses that directory/file name as `StoredSession.id` ([`readCursorSessions`](../../src/lib/transcript-reader.ts)).
- Sample lines: `{ role, message }` for user/assistant, plus `{ type: "turn_ended", status }` markers. These on-disk jsonl lines **do not** carry a `session_id` field; identity is the path. (Print-mode **stdout** stream-json **does** carry `session_id` per [output format](https://cursor.com/docs/cli/reference/output-format); that is the stream the Host parses, not the jsonl schema.)

**Print-mode chat stores** (`~/.cursor/chats/<32-hex-md5>/<uuid>/`):

- `meta.json` keys: `schemaVersion`, `createdAtMs`, `hasConversation`, `updatedAtMs`, `cwd`, optional `title`, optional `isSubagent`.
- Optional `store.db`, `prompt_history.json`.
- Counts on this machine: 31 dirs with `store.db`; **28 of those UUIDs also exist as transcript directories**. Meta-only dirs (no `store.db`) had no transcript dir. That is the print-mode identity the Host already merges: same UUID in `chats/` and `agent-transcripts/`.

**ACP store**: `~/.cursor/acp-sessions/` **did not exist**. Zero overlap with transcript ids. Consistent with ACP never having been used here, and with ACP writing a different root.

Workspace key encoding the Host already documents: absolute Workspace with separators turned into hyphens (`D:\dev\foo` → `d-dev-foo`) ([`src/lib/transcript-reader.ts`](../../src/lib/transcript-reader.ts); [`src/lib/cursor-project-cache.mjs`](../../src/lib/cursor-project-cache.mjs)).

## Cross-resume matrix

| From | Into | Works? | Why |
| --- | --- | --- | --- |
| Print-mode Session (Host / `--print`) | ACP `session/load` | **No** | Load requires `~/.cursor/acp-sessions/<id>/store.db`. Print-mode sqlite is under `chats/`. |
| ACP Session | Print-mode `--resume` | **No** | Resume opens `~/.cursor/chats/<md5(cwd)>/<id>/store.db`. ACP sqlite is under `acp-sessions/`. |
| Print-mode Session | Host list / history / export | **Yes** (today) | jsonl name = print-mode UUID; Host sqlite keyed the same. |
| ACP Session | Host list / history / export | **Not as the same Session** | No jsonl under `agent-transcripts/<acpId>/` from ACP code paths; Host list would miss it unless the Host also wrote sqlite and the Client never needed history from jsonl. `--resume` would still miss the ACP store. |
| ACP `session/new` then later `session/load` with that id | ACP | **Yes** (same ACP store) | Documented by Cursor ACP docs + `loadSession: true` + `acp-sessions/` layout. |
| Print-mode `--print` then later `--resume <session_id>` | Print-mode | **Yes** (same chats + jsonl UUID) | Documented CLI + Host argv + disk overlap. |

Cursor changelog notes `--continue`, resume pickers, and transcript persistence for CLI chats ([CLI changelog](https://cursor.com/docs/cli/changelog)). Those entries talk about CLI resume, not ACP `sessionId` aliasing.

## Implications for Host list, resume, archive, export

If the Host keeps today's print-mode spawn:

- Session identity stays the stream-json / jsonl UUID.
- Switching the spawn to `agent acp` without a new store adapter **breaks** that identity: ACP ids will not appear as jsonl rows, and `--resume` will not open them.

If the Host switches to ACP:

- Persist ACP `sessionId` as Host `sessions.id` (format already allowed).
- Resume must call `session/load` (not `--resume`), after checking `loadSession`.
- List/history/export cannot keep "jsonl filename is the Session" as the only disk truth. Options are: read `~/.cursor/acp-sessions/` (and `session/list`), keep a Host-side transcript, or wait for ACP to write jsonl (it does not in this CLI version).
- Archive can remain Host sqlite, but "archive a jsonl-only row" ([`archiveSession` inserting from `readCursorSessions`](../../src/lib/session-store.ts)) would not see ACP Sessions.

Do not assume ACP `sessionId` and print-mode `session_id` are interchangeable because both are UUIDs.

## Sources

- [Cursor CLI ACP](https://cursor.com/docs/cli/acp)
- [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters)
- [Cursor CLI output format](https://cursor.com/docs/cli/reference/output-format)
- [Using Agent in CLI](https://cursor.com/docs/cli/using)
- [CLI changelog](https://cursor.com/docs/cli/changelog)
- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP schema (`SessionId`, `session/new`, `session/load`)](https://agentclientprotocol.com/protocol/v1/schema)
- Installed Cursor Agent CLI `2026.09.10-fd3934a`: `agent --help`, `agent acp --help`, live `initialize`, bundled `src/acp/*`, `src/state/index.ts`, `src/state/chat-session-list.ts`, `src/commands/create-chat.ts`
- This repo: [`src/lib/agent-argv.ts`](../../src/lib/agent-argv.ts), [`src/app/api/chat/route.ts`](../../src/app/api/chat/route.ts), [`src/lib/session-store.ts`](../../src/lib/session-store.ts), [`src/app/api/sessions/route.ts`](../../src/app/api/sessions/route.ts), [`src/lib/transcript-reader.ts`](../../src/lib/transcript-reader.ts)
- Local `~/.cursor/projects/*/agent-transcripts` and `~/.cursor/chats` layout (id format and file shape only)

## Out of scope

- Whether an ACP or print-mode Session appears as a row in the Agent Window (Continuity).
- Whether a Host-side adapter *could* copy ACP history into jsonl. This note records current stores, not a proposed bridge.
