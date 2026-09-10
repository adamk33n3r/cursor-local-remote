import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] || join(process.cwd(), ".next");

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".map")) await unlink(path);
  }
}

await walk(root);
