# Cursor Remote

Language for Cursor Remote: a Host, a Relay on the LAN, and a Host list that leads into that Host. v1 is Agent + Relay. Driving Cursor is a later Host mode.

## Language

**Cursor Remote**:
This product: the fork of cursor-local-remote that is not LAN-only. A Host is a running Cursor Remote.
_Avoid_: CLR (as the product name), cursor-local-remote (except the upstream/repo), Cursor (for this product)

**Host**:
A registered Cursor Remote on the user's PC, identified by a stable id that machine keeps. At most one Host process runs on that PC. It is the process that may connect out to the Relay, a row on the Host list (online or offline; reconnect with the same id is the same row), and the UI you use after picking that row. A Client may also reach that Host directly on the LAN, without the Host list. The User who starts it chooses Agent mode or Cursor mode.
_Avoid_: server, device (for this instance), agent (for this instance), machine (as a separate type), Host UI, CLR (as a role), client (for this instance)

**Agent mode**:
The Host runs Sessions by spawning Agent. This is v1.
_Avoid_: CLI mode, default mode (as the type name), Cursor mode

**Cursor mode**:
A Host setting the User who starts the Host can turn on: the Host uses Cursor (the Agent Window) for Client Sessions instead of Agent. Not v1.
_Avoid_: GUI mode, IDE mode, drive mode, CDP mode (in spec copy), Agent mode

**Relay**:
The LAN process Hosts connect out to. It is not a Host and not Cursor Remote's UI. It serves Login and the Host list to a Client.
_Avoid_: server, hub, gateway, proxy (as the process name), Relay UI, web UI (as a product)

**Tunnel**:
The Host's outbound connection to the Relay. After Login and pick, the Relay reverse-proxies that Host's HTTP (page load and APIs) and WebSocket (live streams) over it. Direct LAN Clients do not use the Tunnel.
_Avoid_: proxy (as the process name), WebSocket (as the product name), SSE

**Host list**:
The page on the Relay where the user logs in and sees Hosts, including offline ones. Those rows survive a Relay process restart as the same Hosts, offline until they reconnect. v1 shows this list even when there is one Host.
_Avoid_: picker, device list, dashboard, project list

**Forget**:
The User removing an offline Host-list row. That is the only way a persisted row leaves the list until that Host registers again. Reconnect with the same id is the same row again. Forget is not offered while that Host is online.
_Avoid_: unregister, unpair, delete Host

**Workspace**:
A folder path on a Host. Sessions run in a Workspace; the Host groups Sessions by Workspace. There is no Project type.
_Avoid_: folder (as a type), project

**Start directory**:
The folder the Host process starts in: its cwd, or the CLI path argument if given. It is the process default Workspace and where the Client disk browser opens. Opening another Workspace does not change it.
_Avoid_: browse root, default directory (as a type), workspace root, Host directory

**Session**:
One agent conversation with an id. A row in Cursor's sidebar for that conversation is still this Session, not a different type.
_Avoid_: chat, thread, composer (as the entity)

**Continuity**:
A Client-started Session appearing as that same Session in the Agent Window conversation list so the User can continue at the desk. File changes on disk without that row are not Continuity. A row that exists only in the classic editor workbench is not Continuity. This is a Cursor mode concern, not a v1 gate.
_Avoid_: sync, resume (as the product name), a copy of the conversation

**Login**:
Authenticating a Client to the Host list before that Client sees Hosts. One of: username and password, OIDC at an identity provider, or none (the list is served without that act). Both username and password set is the password mode. None is the default when they are unset, or an explicit setting.
_Avoid_: pairing, token (for this act), Host-list auth (as a second type)

**Registration**:
A Host connecting to the Relay.
_Avoid_: pairing, login (for this act)

**Token**:
The Host's word-pair (or configured) auth for a Client that reaches the Host directly on the LAN. It is not used on the Relay path after Login.
_Avoid_: pairing, login (for this act)

**User**:
The human who logs in on the Host list and uses a Host.
_Avoid_: operator, client (for the human)

**Client**:
The browser or machine the User uses to reach the Host list (phone, tablet, or laptop).
_Avoid_: phone, device, browser (as the type)

**Cursor**:
The desktop Cursor app on the same PC as the Host. Continuity is a row in the Agent Window conversation list. In Cursor mode the Host uses this app for Client Sessions.
_Avoid_: Host, Cursor Remote, IDE, workbench (as the Continuity surface)

**Agent Window**:
The Cursor desktop UI that lists Sessions and is where the User continues at the desk. Same process as Cursor.exe; not a separate product.
_Avoid_: IDE, VS Code, workbench, Glass (in spec copy; Glass is the code name)

**Agent**:
Cursor's CLI that a Host already spawns to run a Session.
_Avoid_: Host, Cursor (for the CLI), server
