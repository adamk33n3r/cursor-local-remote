Edit: Due to Cursor pricing changes, I have moved to Claude Code (that already has this feature). I will no longer be maintaining the project and recommend you fork it and make changes if needed.

# Cursor Remote

Control Cursor from any Client (phone, tablet, or browser) on your network. The Host is `@adamk33n3r/cursor-remote` / `cursor-remote`. A separate Relay package is `@adamk33n3r/cursor-remote-relay` / `cursor-remote-relay`.

A local web UI that talks to Cursor's CLI agent on your machine. No cloud, accounts or other bs — just on your local network. Also added some rudimentary security so that you need a key to access it incase you have many in a Wifi network. Important to only use this on trusted network that are safe, because the security is easy to bruteforce if you are in the same network.

## Demo
https://github.com/user-attachments/assets/6b2284fd-0e3d-46c9-ae63-86bbd672ad72



## Good to know

This is essentially an easy way to use the Cursor CLI from your phone or any other device on your network.

You can **start new sessions** from the remote UI and they work fully: the agent runs, edits files, executes commands, everything. However, sessions started remotely won't appear in Cursor's desktop sidebar. This is a Cursor limitation, it stores conversation state in an internal in-memory store that can't be written from outside the process.

The remote UI can see **all** sessions, both ones started in the IDE and ones started remotely. You can monitor active desktop sessions in real time, browse and resume past sessions, or start fresh ones. Messages sent from the remote won't show up in the IDE's chat view, but the work the agent does (file edits, commands) happens on your machine either way.

## Install

```bash
npm install -g @adamk33n3r/cursor-remote
```

Then start it:

```bash
cursor-remote
```

A QR code pops up in your terminal — scan it from your phone and you're connected.

Host Docker image (`adamk33n3r/cursor-remote`): compiled Node, Linux Agent CLI baked in (`curl https://cursor.com/install`). This image cannot run a Windows `agent.cmd` bind-mount.

Authenticate with `CURSOR_API_KEY` (same env the Agent CLI already reads — create a key in Cursor settings). Mount a Workspace; Agent edits files inside the container.

```bash
docker build -t adamk33n3r/cursor-remote .
docker run --rm -p 3100:3100 \
  -v /path/to/workspace:/workspace \
  -e CURSOR_API_KEY=your_cursor_api_key \
  -e AUTH_TOKEN=my-token \
  adamk33n3r/cursor-remote
```

The image already listens on `0.0.0.0:3100`, uses `/workspace` as the Start directory, and passes `--no-open`. `AUTH_TOKEN` is enough; do not also pass `--token`. Override port with `-e PORT=…` and `-p` if needed.

On Linux/macOS, `-p 3100:3100` works the same; `--network host` is optional if you want LAN Clients to use the host's IP without port publish.

Optional: point at a Linux Agent already on the host instead of the in-image install (`CURSOR_AGENT=/agent/agent` and a volume that contains that binary). Do not mount a Windows Cursor Agent tree into this image.

Relay does not spawn Agent; it only needs Login env.

## Updating

```bash
cursor-remote --update
```

Or the same command as install: `npm install -g @adamk33n3r/cursor-remote`

Relay (separate install, no Host Next.js tarball):

```bash
npm install -g @adamk33n3r/cursor-remote-relay
cursor-remote-relay
```

Listens on `0.0.0.0:3200` by default (`-p` / `PORT` to override). Stdout prints localhost and LAN Host-list URLs.

Login (authenticating a Client to the Host list) is one mode at a time:

| What you set | Mode | Host list | Stdout |
| --- | --- | --- | --- |
| Both username and password, none not explicit | Password | Splash Login, cookie, Logout | Host-list URLs only |
| Username and password unset, none not explicit | None (default) | Served with no splash and no Logout | URLs plus a warning that the Host list is not secured |
| None explicit (`--login none`, `LOGIN_MODE=none`, or config `"login": "none"`). Credentials may still be present and are unused. | None | Same as default none | URLs. No unsecured warning |
| Password explicit (`--login password`, `LOGIN_MODE=password`, or config `"login": "password"`), username or password unset | Misconfig | Process up. Login and Host list not served | Says the Host list will not be served until credentials are set |

