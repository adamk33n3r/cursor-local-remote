# ACP auth and MCP on a Host that already runs Agent

Ticket: [#38](https://github.com/adamk33n3r/cursor-local-remote/issues/38)
Branch: `research/acp-auth-mcp`
Date: 2026-09-13

## Question

How does ACP auth and MCP work on a Host that already runs Agent?

Does existing Host-machine Agent account (`agent login`, `--api-key` / the documented API-key environment variable, `--auth-token`) satisfy ACP `authenticate` with `methodId: "cursor_login"` with no Client step? What happens if the Host Agent is not signed in — does `initialize` / `authenticate` fail, and how?

What MCP is available in ACP (project-level and user-level `.cursor/mcp.json` only)? Confirm team-dashboard MCP is unsupported. How does MCP permission interact with `session/request_permission`?

## Language

This note uses `CONTEXT.md` terms. **Login** is Relay Client auth. **Token** is direct-LAN Host auth. Neither is the Agent account on the Host machine.

- **Agent account**: credentials `agent login` stores on the Host, or a CLI API key / CLI auth-token passed into `agent`. Not Login. Not Token.
- **MCP server auth**: `agent mcp login <identifier>` against a server in `mcp.json`. Not Agent account, not Login, not Token.

## Sources

Primary only:

- [Cursor CLI ACP](https://cursor.com/docs/cli/acp)
- [Cursor CLI MCP](https://cursor.com/docs/cli/mcp)
- [Cursor MCP overview](https://cursor.com/docs/mcp) (config locations)
- [Cursor CLI authentication](https://cursor.com/docs/cli/reference/authentication)
- [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters)
- [ACP v1 authentication](https://agentclientprotocol.com/protocol/authentication)
- [ACP v1 initialization](https://agentclientprotocol.com/protocol/initialization)
- [ACP v1 session setup](https://agentclientprotocol.com/protocol/session-setup)
- [ACP v1 tool calls / `session/request_permission`](https://agentclientprotocol.com/protocol/tool-calls)
- Installed Agent CLI `2026.09.10-fd3934a` (`agent --version`), Windows: `agent --help`, `agent acp --help`, `agent login --help`, `agent mcp --help`, and the matching ACP chunk (`cursor-acp-agent.ts`, `run.ts`, `shared-services.ts`).

Not used: blog posts, secondary write-ups.

## Findings

### 1. ACP on a Host that already runs Agent

`agent acp` starts Agent as an ACP server over stdio, JSON-RPC 2.0, newline-delimited JSON. The Client writes to stdin; Agent writes to stdout. ([ACP docs](https://cursor.com/docs/cli/acp); installed `agent acp --help`: "Start the Cursor Agent as an ACP (Agent Client Protocol) server".)

Typical flow: `initialize` → `authenticate` with `methodId: "cursor_login"` → `session/new` or `session/load` → `session/prompt`, while handling `session/update` and `session/request_permission`. ([ACP docs](https://cursor.com/docs/cli/acp).)

The Host already spawning Agent for Sessions is the same CLI. ACP is that CLI in server mode, not a second product.

### 2. Host Agent account and `authenticate` (`cursor_login`)

**Docs.** Cursor advertises `cursor_login` as the ACP auth method. "In practice, you can pre-authenticate before startup using existing CLI auth paths": `agent login`; `--api-key` (or the documented API-key environment variable); `--auth-token` (or the documented auth-token environment variable). The Neovim example: `auth_method` is `"cursor_login"`; "Run `agent login` in your terminal first to authenticate." ([ACP docs](https://cursor.com/docs/cli/acp).)

`agent login` opens a browser and stores credentials locally. API key is `--api-key` or the documented API-key environment variable. ([CLI authentication](https://cursor.com/docs/cli/reference/authentication); installed `agent --help` / `agent login --help`.)

`--auth-token` ("Auth token to use directly", plus the matching environment variable) exists on the installed CLI but is hidden from default `--help`. ACP docs still list it. That flag is Agent's CLI credential, not this product's Token.

The documented Client still sends `authenticate` with `methodId: "cursor_login"` after `initialize`. The official minimal client does that, then `session/new`. There is no Client UI for Agent account in those docs. Pre-auth is on the Host before `agent acp` starts. ([ACP docs](https://cursor.com/docs/cli/acp).)

**Installed CLI.** `initialize` always succeeds and always advertises one method:

- `id`: `cursor_login`
- `name`: `Cursor Login`
- `description`: authenticate using existing Cursor credentials; run `agent login` first if not signed in.

It does not fail when the Host has no Agent account. (Installed `cursor-acp-agent.ts` `initialize`.)

At ACP process start, the CLI treats the process as already authenticated if any of:

1. CLI auth-token (`--auth-token` or its documented environment variable)
2. CLI API key present (`--api-key` or its documented environment variable)
3. stored Agent account (`agent login`)

That boolean is `isAuthenticated` on the ACP agent. (Installed `run.ts`.)

If `isAuthenticated` is already true, `session/new`, `session/load`, and session list proceed without an auth error. The documented Client still calls `authenticate`; that is protocol hygiene, not a second Client-side account step.

`authenticate({ methodId })`:

- Unknown `methodId` → JSON-RPC invalid params (`Unknown authentication method… Supported method: cursor_login`).
- `cursor_login` and stored Agent account present → no browser; sets `isAuthenticated` true; empty success result. **No Client step.**
- `cursor_login` and no stored Agent account → opens a **Host** browser for `agent login`, waits, stores credentials, then sets `isAuthenticated`. If the browser cannot open: invalid params with a URL to visit **on the Host**. If the wait fails or times out: invalid params `"Login failed or timed out. Please try again."`

That Host browser is still Agent account on the Host, not Relay Login and not a Client page.

Caveat vs the docs list of three pre-auth paths: `authenticate` itself only re-checks **stored Agent account**, not "API key present" / "auth-token present". API key or auth-token at process start already sets `isAuthenticated`, so `session/new` can succeed without calling `authenticate`. If a Client still calls `authenticate` and the Host has only API key / auth-token and no stored `agent login`, the CLI may open the Host browser anyway.

**Answer to the ticket:** existing Host `agent login` satisfies `authenticate` with `methodId: "cursor_login"` with no Client step. `--api-key` and `--auth-token` (and their documented environment variables) pre-authenticate the ACP **process** so session methods are not auth-gated; they are not a Client step. The protocol method to send remains `authenticate` / `cursor_login`. Do not add a Client Login UI for this.

### 3. If the Host Agent is not signed in

`initialize` does **not** fail. It returns capabilities and `authMethods` containing `cursor_login`. (Installed `initialize`; [ACP initialization](https://agentclientprotocol.com/protocol/initialization).)

`authenticate` does **not** immediately fail. It tries Host-side `agent login` (browser). It fails only if that Host flow cannot start or does not complete (invalid params, messages above).

`session/new`, `session/load`, and session list **do** fail if `isAuthenticated` is still false. The CLI throws ACP `authRequired` with:

> Authentication required. Please run `agent login` first, then call authenticate() with methodId 'cursor_login'.

ACP v1: after a successful `authenticate`, the Client can create sessions without an `auth_required` error. Session creation may return `auth_required` if the Agent still requires authentication. ([ACP authentication](https://agentclientprotocol.com/protocol/authentication); [ACP schema](https://agentclientprotocol.com/protocol/v1/schema).)

So: missing Agent account is not an `initialize` failure. It is a session-method `auth_required` until `authenticate` succeeds (or the process was pre-authenticated at startup). Unanswered `authenticate` in the no-account case is a Host browser wait, not a JSON-RPC error, until that wait fails.

### 4. MCP available in ACP

**Docs (ACP-specific).** "ACP supports MCP servers defined in a project-level or user-level `.cursor/mcp.json`. Launch `agent` from your project directory and approve the servers you want to use." "Team-level MCP servers configured through the Cursor dashboard are not supported in ACP mode." ([ACP docs](https://cursor.com/docs/cli/acp).)

**Config locations (MCP overview).** Project: `.cursor/mcp.json` in the project. User: `.cursor/mcp.json` under the home directory. ([MCP overview](https://cursor.com/docs/mcp).)

**CLI MCP.** Same editor config; `agent mcp login|list|list-tools|enable|disable`. Installed help: login "configured in `.cursor/mcp.json` or `~/.cursor/mcp.json`". Enable: not found → "Check `.cursor/mcp.json` or `~/.cursor/mcp.json`". Enable implementation reads those two files (user then project; project wins on name clash). ([CLI MCP](https://cursor.com/docs/cli/mcp); installed `agent mcp --help` / `enable.ts`.)

General CLI MCP also discovers parent-directory configs (project → global → nested). ([CLI MCP](https://cursor.com/docs/cli/mcp).) The ACP page does not restate nested discovery; it says launch from the project directory.

**Installed ACP.** Shared services load MCP through the same `mcp.json` loader, with auto-approve **off** (uses the local MCP approvals file). `session/new` and `session/load` accept `mcpServers` from the Client (ACP session setup). If that array is empty (Cursor's minimal client sends `[]`), the session uses the Host `mcp.json` lease. If the Client sends servers, the CLI overlays them onto that lease (stdio / http / sse). ([ACP session setup](https://agentclientprotocol.com/protocol/session-setup); installed `session-resources.ts` / `shared-services.ts`.)

ACP `initialize` advertises HTTP and SSE MCP capabilities. Stdio is required by ACP for all Agents. (Installed `initialize`; [ACP session setup](https://agentclientprotocol.com/protocol/session-setup).)

**Team dashboard MCP:** unsupported in ACP. Settled from the ACP page. Do not expect Dashboard team MCP servers to appear in `agent acp`. (Team distribution exists for Cloud Agents / marketplace in the [MCP overview](https://cursor.com/docs/mcp); that is not ACP.)

Plugin-shipped MCP appears in the interactive `agent mcp` TUI. ACP docs do not list it. This note does not claim plugin MCP in ACP.

### 5. MCP permission and `session/request_permission`

**ACP docs.** When tools need approval, Agent sends `session/request_permission`. The Client returns `allow-once`, `allow-always`, or `reject-once`. If the Client does not answer, tool execution can block. The minimal client auto-selects `allow-once`. MCP servers from `mcp.json` still need to be approved. ([ACP docs](https://cursor.com/docs/cli/acp).)

**ACP spec.** `session/request_permission` carries the tool call plus options (`allow_once` / `allow_always` / `reject_once` / `reject_always`). The Client replies `{ outcome: { outcome: "selected", optionId } }` or `"cancelled"`. ([ACP tool calls](https://agentclientprotocol.com/protocol/tool-calls).)

**Installed CLI.** MCP tool calls are the same pending-decision path as Shell / Write / Delete. The ACP presenter titles an MCP call `{server name}: {toolName}`, kind `other`, with JSON args. Options sent: `allow-once`, `allow-always`, `reject-once`. `allow-always` persists allowlist entry type `Mcp` with key `{providerIdentifier}:{toolName}`.

Project-level servers also use the local approved list. `agent mcp enable <id>` adds that approval. `agent mcp disable <id>` stops load and approval prompts. `agent --approve-mcps` auto-approves servers in **interactive** CLI; ACP's loader is constructed with auto-approve false, so ACP does not inherit that skip from docs alone — Host must enable servers or the Client must answer `session/request_permission`. ([CLI MCP](https://cursor.com/docs/cli/mcp); [CLI parameters](https://cursor.com/docs/cli/reference/parameters); installed ACP permission presenter + MCP loader.)

`--force` / `--yolo` on the ACP process uses an always-allow decision provider unless team auto-run controls force allowlist mode. That is Host CLI flags, not a Client step.

`agent mcp login <id>` is OAuth/callback for a server in `mcp.json`. It is not `authenticate` / `cursor_login`. Servers that still `requires_authentication` will not be usable until that Host-side MCP server auth exists.

## Settled for the map

- Host `agent login` (or CLI API key / CLI auth-token at process start) is the Agent account for ACP. No Client Login UI. Still send `authenticate` / `cursor_login`.
- `initialize` always works. Unauthenticated `session/new` is `auth_required` ("run `agent login`, then `authenticate` / `cursor_login`"). Bare `authenticate` without a stored Agent account opens a **Host** browser, not a Client page.
- ACP MCP = project and user `.cursor/mcp.json` (plus optional `session/new` `mcpServers`). Team dashboard MCP is unsupported.
- MCP tool approval is `session/request_permission` (`allow-once` / `allow-always` / `reject-once`). `allow-always` and `agent mcp enable` persist Host-side approval. Unanswered permission requests block.

## Out of scope (not done)

- No Client Login UI design.
- No Relay Login changes.
- No Host Token changes.
- No implementation.
