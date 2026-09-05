import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import initSqlJs from "sql.js";

export function getHostDataDir() {
  return join(homedir(), ".cursor-local-remote");
}

/**
 * Workspaces recorded in the Host session store. Empty when the db is missing.
 * @returns {Promise<string[]>}
 */
export async function listSessionStoreWorkspaces() {
  const dbPath = join(getHostDataDir(), "sessions.db");
  if (!existsSync(dbPath)) return [];

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const stmt = db.prepare("SELECT DISTINCT workspace FROM sessions ORDER BY workspace");
    const paths = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (typeof row.workspace === "string" && row.workspace) {
        paths.push(row.workspace);
      }
    }
    stmt.free();
    return paths;
  } finally {
    db.close();
  }
}