Set password Login with `LOGIN_USERNAME` and `LOGIN_PASSWORD`, or `--config relay.json` (`{ "username", "password" }`). None can sit behind a forward-auth reverse proxy; the Relay does not require or enforce a proxy. None without a proxy is allowed.

Same process in a container (publish the port; Login env is optional):

```bash
docker build -t adamk33n3r/cursor-remote-relay packages/cursor-remote-relay
docker run --rm -p 3200:3200 -e LOGIN_USERNAME=user -e LOGIN_PASSWORD=secret adamk33n3r/cursor-remote-relay
```

I'm actively using this myself on a daily basis, so bugs get noticed and fixed quickly.

## Features

- **QR connect** — scan to connect your phone instantly and continue with phone coding session
- **Full agent control** — send prompts, pick models, switch modes, stop/retry from any device
- **Live streaming** — watch responses, tool calls, and file edits in real time
- **Multi-workspace** — switch between known Workspaces, star favorites, browse Sessions across Workspaces
- **Git panel** — view diffs, commit, push, pull, switch branches — all from the UI
- **Terminal access** — Access terminal from phone/browser 
- **Session management** — browse, resume, archive, and export past sessions
- **PWA ready** — install as an app on your phone's home screen
- **Notifications** — tab title flash + sound when agent finishes, optional webhook for push-to-phone (e.g. Discord)

## Notifications

When the Agent finishes a task, Cursor Remote notifies you in two ways:

**Built-in (no setup):** If the browser tab is in the background, the tab title flashes ("Done! - Cursor Remote" or "Error - Cursor Remote"), the favicon gets a colored badge, and a sound plays. When you switch back to the tab you'll see a banner showing the result.

**Webhook (optional):** For real push notifications — even with the phone locked or browser closed — you can configure a webhook URL in Settings. When the Agent completes, Cursor Remote sends a POST with a JSON payload:

```json
{
  "event": "agent_complete",
  "title": "Agent finished - my-app",
  "message": "Session abc12345 completed",
  "sessionId": "abc12345-...",
  "workspace": "/path/to/workspace",
  "timestamp": 1710000000000
}
```

This works with any service that accepts incoming webhooks:

