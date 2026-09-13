# Host Session surface mapped onto ACP

Ticket: [#35](https://github.com/adamk33n3r/cursor-local-remote/issues/35). Question: what of today's Host Session surface maps onto ACP (`session/new`, `session/load`, `session/prompt`, `session/update`, `session/cancel`)?

Settled from Cursor ACP docs, the installed Agent CLI, ACP v1 spec, and this repo's Host code. Not blog posts. Does not decide ACP-only vs fallback. Does not research Agent Window Continuity.

Captured 2026-09-13 against installed Agent `2026.09.10-fd3934a` (`agent --version`) and Cursor docs as fetched that day.

## Decisions-so-far

Print-mode start maps to `session/new` + `session/prompt`. `--resume` maps to `session/load` (this Agent advertises `loadSession: true`, not `session/resume`). Live watch's jsonl + process registry maps to `session/update`, but only as the in-flight stream: the Host would lose process-liveness, SIGTERM cancel, disk-jsonl merge while a turn runs, the existing stream-json parser, the tool-call sidecar, and late-join via the in-memory live buffer. Cancel maps to `session/cancel` (cooperative; the Agent process stays up). History maps to `session/load` replay, not to a Host JSONL read.

## Sources

| Source | What it owns |
| --- | --- |
| [Cursor CLI ACP](https://cursor.com/docs/cli/acp) | How Cursor's Agent speaks ACP: `agent acp`, stdio JSON-RPC, flow, `session/new` vs `session/load`, permissions, extension methods, `protocolVersion: 1` example |
| [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters) | `-p`/`--print`, `--output-format`, `--stream-partial-output`, `--resume`, `--continue`, `--trust`, `--force`, `--workspace`, `--mode`; `acp` as a hidden command |
| [Cursor CLI output format](https://cursor.com/docs/cli/reference/output-format) | stream-json NDJSON: `system`/`init` + `session_id`, `user`/`assistant`/`tool_call`/`result`; thinking suppressed in print; `--stream-partial-output` deltas |
| [Using Agent in CLI](https://cursor.com/docs/cli/using) | `--resume [thread id]`; `-p` non-interactive with full write access |
| [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview) | Baseline vs optional methods; prompt-turn shape |
| [ACP v1 session setup](https://agentclientprotocol.com/protocol/v1/session-setup) | `session/new`, `session/load` (gated by `loadSession`), `session/resume` (gated by `sessionCapabilities.resume`) |
| [ACP v1 prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn) | `session/prompt`, `session/update`, `session/cancel` → `stopReason: cancelled` |
| [ACP v1 cancellation](https://agentclientprotocol.com/protocol/v1/cancellation) | `session/cancel` vs `$/cancel_request` |
| [ACP v1 schema](https://agentclientprotocol.com/protocol/v1/schema) | Method contracts; `SessionUpdate` variants |
| [ACP v1 transports](https://agentclientprotocol.com/protocol/v1/transports) | stdio: newline JSON-RPC; stdout must be ACP only; stderr for logs |
| Installed Agent `2026.09.10-fd3934a` | `agent --help`, `agent acp --help`; bundled ACP handler (`loadSession: true`, `sessionCapabilities.list` only; `newSession` UUID; `loadSession` uses `resumeChatId`; cancel via `pendingPromptCancel`) |
| Host: `src/lib/agent-argv.ts`, `src/lib/cursor-cli.ts`, `src/app/api/chat/route.ts` | Print-mode spawn, `--resume`, wait for stream-json `session_id` |
| Host: `src/lib/process-registry.ts`, `src/lib/live-ws.ts`, `src/app/api/sessions/active/route.ts` | Live bus, watch WebSocket, SIGTERM cancel |
| Host: `src/app/api/sessions/history/route.ts`, `src/lib/transcript-reader.ts`, `src/lib/session-store.ts`, `src/lib/tool-call-events.ts` | History from Cursor agent-transcripts jsonl + Host DB + tool-call sidecar |

ACP v2 is published as draft and removes `session/load` in favor of `session/resume` with `replayFrom`. Cursor's ACP docs and the installed Agent's initialize payload are v1 (`session/load`, example `protocolVersion: 1`). This map uses v1.

## Map

| Host surface today | Mechanism | ACP method | Fit |
| --- | --- | --- | --- |
| Start | `POST /api/chat` with no `sessionId` → spawn `agent -p <prompt> --output-format stream-json --stream-partial-output --trust` → wait for stream-json `system`/`init`/`session_id` | `initialize` + `authenticate` (`cursor_login`) + `session/new` (cwd, mcpServers) then `session/prompt` | Start splits: ACP creates the Session id in `session/new`'s result; print mode learns the id from the first stdout event. The user message is `session/prompt`, not `session/new`. |
| Resume | Same POST with `sessionId` → `--resume <id>` on a **new** child | `session/load` with that id (then `session/prompt`) | Same conversation id. ACP loads inside a long-lived `agent acp` process and replays history on the wire. Host resume spawns a fresh print-mode process. |
| Live watch | WebSocket `/api/sessions/watch` merges Cursor jsonl + process-registry stdout NDJSON | `session/update` notifications during (and, on load, as replay of) a Session | Same job (stream tokens, tools, thoughts). Different envelope, producer, and liveness model. See [What Agent mode would lose](#what-agent-mode-would-lose). |
| Cancel | `DELETE /api/sessions/active` → `child.kill("SIGTERM")` | `session/cancel` notification; Agent then answers the open `session/prompt` with `stopReason: "cancelled"` | Both interrupt a turn. Print cancel destroys the producer process. ACP cancel is cooperative and leaves the ACP process up. |
| History | `GET /api/sessions/history` reads agent-transcripts jsonl (plus Host `sessions.db` list and a tool-call sidecar) | `session/load` MUST replay the conversation as `session/update` before it returns | Same Session id can be loaded. Host history is a disk parse the Client can fetch without an Agent process. ACP replay requires an ACP connection and `loadSession`. |

Not in the ticket's five methods, but on the Host surface:

| Host surface | ACP analogue | Notes |
| --- | --- | --- |
| `GET /api/sessions` (Host DB ∪ agent-transcripts) | `session/list` (optional; this Agent advertises `sessionCapabilities.list`) | Host list does not call Agent. This Agent rejects `session/list` pagination cursors. |
| Archive/delete in Host DB | `session/delete` (optional; not advertised by this Agent) | Host delete does not delete Cursor transcripts. |
| Watch `isActive` | No v1 `session/update` variant for process liveness. Turn end is the `session/prompt` result (`stopReason`). | Host `isActive` means "print-mode child is in the process registry." |
| `session/request_permission` | Cursor ACP sends this; print mode with `--force`/`--trust` does not expose it on stdout | If the Host does not answer, ACP tool execution can block ([Cursor ACP](https://cursor.com/docs/cli/acp)). |
| Cursor extension methods (`cursor/ask_question`, `cursor/create_plan`, …) | ACP-only richer UX | Print stream-json has no equivalent RPC. Host UI does not implement them today. |

## Start

Host Agent mode never runs interactive `agent`. Every Client prompt becomes one print-mode child ([`src/lib/agent-argv.ts`](../../src/lib/agent-argv.ts)):

```
-p <prompt> --output-format stream-json --stream-partial-output --trust
[+ --force] [+ --resume <sessionId>] [+ --workspace] [+ --model] [+ --mode ask|plan]
```

`--mode` is omitted when the mode is `agent`. `--trust` is always passed; `--force` follows Host `trust` / `CURSOR_FORCE` ([`src/lib/cursor-cli.ts`](../../src/lib/cursor-cli.ts)).

[`POST /api/chat`](../../src/app/api/chat/route.ts) then:

1. Spawns that argv and registers the child under a random `requestId`.
2. If the Client sent `sessionId`, promotes the registry key immediately (resume).
3. Parses stdout NDJSON until `type === "system" && subtype === "init" && session_id`, with a 60s timeout (`AGENT_INIT_TIMEOUT_MS`).
4. Upserts that id into Host `sessions.db` and returns `{ sessionId }`.
5. If init never arrives, SIGTERM the child and 500.

Cursor print docs: stream-json emits that `system`/`init` event once at the beginning, with `session_id` a UUID, and that id stays consistent for the execution ([output format](https://cursor.com/docs/cli/reference/output-format)). `-p` is non-interactive and has write/shell tool access ([parameters](https://cursor.com/docs/cli/reference/parameters), [using](https://cursor.com/docs/cli/using)).

ACP start, from [Cursor ACP](https://cursor.com/docs/cli/acp) and ACP v1:

1. Spawn `agent acp` (hidden command; `agent acp --help` on this machine: "Start the Cursor Agent as an ACP (Agent Client Protocol) server").
2. `initialize` with `protocolVersion: 1` (Cursor's own example).
3. `authenticate` `{ methodId: "cursor_login" }` (or pre-auth via `agent login` / `--api-key` / `--auth-token`).
4. `session/new` `{ cwd, mcpServers }` → `{ sessionId }`.
5. `session/prompt` `{ sessionId, prompt: [{ type: "text", text }] }` → later `{ stopReason }`.
6. Meanwhile `session/update` notifications.

Installed Agent `newSession`: requires auth; `sessionId = crypto.randomUUID()`; cwd defaults to `process.cwd()`; builds an in-process session map entry. The id is in the RPC result, not a stdout `system`/`init` line.

So: Host start = one print process whose first event is the Session id, then the same process is the turn. ACP start = long-lived ACP process, Session id from `session/new`, user text from a separate `session/prompt`. Follow-up Host prompts spawn **another** print process with `--resume`. Follow-up ACP prompts are `session/prompt` on the same Session in that process (`prompt(e)` looks up `this.sessions.get(e.sessionId)`).

## Resume

Host resume is still print mode: `buildAgentArgv` adds `--resume`, `options.sessionId` ([`src/lib/agent-argv.ts`](../../src/lib/agent-argv.ts)). Cursor: `--resume [chatId]` resumes a chat; `--continue` is `--resume=-1`; `agent resume` / `agent ls` are interactive ([parameters](https://cursor.com/docs/cli/reference/parameters), [using](https://cursor.com/docs/cli/using)). Host never uses `agent resume` or `agent ls`; it passes the UUID it stored from init.

Cursor ACP: "Create a session with `session/new`. Resume an existing conversation with `session/load`." ([ACP docs](https://cursor.com/docs/cli/acp)).

ACP v1: `session/load` is optional, gated by `agentCapabilities.loadSession`. The Agent MUST replay the whole conversation as `session/update` before answering `session/load`. `session/resume` (no replay) is a different optional capability (`sessionCapabilities.resume`) ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup)).

Installed Agent initialize returns `agentCapabilities: { loadSession: true, mcpCapabilities: { http: true, sse: true }, promptCapabilities: { audio: false, embeddedContext: false, image: true }, sessionCapabilities: { list: {} } }`. No `sessionCapabilities.resume`, no `sessionCapabilities.close`. Resume for this binary is `session/load`, not `session/resume`.

Installed `loadSession`: copies options with `resumeChatId: sessionId`, inits the Agent store for that id, then `replayConversationHistory` (`agentStore.getFullConversation` → `user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / tool replay). A missing store path throws. That is the same resume-by-id idea as `--resume`, inside ACP instead of a new `-p` process.

Host Client `loadSession` in [`src/hooks/use-chat.ts`](../../src/hooks/use-chat.ts) does **not** spawn Agent. It GETs `/api/sessions/history`, then opens `/api/sessions/watch`. Spawning `--resume` happens only when the user sends the next prompt.

## Live watch

Host live path ([`src/lib/live-ws.ts`](../../src/lib/live-ws.ts), [`src/lib/process-registry.ts`](../../src/lib/process-registry.ts)):

- Upgrade endpoint `LIVE_WATCH_PATH = "/api/sessions/watch"`. HTTP on that path is 426 "WebSocket required".
- Query: `id` (Session id) + optional `workspace`.
- Connect is allowed if a Cursor jsonl exists **or** the process registry still has that id.
- Producer A: child's stdout, line-delimited JSON. Registry keeps events with `type` in `user` | `assistant` | `thinking` | `tool_call`. `system`/`result` are not live-buffered. Tool calls are also appended to a Host sidecar jsonl (`src/lib/tool-call-events.ts`).
- Producer B: Cursor agent-transcripts jsonl under `~/.cursor/projects/<workspace-key>/agent-transcripts/` ([`src/lib/transcript-reader.ts`](../../src/lib/transcript-reader.ts)). File watcher + 800ms poll until the file appears (`FILE_POLL_MS`).
- Watch pushes `{ event: "connected"|"update", data: { messages, toolCalls, modifiedAt, isActive } }` after merging file + live (`mergeMessageLists` / `overlayToolCallResults`).
- `isActive` is `process-registry.isActive(sessionId)`: a child is registered.
- On child close: wait 300ms (`PROCESS_EXIT_SETTLE_MS`), re-read jsonl, push `isActive: false`. Live buffer TTL is 120s after exit (`LIVE_EVENT_TTL_MS`).
- Client: [`src/hooks/use-session-watch.ts`](../../src/hooks/use-session-watch.ts) opens that WebSocket; [`use-chat.ts`](../../src/hooks/use-chat.ts) treats `isActive: false` as stream end (then drains the message queue).

Cursor print live events are NDJSON with `type`/`subtype`/`session_id`. Partial tokens need `--stream-partial-output`; without it, stream-json emits one assistant line per complete segment. Thinking is suppressed in print ([output format](https://cursor.com/docs/cli/reference/output-format)). Host always passes `--stream-partial-output` and still has a thinking branch in `parseLiveEvents` that print will not hit.

ACP live is `session/update` on the same stdio JSON-RPC pipe ([transports](https://agentclientprotocol.com/protocol/v1/transports): stdout MUST be ACP messages only). Cursor's example handles `update.sessionUpdate === "agent_message_chunk"`. ACP v1 `SessionUpdate` variants include `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, plus plan/commands/mode/usage ([schema](https://agentclientprotocol.com/protocol/v1/schema), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)). Installed Agent sends those chunk types and `tool_call` / `tool_call_update`.

`session/update` is a notification (no response). It is not a file, not a process table, and not keyed for N Host watch sockets unless the Host fans it out.

## Cancel

Host cancel: Client `stopStreaming` → `DELETE /api/sessions/active` with `{ sessionId }` → `killProcess` → `child.kill("SIGTERM")` ([`src/app/api/sessions/active/route.ts`](../../src/app/api/sessions/active/route.ts), [`process-registry.ts`](../../src/lib/process-registry.ts)). `GET /api/sessions/active` lists registry ids. There is no Agent stdin cancel message in print mode.

ACP: `session/cancel` is a notification `{ sessionId }`. The Agent SHOULD abort model + tools, MAY still emit `session/update`, and MUST then answer the open `session/prompt` with `stopReason: "cancelled"` ([prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn), [schema session/cancel](https://agentclientprotocol.com/protocol/v1/schema)). `$/cancel_request` is a different, optional JSON-RPC request cancel ([cancellation](https://agentclientprotocol.com/protocol/v1/cancellation)).

Installed Agent `cancel(e)` looks up the in-memory session and calls `pendingPromptCancel`. `handlePrompt` returns `{ stopReason: "cancelled" }` if that abort fired, else `{ stopReason: "end_turn" }`. No SIGTERM. The ACP process and Session remain; a later `session/prompt` is allowed.

`session/close` (cancel + free the Session) is optional and **not** advertised by this Agent. Host SIGTERM is closer to "kill the print child" than to `session/close`.

## History

Host history is disk + Host DB, not an Agent RPC.

- Conversation body: `GET /api/sessions/history?id=` reads the agent-transcripts jsonl for that Workspace + Session, folds user/assistant text, extracts `tool_use` blocks, overlays the Host tool-call sidecar ([`history/route.ts`](../../src/app/api/sessions/history/route.ts), [`transcript-reader.ts`](../../src/lib/transcript-reader.ts)).
- Session list: `GET /api/sessions` merges Host `sessions.db` with jsonl files that have a first user message ([`sessions/route.ts`](../../src/app/api/sessions/route.ts)).
- Host DB `upsertSession` runs when print init arrives, so a Session can appear in the Host list before jsonl exists.

ACP history for a connecting client is `session/load` replay (`session/update` for every turn), then the Client continues with `session/prompt` ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup)). Installed Agent implements that via `getFullConversation`. This Agent also implements `session/list` (`unstable_listSessions`) but rejects pagination cursors.

Whether an ACP turn appends the same agent-transcripts jsonl Host tails was not proven from the ACP command chunk (it does not mention `agent-transcripts`). `loadSession` does load an on-disk Agent store by `resumeChatId`. Treat "ACP writes the jsonl Host already parses" as unproven.

Client history load does not call `session/load`. It reads Host HTTP, then watches. ACP `session/load` would replace that only if the Host kept an ACP connection and forwarded the replay.

## What Agent mode would lose

If **live** updates came from `session/update` instead of print-mode jsonl stdout + the process registry (history/start/cancel left aside except where they are the live producer):

1. **Process-liveness as `isActive`.** Today a watch socket's `isActive` is "this Session's print child is still in the registry." `session/update` has no v1 "running/idle process" event. Turn completion is the `session/prompt` **response** (`stopReason`), which is not a `session/update`. The Client's stream-end hook that waits for `isActive: false` would have nothing equivalent unless the Host synthesized it from the prompt RPC.

2. **SIGTERM as both cancel and live-producer death.** Killing the child stops stdout, fires `onProcessExit`, and after 300ms the Host re-reads jsonl for a final snapshot. `session/cancel` asks the Agent to abort; the process stays; further `session/update` MAY still arrive until `stopReason: cancelled`. A Host that only listens to `session/update` never sees a process-exit settle.

3. **Disk jsonl as a second live source during the turn.** Watch merges file + memory, polls until jsonl appears, and file-watches after. `session/update` is ephemeral on one stdio pipe. Mid-turn file merge, "jsonl appeared" polling, and post-exit disk reread all go away unless the Host still tails jsonl (that would not be "live from `session/update`").

4. **Late join via the live buffer.** Registry concatenates stdout events per Session and keeps them 120s after process exit. A second Client (or a reconnect) can open `/api/sessions/watch` and get `connected` with buffered live + file. `session/update` is push-forward on the ACP connection. Missed chunks are gone unless the Host rebuilds a buffer or calls `session/load` (replay is a load RPC, not live).

5. **Per-prompt producer isolation.** Each `POST /api/chat` has its own stdout. Registry keys that child. Installed ACP keeps `this.sessions` on **one** `agent acp` process; `session/update` is multiplexed by `sessionId` on one stdout. A crash, parse error, or kill of that process ends live for every Session on it. Print-mode kill of one child does not.

6. **The stream-json parser and sidecar.** `parseLiveEvents` understands print `type`/`subtype`, `call_id`, `readToolCall`/`writeToolCall`/…, and `timestamp_ms`/`model_call_id` partials. `session/update` uses `sessionUpdate` + `toolCallId` + `kind`/`status`. That parser and `appendToolCallEvent` (stdout `tool_call` → Host sidecar used when overlaying jsonl `tool_use` rows that have no call ids) would not run.

7. **Print `result` metadata on the live pipe.** stream-json ends with `{ type: "result", duration_ms, session_id, result, ... }`. Registry does not buffer `result`, but it is on stdout. ACP's analogue is `session/prompt`'s `{ stopReason }`, not a `session/update`. Duration / aggregated `result` text / `request_id` are not in the update stream.

8. **Unattended tools as currently wired.** Print `-p` has full write/shell access ([using](https://cursor.com/docs/cli/using)); Host adds `--trust` and often `--force`. ACP sends `session/request_permission` (and Cursor extensions that **block** until the client replies). [Cursor ACP](https://cursor.com/docs/cli/acp): if the client does not answer, tool execution can block. Live-from-`session/update` implies the Host must also handle those requests or the turn stalls. That is extra surface print+force does not put on stdout.

Not a loss vs print live:

- **Thoughts.** Print suppresses `thinking` ([output format](https://cursor.com/docs/cli/reference/output-format)). ACP sends `agent_thought_chunk` (installed Agent replay and live both do). Switching live to `session/update` can show thoughts print never did.
- **Token granularity.** Host already asks for character-level print deltas. ACP chunks `agent_message_chunk` similarly; Cursor's minimal client prints `update.content.text` as it arrives. Not proven equal, not a documented loss.
- **Fan-out to many browser Clients** can still exist if the Host receives `session/update` and rebroadcasts on `/api/sessions/watch`. What disappears is the current **producers** (stdout NDJSON + jsonl + registry), not the WebSocket itself.

Team-level MCP is unsupported in ACP mode ([Cursor ACP](https://cursor.com/docs/cli/acp)). That is a spawn-mode gap (`agent acp` vs `agent -p`), not a property of `session/update` vs jsonl.

## Installed Agent ACP facts (this machine)

From `agent --help` / `agent acp --help` / `agent --version` `2026.09.10-fd3934a`, and the bundled ACP handler:

- `acp` is hidden from default help (matches [parameters](https://cursor.com/docs/cli/reference/parameters)). Help text: start as an ACP server. No extra flags on `agent acp` itself; Cursor docs pass root flags like `--api-key` before `acp`.
- Initialize advertises `loadSession: true` and `sessionCapabilities.list` only. `session/resume` and `session/close` are not advertised; ACP v1 says Clients MUST NOT call them without those capabilities.
- `session/new` mints a UUID. `session/load` sets `resumeChatId` to the given id and replays from the Agent store. `session/prompt` / `session/cancel` require that id to be in this process's session map (`Session ${id} not found` otherwise). So a Host that spawns print-mode and a **different** Host that only `session/load`s after the print process has exited still works (load from store). A Host that `session/prompt`s without `session/new` or `session/load` in **this** ACP process does not.
- Auth method id `cursor_login`; unauthenticated `session/new`/`load`/`list` throw `authRequired` telling the operator to run `agent login`.
- `session/list` pagination cursors: invalidParams, "not currently supported by the CLI agent."
- Cursor extensions present in the binary: `cursor/ask_question`, `cursor/create_plan`, `cursor/update_todos`, `cursor/task`, `cursor/generate_image`, plus `cursor/list_available_models` (the last is not in the public ACP doc table).

## Out of scope

- ACP-only vs print fallback (not decided).
- Agent Window Continuity (not researched).
- Whether ACP turns write the same agent-transcripts jsonl Host history reads (unproven).
- Implementing a Host ACP client.
- ACP v2 draft (`session/load` removed; prompt completion via `state_update`).
)
