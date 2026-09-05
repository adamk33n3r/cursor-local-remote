import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const LOGIN_COOKIE = "cr_login";
export const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7;

function safeEqual(a, b) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function loginCookieValue(username, password) {
  // HMAC of the username, keyed by the password, so the cookie is not the Login
  // password and still validates after a Relay restart with the same credentials.
  return createHmac("sha256", password).update(`cursor-remote-relay:${username}`).digest("hex");
}

function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function readBody(req, limit = 32_768) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (chunk) => {
      n += chunk.length;
      if (n > limit) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function setCookieHeader(value) {
  return `${LOGIN_COOKIE}=${value}; Max-Age=${COOKIE_MAX_AGE_S}; Path=/; HttpOnly; SameSite=Strict`;
}

function loginPage(error = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cursor Remote</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #101014;
      color: #e8e8e8;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 24px 20px 40px;
    }
    h1 { font-size: 32px; font-weight: 600; }
    .sub { color: #999; margin: 8px 0 24px; font-size: 14px; }
    form { display: flex; flex-direction: column; gap: 12px; }
    input {
      background: #1a1a1f;
      border: 1px solid #2a2a33;
      border-radius: 16px;
      padding: 12px 16px;
      color: #e8e8e8;
      font-size: 15px;
    }
    button {
      background: #4ade80;
      color: #000;
      border: none;
      border-radius: 16px;
      padding: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    .error { color: #ef4444; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Cursor Remote</h1>
  <p class="sub">Login on the Host list. Then pick a Host.</p>
  <form method="post" action="/login">
    <input name="username" placeholder="Username" autocomplete="username" autofocus />
    <input name="password" type="password" placeholder="Password" autocomplete="current-password" />
    <button type="submit">Login</button>
    ${error ? '<p class="error">Wrong username or password.</p>' : ""}
  </form>
</body>
</html>`;
}

function hostListPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hosts — Cursor Remote</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #101014;
      color: #e8e8e8;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100dvh;
      padding: 24px 16px;
    }
    h1 { font-size: 28px; font-weight: 600; margin-bottom: 16px; }
    .empty { color: #888; }
  </style>
</head>
<body>
  <h1>Hosts</h1>
  <p class="empty">Nothing registered yet.</p>
</body>
</html>`;
}

/**
 * @param {{ username: string, password: string } | null} login
 */
export function createRelayHandler(login) {
  const expectedCookie = login ? loginCookieValue(login.username, login.password) : null;

  return (req, res) => {
    handleRequest(req, res, login, expectedCookie).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error\n");
      }
    });
  };
}

/**
 * @param {{ username: string, password: string } | null} login
 * @param {string | null} expectedCookie
 */
async function handleRequest(req, res, login, expectedCookie) {
  if (!login || !expectedCookie) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Host list is not served until Login credentials are set.\n");
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const cookies = parseCookies(req.headers.cookie);
  const authed = Boolean(cookies[LOGIN_COOKIE] && safeEqual(cookies[LOGIN_COOKIE], expectedCookie));
  const route = `${req.method ?? "GET"} ${url.pathname}`;

  switch (route) {
    case "GET /": {
      if (authed) {
        res.writeHead(302, { Location: "/hosts" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(loginPage());
      return;
    }
    case "POST /login": {
      let body;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Request body too large\n");
        return;
      }
      const params = new URLSearchParams(body);
      const username = params.get("username") ?? "";
      const password = params.get("password") ?? "";
      if (!safeEqual(username, login.username) || !safeEqual(password, login.password)) {
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
        res.end(loginPage(true));
        return;
      }
      res.writeHead(302, {
        Location: "/hosts",
        "Set-Cookie": setCookieHeader(expectedCookie),
      });
      res.end();
      return;
    }
    case "GET /hosts": {
      if (!authed) {
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
        res.end(loginPage());
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(hostListPage());
      return;
    }
    case "GET /api/hosts": {
      if (!authed) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      // Registration is a later ticket; v1 Login still shows this empty list.
      res.end(JSON.stringify({ hosts: [] }));
      return;
    }
    default: {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found\n");
    }
  }
}
