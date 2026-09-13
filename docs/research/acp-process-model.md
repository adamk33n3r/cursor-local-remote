# What ACP process model can the Host use?

Research for [#37](https://github.com/adamk33n3r/cursor-local-remote/issues/37). Facts only. This note does not pick how the Host should spawn, keep, or kill Agent processes.

**Answer:** ACP's stdio transport is one Agent subprocess per connection. That connection is allowed to hold many Sessions (`session/new` repeatedly). Cursor CLI's `agent acp` implements that: one process, an in-memory Session map, disk under `acp-sessions/` for `session/load`. `session/cancel` stops a prompt turn; it does not exit the process. Closing stdio or killing the process ends the connection. The protocol does not keep a live Session across a dead stdio pipe. A later process is a new connection (`initialize` again). Restoring a conversation is `session/load` if `loadSession` is advertised and the Agent still has that Session on disk. ACP does not define Client reconnect through the Relay Tunnel. That hop is Host HTTP/WebSocket, not Agent stdio.

## Question

Can one long-lived `agent acp` process host many Sessions, or is it one process per Session? What happens on crash, `session/cancel`, process exit, and Client reconnect through the Relay Tunnel? Does the protocol keep a Session across stdio reconnect, or is that a new process and a `session/load`?

## Sources

| Source | Role |
| --- | --- |
| [Cursor CLI ACP](https://cursor.com/docs/cli/acp) | First-party Cursor docs for `agent acp` |
| [ACP architecture](https://agentclientprotocol.com/get-started/architecture.md) | Connection vs Session |
| [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview.md) | Methods and flow |
| [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization.md) | Once per connection |
| [ACP v1 session setup](https://agentclientprotocol.com/protocol/v1/session-setup.md) | `session/new`, `session/load`, `session/resume`, `session/close` |
| [ACP v1 session list](https://agentclientprotocol.com/protocol/v1/session-list.md) | Discovery vs restore |
| [ACP v1 prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn.md) | `session/cancel` |
| [ACP v1 cancellation](https://agentclientprotocol.com/protocol/v1/cancellation.md) | Cancel vs process |
| [ACP v1 transports](https://agentclientprotocol.com/protocol/v1/transports.md) | stdio subprocess |
| [ACP v1 schema](https://agentclientprotocol.com/protocol/v1/schema.md) | Method availability |
| [Session Close announcement](https://agentclientprotocol.com/announcements/session-close-stabilized.md) / [RFD](https://agentclientprotocol.com/rfds/session-close.md) | Why close exists |
| Installed Agent CLI `2026.09.10-fd3934a` (Windows) | `--help`, `initialize` probe, bundled `src/acp/*` |

ACP v2 exists as draft. Cursor CLI answered `protocolVersion: 1`. v2 is not what this Agent speaks.

## Glossary (this repo)

**Host**, **Session**, **Agent**, **Tunnel**, **Client** as in `CONTEXT.md`. ACP's "Client" is the Host when the Host spawns `agent acp`. The browser Client is a different hop.

## Connection vs Session

ACP architecture: the editor boots the agent subprocess on demand; all communication is stdin/stdout; **each connection can support several concurrent Sessions**. ([architecture](https://agentclientprotocol.com/get-started/architecture.md))

A Session is one conversation with its own id, history, and state. Several independent Sessions can share the same Agent process. ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup.md))

`initialize` happens once per connection, before any Session. ([initialization](https://agentclientprotocol.com/protocol/v1/initialization.md), [overview](https://agentclientprotocol.com/protocol/v1/overview.md))

Baseline Agent methods: `session/new`, `session/prompt`, `session/cancel`, `session/update`. `session/load` is optional (`loadSession`). ([initialization](https://agentclientprotocol.com/protocol/v1/initialization.md), [schema](https://agentclientprotocol.com/protocol/v1/schema.md))

**Host implication (not a choice):** spawning one `agent acp` and calling `session/new` many times is protocol-legal. Spawning one `agent acp` per Session is also protocol-legal (each spawn is its own connection). Cursor's CLI is built as the first of those.

## Cursor `agent acp`

Cursor docs: run `agent acp`; custom client over stdio JSON-RPC. Transport is stdio, JSON-RPC 2.0, newline-delimited JSON. Client writes stdin; CLI writes stdout; logs may go to stderr. Flow: `initialize` → `authenticate` (`cursor_login`) → `session/new` **or** `session/load` → `session/prompt` → `session/update` / `session/request_permission` → optional `session/cancel`. ([Cursor ACP](https://cursor.com/docs/cli/acp))

Integrations: spawn `agent acp` as a child process. The Node example is one spawn, one `session/new`, then `stdin.end()` and `kill()`. That is a minimal client, not a one-Session limit. ([Cursor ACP](https://cursor.com/docs/cli/acp))

Installed CLI `2026.09.10-fd3934a`: `agent acp --help` is "Start the Cursor Agent as an ACP (Agent Client Protocol) server". No flags for one-Session-per-process.

Windows note: `agent` is `agent.ps1` / `agent.cmd`, which execs the versioned `node.exe` + `index.js`. Node `spawn("agent")` is `ENOENT`; the probe used that bundled `node.exe index.js acp`.

### What the process actually holds

Bundled `src/acp/run.ts`: one JSON-RPC connection over `process.stdin` / `process.stdout`; one Agent instance.

Bundled `src/acp/cursor-acp-agent.ts`: `this.sessions = new Map`. `newSession` assigns `crypto.randomUUID()`, builds an `AgentSession`, `sessions.set`. `loadSession` uses the given id as `resumeChatId`, then the same map. `prompt` / `cancel` look up by `sessionId`. No `closeSession`. No `sessions.delete`.

Live `initialize` (this CLI):

```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "mcpCapabilities": { "http": true, "sse": true },
    "promptCapabilities": { "audio": false, "embeddedContext": false, "image": true },
    "sessionCapabilities": { "list": {} }
  },
  "authMethods": [{ "id": "cursor_login" }]
}
```

No `sessionCapabilities.close`. No `sessionCapabilities.resume`.

Live probe, one process, already logged in via `cursor_login`: two `session/new` calls returned two different UUID `sessionId`s. `session/list` (cwd-filtered) returned both. Process still running.

### Disk, not the stdio pipe

`src/acp/acp-storage.ts`: Session files live at `{cursor-config-dir}/acp-sessions/{sessionId}/` with `meta.json` and `store.db`. `session/list` reads those directories (plus the in-memory map). `loadSession` throws Session not found if `store.db` is missing (`src/acp/agent-store.ts`).

`loadSession` is how ACP resumes after restarts or a different Client instance. It replays history as `session/update`, then the Client continues. ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup.md)) Cursor docs: create with `session/new`, resume with `session/load`. ([Cursor ACP](https://cursor.com/docs/cli/acp))

This CLI implements `loadSession` and history replay (`replayConversationHistory`). It does not implement `session/resume` (probe: JSON-RPC `-32601` method not found).

Probe limit: `session/new` then kill then `session/load` on a new process returned `-32602` "Session … not found". That Session never got a `session/prompt`. Matches the `store.db` existence check. Load after a real prompt turn was not probed.

## stdio reconnect is a new process

stdio transport: the Client launches the Agent as a subprocess; newline-delimited JSON-RPC on stdin/stdout; Client closes stdin and terminates the subprocess. There is no attach-to-existing-stdio API. Streamable HTTP is a draft. ([transports](https://agentclientprotocol.com/protocol/v1/transports.md)) Cursor documents only stdio. ([Cursor ACP](https://cursor.com/docs/cli/acp))

If the pipe dies, the connection dies. The next `agent acp` is a new subprocess, new `initialize`, empty in-memory map. Session identity is the `sessionId` plus `session/load`, not the OS pid.

Probe: `stdin.end()` after handshake → Agent exit code `0`. Kill → new pid on the next spawn.

## `session/cancel` is a turn, not a process

`session/cancel` is a notification with `sessionId`. The Agent should abort that Session's current prompt and answer `session/prompt` with `stopReason: "cancelled"`. The Client may send another `session/prompt` on the same Session. ([prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn.md))

The protocol also defines a `$/cancel_request` notification for JSON-RPC request cancel. `session/cancel` is the Session-level form. Internal cancel examples include "user closes IDE"; that is still a request/turn cancel, not a required process exit. ([cancellation](https://agentclientprotocol.com/protocol/v1/cancellation.md))

Cursor CLI `cancel`: call that Session's `pendingPromptCancel`. No `process.exit`. Probe: `session/cancel` on one of two Sessions; process still alive.

## `session/close` vs killing the process

Stabilized `session/close` (when advertised): cancel work for that Session and free its resources **without terminating the whole ACP process**. ([close announcement](https://agentclientprotocol.com/announcements/session-close-stabilized.md), [session setup](https://agentclientprotocol.com/protocol/v1/session-setup.md))

The close RFD: today a Session stays active until the ACP process exits; if the Agent uses subprocesses per Session, that leaks; the only cleanup without close is kill the whole process, which drops every Session. ([close RFD](https://agentclientprotocol.com/rfds/session-close.md))

This Cursor CLI does not advertise close. Probe: `session/close` → `-32601` method not found. Ending a Session on this Agent means drop it from the Host's bookkeeping and/or exit the process. `session/delete` is list-history removal, optional, not advertised here. ([session delete](https://agentclientprotocol.com/protocol/v1/session-delete.md))

## Crash and process exit

ACP has no crash-recovery handshake. stdio EOF is the signal the subprocess is gone. ([transports](https://agentclientprotocol.com/protocol/v1/transports.md))

Cursor CLI: in-memory `sessions` Map dies with the process. Disk `acp-sessions/` is the load path. `run.ts` installs an empty `unhandledRejection` handler (process may survive some async failures). Crash mid-prompt: that turn is gone with the process; restore is a new process + `session/load` if `store.db` exists.

## Tunnel / Client reconnect

Neither [Cursor ACP](https://cursor.com/docs/cli/acp) nor the ACP spec mention a Relay Tunnel.

In this product the Tunnel is the Host's outbound connection to the Relay; after Login the Relay reverse-proxies that Host's HTTP and WebSocket. Direct LAN Clients do not use it. (`CONTEXT.md`)

ACP stdio is Host ↔ Agent. The Tunnel is Client ↔ Relay ↔ Host. Client reconnect on the Tunnel is not stdio reconnect and not `session/load` by itself.

If the Host keeps the same `agent acp` process while the Client drops and returns, in-memory Sessions on that process are still there (`session/prompt` with the same `sessionId`). If the Host exits or respawns Agent, that is a new stdio connection: `initialize` again, then `session/load` to restore. **This note does not pick which the Host does.**

## Not ACP

`agent persist` is a separate CLI: "sessions that survive terminal and SSH disconnects" (`persist` / `attach` / `stop`). It is not the ACP stdio process model.

ACP v2 drops `session/load` in favor of `session/resume` with replay. Cursor CLI here is v1.

## Probe (Windows, CLI `2026.09.10-fd3934a`)

| Check | Result |
| --- | --- |
| `initialize` | v1; `loadSession: true`; `sessionCapabilities.list: {}`; no close/resume |
| Two `session/new` on one process | Two UUID ids; both in `session/list` |
| `session/cancel` | Process stayed up |
| `session/close` / `session/resume` | `-32601` method not found |
| `stdin.end()` | Exit code 0 |
| New process + `session/load` of a no-prompt Session | `-32602` Session not found |

## Settled / not settled

**Settled**

- One `agent acp` connection may host many Sessions. Cursor CLI does.
- One process per Session is also stdio-legal; the spec does not require it.
- `session/cancel` cancels a turn, not the process.
- Dead stdio = dead connection. Next spawn is `initialize` + optional `session/load`.
- This Agent advertises `session/load` and `session/list`, not `session/close` or `session/resume`.
- Tunnel reconnect is not an ACP Session primitive.

**Not settled (needs Host design, not this ticket)**

- Whether the Host uses one Agent process or one per Session.
- Whether the Host keeps Agent alive across Client disconnect on the Tunnel.
- Whether `session/load` succeeds after a prompt turn on this CLI (no-prompt Session did not).
- Whether the Host should call `session/load` vs start `session/new` after respawn.
