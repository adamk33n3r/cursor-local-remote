# What Client answers can stall an ACP Session?

Ticket: [#39](https://github.com/adamk33n3r/cursor-local-remote/issues/39) (parent [#34](https://github.com/adamk33n3r/cursor-local-remote/issues/34)).

**Gist:** An ACP Session stalls on unanswered JSON-RPC *requests* from Agent to the ACP Client (`session/request_permission`, and Cursor `cursor/ask_question` / `cursor/create_plan` if the Host actually implements them). Fire-and-forget Cursor methods do not stall. `--force` can skip many permission prompts; Host `--trust` is a different flag and is always passed today.

This note records facts. It does not design Client prompt UI, pick which methods to honor, or implement anything.

Language follows `CONTEXT.md`: **Client** is the browser; **Host** is this product's process; **Agent** is Cursor's CLI; **Session** is one agent conversation. ACP's protocol role named "Client" is the process on stdio with `agent acp`. Today that would be the Host if it spawned ACP. Host `--force` is not Token or Login.

## Sources

| Source | Role |
| --- | --- |
| [Cursor CLI ACP](https://cursor.com/docs/cli/acp) | Permissions, Cursor extension methods, minimal auto-allow client |
| [ACP v1 tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn), [overview](https://agentclientprotocol.com/protocol/v1/overview), [initialization](https://agentclientprotocol.com/protocol/v1/initialization), [fs](https://agentclientprotocol.com/protocol/v1/file-system), [terminals](https://agentclientprotocol.com/protocol/v1/terminals), [elicitation](https://agentclientprotocol.com/protocol/v1/elicitation), [extensibility](https://agentclientprotocol.com/protocol/v1/extensibility), [cancellation](https://agentclientprotocol.com/protocol/v1/cancellation), [schema](https://agentclientprotocol.com/protocol/v1/schema) | Protocol-owned request vs notification, permission outcome, other blocking Client methods |
| [CLI parameters](https://cursor.com/docs/cli/reference/parameters), [configuration](https://cursor.com/docs/cli/reference/configuration), [permissions](https://cursor.com/docs/cli/reference/permissions), [changelog](https://cursor.com/docs/cli/changelog), [run modes](https://cursor.com/docs/agent/security/run-modes) | `--force` / `--trust` / `approvalMode` / allowlist tokens |
| This repo: `src/lib/agent-argv.ts`, `src/lib/cursor-cli.ts`, `src/components/settings-panel.tsx`, `README.md`, `test/agent-spawn.test.ts` | Host always passes `--trust`; `--force` is the settings toggle |
| Installed Agent `2026.09.10-fd3934a` (`agent --help`, `agent acp --help`, stdio `initialize` / `session/new` probe, bundled ACP handlers) | What this Windows Agent actually sends |

## Today's Host is not an ACP Client

The Host currently spawns print-mode Agent (`-p`, `--output-format stream-json`, `--stream-partial-output`, always `--trust`, optional `--force`). It does not spawn `agent acp`.

- `src/lib/agent-argv.ts`
- `src/lib/cursor-cli.ts`
- `README.md` ("How it works")
- `test/agent-spawn.test.ts`

The rest of this note is about a Session on ACP stdio. If the Host later speaks ACP, unanswered Agent requests stall that Session until the Host (and any browser Client it waits on) answers.

## What stalls

ACP is JSON-RPC 2.0. **Requests** (envelope has `id`) wait for a result or error. **Notifications** (no `id`) do not. ([ACP overview](https://agentclientprotocol.com/protocol/v1/overview.md))

Cursor's ACP flow lists `session/request_permission` as a step the integration must handle. Quote: "If your client does not answer permission requests, tool execution can block." ([Cursor ACP](https://cursor.com/docs/cli/acp))

The prompt turn does not finish until Agent returns `session/prompt` with a `stopReason`. Permission sits inside that turn, before the tool moves `pending` → `in_progress`. ([ACP prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn.md))

Neither Cursor ACP docs nor the ACP spec document a timeout if the ACP Client never replies. The JSON-RPC request stays open; `session/prompt` stays open.

To cancel: send `session/cancel`, and **must** respond to every pending `session/request_permission` with `{ "outcome": { "outcome": "cancelled" } }`. ([ACP tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls.md), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn.md), [schema `RequestPermissionOutcome`](https://agentclientprotocol.com/protocol/v1/schema.md))

## `session/request_permission`

### Protocol shape

Agent → ACP Client request. Params: `sessionId`, `toolCall` (a tool-call update), `options[]`. Each option has `optionId`, `name`, `kind`.

ACP **kinds** (UI hints): `allow_once`, `allow_always`, `reject_once`, `reject_always`. ([ACP tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls.md))

Reply:

```json
{ "outcome": { "outcome": "selected", "optionId": "<id from options>" } }
```

or `{ "outcome": { "outcome": "cancelled" } }`.

ACP Clients may auto-allow or auto-reject from settings. ([ACP tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls.md))

### What Cursor tells integrators

Clients should return one of `allow-once`, `allow-always`, `reject-once`. Cursor does not document `reject-always` as a Cursor option id. ([Cursor ACP](https://cursor.com/docs/cli/acp))

The published minimal client auto-answers `allow-once` and advertises `fs.readTextFile: false`, `fs.writeTextFile: false`, `terminal: false` so Agent must not call those Client methods. ([Cursor ACP](https://cursor.com/docs/cli/acp) minimal Node.js client)

### What this Agent build actually sends

From Agent `2026.09.10-fd3934a` ACP handlers (bundled `8412.index.js`):

Default option list for tool approval (and for web fetch/search):

| `optionId` | `name` | `kind` |
| --- | --- | --- |
| `allow-once` | Allow once | `allow_once` |
| `allow-always` | Allow always | `allow_always` |
| `reject-once` | Reject | `reject_once` |

`allow-once` and `allow-always` both execute. `allow-always` also persists an allowlist token. Anything else, including `cancelled` or unknown, is treated as not approved.

`reject-always` exists in the ACP spec as a *kind*. This Cursor ACP builder does not put a `reject-always` option on these prompts.

### Tool kinds Cursor puts on `toolCall`

| Agent operation | ACP `toolCall.kind` | Title / content | `allow-always` persist |
| --- | --- | --- | --- |
| Shell | `execute` | `` `command` ``; optional reason text | `Shell(<command>)` (or each `notAllowedCommands` entry) |
| Write / edit | `edit` | `Write path` or `Edit \`path\`` plus a `diff` | `Write(<path>)` |
| Delete | `edit` | `Delete \`path\`` | `Write(<path>)` |
| MCP tool | `other` | `name: toolName` plus JSON args | `Mcp(<provider>:<tool>)` |
| Web fetch | `fetch` | fetch title; toolCallId `web_fetch_<id>` | `WebFetch(<domain>)` |
| Web search | `search` | search title; toolCallId `web_search_<id>` | `WebSearch(<term>)` |
| Generic / other | `other` | caller title; `allow-always` only if a label is supplied | caller callback |

These map onto the CLI permission tokens documented as `Shell(...)`, `Write(...)`, `WebFetch(...)`, `Mcp(server:tool)`. ([CLI permissions](https://cursor.com/docs/cli/reference/permissions)) There is no separate `Delete(...)` token in that doc; this Agent persist path uses `Write(path)` for deletes.

Web search is its own approval. `autoAcceptWebSearch` in `cli-config.json` is documented as honored in ACP runs as well as interactive/headless. ([CLI changelog, 13 Jul 2026](https://cursor.com/docs/cli/changelog))

Ask-question *fallback* (when `cursor/ask_question` is unimplemented) reuses `session/request_permission` with different option ids: each multiple-choice id as `allow_once`, plus `optionId: "__ask_question_skip__"` / name `Skip` / kind `reject_once`. That is not the three-id allow/reject set.

### What does *not* go through `session/request_permission`

ACP `session/update` tool-call notifications (`tool_call`, `tool_call_update`) are notifications. Ignoring them does not stall. ([ACP tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls.md))

If the Host advertises no `fs`, no `terminal`, and no `elicitation`, Agent must not call `fs/*`, `terminal/*`, or `elicitation/create`. ([ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization.md), [fs](https://agentclientprotocol.com/protocol/v1/file-system.md), [terminals](https://agentclientprotocol.com/protocol/v1/terminals.md), [elicitation](https://agentclientprotocol.com/protocol/v1/elicitation.md)) Cursor's minimal client advertises those off.

If the Host *does* advertise them, those methods are also blocking JSON-RPC requests. Unanswered `fs/read_text_file`, `fs/write_text_file`, `terminal/create` (and the other `terminal/*` calls), or `elicitation/create` stall the same way. Out of scope to choose whether the Host advertises them.

## `cli-config.json`, `--force`, Host `trust`

Two different Agent flags. Host names collide with Agent `--trust`.

| Knob | Owner | Meaning |
| --- | --- | --- |
| Agent `--trust` | CLI | Trust the workspace without prompting. Docs still say "headless mode only"; `agent --help` on this build does not. Changelog (20 Jul 2026) says it also skips the trust dialog in interactive sessions. Untrusted headless workspaces fail unless `--trust` or `--force` is passed. ([parameters](https://cursor.com/docs/cli/reference/parameters), [changelog](https://cursor.com/docs/cli/changelog)) |
| Agent `-f` / `--force` / `--yolo` | CLI | "Force allow commands unless explicitly denied." Help on this build: alias for Run Everything. Deny still applies. ([parameters](https://cursor.com/docs/cli/reference/parameters), this `agent --help`) |
| `cli-config.json` `approvalMode` | CLI | `allowlist` \| `auto-review` \| `unrestricted`. `unrestricted` is Run Everything. ([configuration](https://cursor.com/docs/cli/reference/configuration), [run modes](https://cursor.com/docs/agent/security/run-modes)) |
| `permissions.allow` / `permissions.deny` | CLI | Tokens `Shell`, `Read`, `Write`, `WebFetch`, `Mcp`. Deny wins. Without a `WebFetch` allow entry, each fetch prompts. ([permissions](https://cursor.com/docs/cli/reference/permissions)) |
| `--auto-review` | CLI | Auto-review: allowlisted calls run; sandboxable shell may run sandboxed; else a classifier. Applies to shell, MCP, and Fetch. ([changelog 22 Jun 2026](https://cursor.com/docs/cli/changelog), [run modes](https://cursor.com/docs/agent/security/run-modes)) |
| `--approve-mcps` | CLI | Automatically approve all MCP servers. ([parameters](https://cursor.com/docs/cli/reference/parameters)) |
| Host settings key `trust` / UI "Run Everything" | This repo | Passes Agent `--force`. Default off. Copy: "Pass --force so Agent runs commands that are not on the allow list. Deny rules still apply." (`settings-panel.tsx`) |
| Host `--force` / `CURSOR_FORCE=1` | This repo | Same: pass Agent `--force` for this Host process. `--no-force` (alias `--no-trust`) leaves the settings toggle in charge. `CURSOR_FORCE=0` disables. (`README.md`, `cursor-cli.ts`) |
| Host always `--trust` | This repo | `buildAgentArgv` always includes Agent `--trust`, even when `--force` is off. (`agent-argv.ts`, `test/agent-spawn.test.ts`) |

Host `--force` is not workspace trust, not Token, not Login. Agent `--trust` is workspace trust. The Host settings key is named `trust` but it means Agent `--force`.

`agent acp` itself has no `--force` / `--trust` on the subcommand (`agent acp --help` is only `-h`). Those are global options: `agent --force --trust acp` is accepted on this build (`agent --force --trust acp --help` prints the same ACP usage and exits 0).

ACP session setup in this Agent build: if `force` is set and team Run Everything is not disabled, it uses an auto-approve decision handler instead of the ACP `requestPermission` helper. If `force` is set but team controls block Run Everything, it still prompts and overlays `approvalMode: "allowlist"`. So `--force` does not guarantee zero `session/request_permission` under team policy.

`--force` does not remove deny rules. ([parameters](https://cursor.com/docs/cli/reference/parameters), Host settings copy)

Allowlisted / unrestricted / auto-review-approved calls never reach the ACP Client. The Client only sees the remainder.

Windows `cli-config.json` path is `$env:USERPROFILE\.cursor\cli-config.json`. ([configuration](https://cursor.com/docs/cli/reference/configuration)) Probe of the file on this machine (keys only; no secrets): schema `version` 1, `approvalMode` is a documented enum (this install: `auto-review`), `autoAcceptWebSearch` is boolean (this install: `false`), `permissions.allow` / `permissions.deny` present.

## Cursor extension methods

[Cursor ACP](https://cursor.com/docs/cli/acp) splits them:

**Blocking** (Agent waits for a JSON-RPC response):

| Method | Client must return | If never answered |
| --- | --- | --- |
| `cursor/ask_question` | `answered` / `skipped` / `cancelled` | Turn waits |
| `cursor/create_plan` | `accepted` / `rejected` / `cancelled` | Turn waits |

**Notification / fire-and-forget** (Client need not respond):

| Method | Use |
| --- | --- |
| `cursor/update_todos` | Todo list merge/replace |
| `cursor/task` | Subagent task |
| `cursor/generate_image` | Generated image |

Cursor's "Building an integration" list: spawn `agent acp`, JSON-RPC on stdio, handle `session/update`, respond to `session/request_permission`, **optionally** implement Cursor extension methods.

ACP extensibility reserves `_`-prefixed method names. Cursor uses `cursor/...` anyway; Cursor's own docs are the owner for those names. ([ACP extensibility](https://agentclientprotocol.com/protocol/v1/extensibility.md), [Cursor ACP](https://cursor.com/docs/cli/acp))

### What this Agent build does if the Host does not implement them

`cursor/ask_question`: Agent awaits `extMethod`. On unimplemented (`-32601` / "method not found" / "method not supported"), it falls back to one `session/request_permission` per single-choice question. If that fallback also fails, it rejects with "Client does not support ask_question extension". So a Host that returns method-not-found does not stall, but it *will* stall if it neither implements the method nor answers the fallback permission prompts.

`cursor/create_plan`: Agent awaits `extMethod`. On unimplemented, it tries a local plan artifact and **succeeds** the tool if that fallback produces a URI (or if unimplemented was detected). It errors only if the extension failed *and* the local artifact could not be created. Unimplemented therefore does not stall.

Fire-and-forget methods: this build sends them with `extMethod` (a request) then `.catch` without awaiting. Cursor docs call them notifications. Either way, the prompt turn does not wait. An unanswered one should not stall. This note does not decide whether a Host should reply.

This build also names `cursor/list_available_models`. That is a **Client → Agent** method Agent implements (`listAvailableModels`); it is not an Agent→Host prompt that stalls a Session. Not in the Cursor ACP method table.

ACP subagent path in this build rejects `switchMode` ("Switch mode requires approval") and ask-question ("Interactive questions are not supported in ACP subagent mode") rather than prompting the Host.

## Minimum so a Session does not stall

From Cursor's own minimal client plus this Agent build:

1. Speak ACP: `initialize` → `authenticate` (`cursor_login`) → `session/new` or `session/load` → `session/prompt`. ([Cursor ACP](https://cursor.com/docs/cli/acp))
2. Consume `session/update` notifications (no reply).
3. **Always be able to complete `session/request_permission`** for every option set Agent sends (the three ids above, and the ask-question fallback ids if that path runs). Auto-allow is enough to not stall; that is what Cursor publishes.
4. Do not advertise `fs`, `terminal`, or `elicitation` unless the Host will answer those requests.
5. **Need not implement** `cursor/update_todos`, `cursor/task`, `cursor/generate_image` to avoid stall.
6. **Need not implement** `cursor/ask_question` or `cursor/create_plan` to avoid stall, *if* the Host returns JSON-RPC method-not-found (this Agent then falls back). If the Host *does* implement them as requests, it must answer or the Session stalls.

`--force` / `approvalMode: unrestricted` / matching allowlist entries reduce how often (3) happens. They do not replace a permission responder for the calls that still prompt (deny, team policy, fetch/search when not auto-accepted, tools not covered by allowlist).

This is the stall floor, not a product choice of which methods to honor or how to show them in the Client.

## Windows probe (`agent` 2026.09.10-fd3934a)

- `agent acp --help`: "Start the Cursor Agent as an ACP (Agent Client Protocol) server"; only `-h`.
- `agent --help`: `-f, --force` "Force allow commands unless explicitly denied"; `--yolo` "Alias for --force (Run Everything)"; `--trust` "Trust the current workspace without prompting"; `--auto-review`; `--approve-mcps`.
- Stdio probe (ACP Client advertised `fs` off, `terminal` false, name `acp-probe`):
  - `initialize` → `protocolVersion: 1`
  - `agentCapabilities`: `loadSession: true`; MCP `http` + `sse`; prompt `image: true`, `audio: false`, `embeddedContext: false`; `sessionCapabilities.list: {}`
  - `authMethods`: `cursor_login` ("Authenticate using existing Cursor login credentials…")
  - `authenticate` with `cursor_login` succeeded (empty result)
  - `session/new` succeeded with modes `agent` / `plan` / `ask` (current `agent`), plus `models` and `configOptions` for mode and model
- No Agent→Host methods arrived during handshake (no permission, no `cursor/*`). A tool-permission capture was not run (would spend a model turn and depends on allowlist / `--force` / `approvalMode` on the machine).

## Not decided here

- Client permission UI
- Which methods the Host honors vs auto-answers vs method-not-found
- Whether v1 Host should switch from print/stream-json to `agent acp`
- Whether the Host should pass `--force` / `--approve-mcps` / `--auto-review` on an ACP spawn the same way it passes `--trust` today