- **Slack** — create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) and paste the URL
- **Discord** — create a [Webhook](https://support.discord.com/hc/en-us/articles/228383668) in channel settings
- **ntfy** — use `https://ntfy.sh/your-topic` (free, open source, has [mobile apps](https://ntfy.sh))
- **Custom** — any endpoint that accepts a JSON POST

Set it up in the Settings panel and hit "Send test" to verify.

## Usage

```
cursor-remote [workspace] [options]
```

| Option | Description |
| --- | --- |
| `workspace` | Path to the Start directory (defaults to cwd) |
| `-p, --port` | Port to run on (default: `3100`) |
| `-t, --token` | Set auth token (otherwise random or `AUTH_TOKEN` env) |
| `--host` | Bind to specific host/IP (default: `0.0.0.0`) |
| `--no-open` | Don't auto-open the browser |
| `--no-qr` | Don't show QR code in terminal |
| `--force` | Pass `--force` to Agent for this Host process (Run Everything; deny still applies) |
| `--no-force` | Do not pass `--force` (Host settings toggle still applies). `--no-trust` is an alias |
| `-v, --verbose` | Show all server and agent output |
| `-l, --list` | List known Workspaces |
| `--status` | Check if a Host is already running |
| `-u, --update` | Update to the latest version |
| `-V, --version` | Show version number |

```bash
cursor-remote                          # current folder
cursor-remote ~/code/my-app            # specific Workspace
cursor-remote --port 8080              # different port
cursor-remote --token my-secret        # fixed Token
cursor-remote --host 127.0.0.1         # localhost only
cursor-remote --status                 # check for running Host instances
cursor-remote --list                   # show all known Workspaces
cursor-remote --no-open --no-qr        # headless-friendly
```

## How it works

```
Phone / tablet / browser  ── LAN ──>  Next.js (0.0.0.0:3100)  ──>  cursor CLI (agent)
                          <─ WebSocket ─
```

The CLI starts a pre-built Next.js server on your machine. When you send a prompt, the server spawns a headless `agent` process (`agent -p <prompt> --output-format stream-json`) and streams live Session and terminal output back to the Client over WebSocket. Session history comes from reading Cursor's own transcript files in `~/.cursor/projects/`, so you see all sessions, not just ones started from this tool.

### Authentication

Every launch generates a memorable word-pair token (e.g. `alpine-berry`) printed in the terminal. You can set a fixed token via the `AUTH_TOKEN` env var. Access is granted by:

1. Scanning the QR code (encodes the network URL with the token)
2. Visiting the URL with `?token=<token>` (sets an `httpOnly` cookie for 7 days)
3. Passing `Authorization: Bearer <token>` for API calls

### API

All endpoints require a valid token (cookie or `Bearer` header).

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/chat` | `POST` | Send a prompt. Body: `{ prompt, sessionId?, model?, mode?, workspace? }` |
| `/api/models` | `GET` | List available models from `agent models` (cached 5 min) |
| `/api/sessions` | `GET` | Session list. `?workspace=<path>` to filter, `?archived=true` to include archived |
| `/api/sessions` | `PATCH` | Archive/unarchive sessions. Body: `{ action, sessionId? }` |
| `/api/sessions` | `DELETE` | Delete a stored session. Body: `{ sessionId }` |
| `/api/sessions/active` | `GET` | List currently running agent session IDs |
| `/api/sessions/active` | `DELETE` | Kill a running agent process. Body: `{ sessionId }` |
| `/api/sessions/history` | `GET` | Full transcript for a session. `?id=<sessionId>&workspace=<path>` |
| `/api/sessions/watch` | WebSocket | Live Session updates. `id=<sessionId>&workspace=<path>` |
| `/api/terminal/stream` | WebSocket | In-Host terminal, both ways. `id=<terminalId>` |
| `/api/terminal/list` | WebSocket | Live terminal roster (spawn, exit, remove) |
| `/api/projects` | `GET` | List known Workspaces (`workspaces`, `currentWorkspace`) |
| `/api/git` | `GET` | Git status, diffs, and branches. `?workspace=<path>&detail=status\|diff\|branches` |
| `/api/git` | `POST` | Git actions. Body: `{ action, workspace?, message?, files?, branch? }` |
| `/api/upload` | `POST` | Upload images (multipart/form-data) |
| `/api/settings` | `GET` | Get current settings |
| `/api/settings` | `PATCH` | Update settings. Body: `{ key, value }` |
| `/api/notifications/test` | `POST` | Send a test webhook notification |
| `/api/info` | `GET` | Network info, auth URL, and workspace path |

### Environment variables

| Variable | Description |
| --- | --- |
| `AUTH_TOKEN` | Fixed auth token (otherwise randomly generated each launch) |
| `CURSOR_WORKSPACE` | Workspace path (set automatically by the CLI) |
| `CURSOR_FORCE` | Set to `1` to pass `--force` to Agent; `0` to disable. If unset, the Host settings toggle is used |
| `CURSOR_API_KEY` | Agent CLI auth (headless / Docker). Create a key in Cursor; do not bake it into the image |
| `CURSOR_AGENT` | Path to an `agent` binary (or Windows `agent.cmd`) when it is not on PATH |
| `PORT` | Server port (default: `3100`) |

## Requirements

- [Node.js](https://nodejs.org/) 22+
- [Cursor](https://cursor.com) with the CLI installed (`agent --version` should work), **or** Docker Host with `CURSOR_API_KEY` (Agent CLI is in that image)
- A Cursor subscription (Pro, Team, etc.)

## Development

From a git checkout, TypeScript is compiled on the fly (Next HMR + tsx for the CLIs). `--dev` forces that even if `.next` from a previous `next build` is still on disk.

```bash
git clone https://github.com/adamk33n3r/cursor-local-remote.git
cd cursor-local-remote
npm install
npm run dev
```

Relay Next-dev (Login env required to serve the Host list):

```bash
npm run relay:dev
```

Production-like (compiled `dist/` + `.next`, no tsx):

```bash
npm run build
npm start
npm run relay:build
npm run relay:start
```

`--start` on either CLI requires those build artifacts and fails if they are missing.

## License

MIT
