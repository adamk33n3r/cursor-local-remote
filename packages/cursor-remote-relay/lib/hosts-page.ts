import { listHosts } from "./hosts";

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Host list HTML from the same process as Registration. Next SSR cannot see
 * the in-memory registry (separate module graph / production build).
 */
export function hostsPageHtml(): string {
  const hosts = listHosts();
  const rows =
    hosts.length === 0
      ? `<p style="color:#555">Nothing registered yet.</p>`
      : `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px">${hosts
          .map((host) => {
            const inner = host.online
              ? `<a href="/h/${encodeURIComponent(host.id)}/" style="display:block;background:#111;border-radius:12px;padding:16px;color:#e8e8e8;text-decoration:none">
                   <span style="font-size:18px;font-weight:500">${escapeHtml(host.name)}</span>
                   <span style="display:block;margin-top:4px;font-size:14px;color:#3dd68c">Online</span>
                 </a>`
              : `<div style="border-radius:12px;padding:16px;color:#555">
                   <span style="font-size:18px;font-weight:500">${escapeHtml(host.name)}</span>
                   <span style="display:block;margin-top:4px;font-size:14px">Offline</span>
                 </div>`;
            return `<li data-host-row data-host-id="${escapeHtml(host.id)}">${inner}</li>`;
          })
          .join("")}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cursor Remote</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #e8e8e8;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100dvh;
    }
  </style>
</head>
<body>
  <div style="position:relative;display:flex;min-height:100dvh;flex-direction:column;padding:24px 16px 96px">
    <div style="margin-bottom:24px;display:flex;align-items:baseline;justify-content:space-between">
      <p style="font-size:30px;font-weight:600">Hosts</p>
      <form method="post" action="/logout">
        <button type="submit" style="background:none;border:none;color:#555;font-size:14px;cursor:pointer">Logout</button>
      </form>
    </div>
    ${rows}
  </div>
</body>
</html>`;
}
