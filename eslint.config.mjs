import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextConfig from "eslint-config-next";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      ".next/",
      "node_modules/",
      "bin/",
      ".worktrees/",
      "**/next-env.d.ts",
      "packages/cursor-remote-relay/.next/",
      "dist/",
      "packages/cursor-remote-relay/dist/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...nextConfig,
  prettierConfig,
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["packages/cursor-remote-relay/**"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
);
