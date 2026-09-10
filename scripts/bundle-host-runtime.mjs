import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/lib/register-host-runtime.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/register-host-runtime.js",
  packages: "external",
  alias: { "@": join(root, "src") },
});
