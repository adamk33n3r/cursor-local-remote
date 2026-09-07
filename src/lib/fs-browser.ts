import { accessSync, readdirSync } from "node:fs";
import { basename, dirname, parse, resolve, sep } from "node:path";
import {
  WINDOWS_DRIVES_LISTING,
  isWindowsDrivesListing,
  type FsEntry,
  type FsListing,
} from "@/lib/types";
import { getWorkspace } from "@/lib/workspace";

export type { FsEntry, FsListing };

function isWindowsDriveRoot(resolvedPath: string): boolean {
  if (process.platform !== "win32") return false;
  const root = parse(resolvedPath).root;
  const normalized = resolvedPath.endsWith(sep) ? resolvedPath : resolvedPath + sep;
  return normalized.toLowerCase() === root.toLowerCase();
}

function windowsDrives(): FsEntry[] {
  const entries: FsEntry[] = [];
  // Skip A: and B: — exists/access on empty floppy drives can hang on Windows.
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      accessSync(root);
      entries.push({ name: `${letter}:`, path: root });
    } catch {
      // drive not present
    }
  }
  return entries;
}

function listingParent(resolvedPath: string): string | null {
  if (process.platform === "win32" && isWindowsDriveRoot(resolvedPath)) {
    return WINDOWS_DRIVES_LISTING;
  }
  if (resolvedPath === "/" || resolvedPath === parse(resolvedPath).root) {
    return null;
  }
  return dirname(resolvedPath);
}

export function listFilesystem(pathParam: string | null): FsListing {
  const startDirectory = getWorkspace();

  if (isWindowsDrivesListing(pathParam)) {
    if (process.platform === "win32") {
      return {
        path: WINDOWS_DRIVES_LISTING,
        parent: null,
        startDirectory,
        entries: windowsDrives(),
      };
    }
    pathParam = "/";
  }

  const target =
    pathParam === null || pathParam === undefined ? startDirectory : resolve(pathParam);
  const entries: FsEntry[] = [];
  for (const dirent of readdirSync(target, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    entries.push({ name: dirent.name, path: resolve(target, dirent.name) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: target,
    parent: listingParent(target),
    startDirectory,
    entries,
  };
}

export function leafFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed === "." || trimmed === "..") return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) return null;
  if (basename(trimmed) !== trimmed) return null;
  return trimmed;
}
