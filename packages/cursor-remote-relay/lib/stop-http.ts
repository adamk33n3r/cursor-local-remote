import type { Server } from "node:http";

/** Stop listening and drop keep-alive / WebSocket clients so Ctrl+C can exit. */
export function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });
}
