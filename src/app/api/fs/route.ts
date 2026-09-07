import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getWorkspace } from "@/lib/workspace";
import { badRequest, notFound, parseJsonBody, serverError } from "@/lib/errors";
import { leafFolderName, listFilesystem } from "@/lib/fs-browser";
import { isWindowsDrivesListing } from "@/lib/types";
import { parseBody } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const mkdirSchema = z.object({
  action: z.literal("mkdir"),
  path: z.string().min(1).max(512),
  name: z.string().min(1).max(255),
});

const openSchema = z.object({
  action: z.literal("open"),
  path: z.string().min(1).max(512),
});

const fsPostSchema = z.discriminatedUnion("action", [mkdirSchema, openSchema]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pathParam = url.searchParams.has("path") ? url.searchParams.get("path") : null;
  try {
    return Response.json(listFilesystem(pathParam));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return notFound("Directory not found");
    if (code === "ENOTDIR") return badRequest("Not a directory");
    return serverError("Failed to list directory");
  }
}

export async function POST(req: Request) {
  const raw = await parseJsonBody<unknown>(req);
  if (raw instanceof Response) return raw;

  const parsed = parseBody(fsPostSchema, raw);
  if ("error" in parsed) return badRequest(parsed.error);

  const body = parsed.data;
  switch (body.action) {
    case "mkdir":
      return mkdirLeaf(body.path, body.name);
    case "open":
      return openWorkspace(body.path);
    default: {
      const _never: never = body;
      return badRequest(`Invalid action: ${String(_never)}`);
    }
  }
}

function mkdirLeaf(parentPath: string, name: string): Response {
  if (isWindowsDrivesListing(parentPath)) {
    return badRequest("Not a directory");
  }
  const leaf = leafFolderName(name);
  if (!leaf) return badRequest("Folder name must be a single leaf in the current listing");

  const parent = resolve(parentPath);
  try {
    const st = statSync(parent);
    if (!st.isDirectory()) return badRequest("Not a directory");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return notFound("Directory not found");
    return serverError("Failed to create folder");
  }

  const created = join(parent, leaf);
  try {
    mkdirSync(created);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return badRequest("Folder already exists");
    return serverError("Failed to create folder");
  }

  return Response.json({ path: created, listing: listFilesystem(parent) });
}

function openWorkspace(path: string): Response {
  if (isWindowsDrivesListing(path)) {
    return badRequest("Not a directory");
  }
  const resolved = resolve(path);
  try {
    const st = statSync(resolved);
    if (!st.isDirectory()) return badRequest("Not a directory");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return notFound("Directory not found");
    return serverError("Failed to open Workspace");
  }

  // Session Workspace is the opened path. Start directory / process default stays put.
  return Response.json({
    workspace: resolved,
    startDirectory: getWorkspace(),
  });
}
