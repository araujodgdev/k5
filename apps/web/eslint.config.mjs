import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Type-aware checks. The database is asynchronous, so a forgotten `await` on a write is a write
  // that may never land — and TypeScript stays silent when the result is discarded. This rule is
  // the only thing that catches it.
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // `test()` from node:test returns a promise the runner owns; awaiting it at the top of a
      // test file would be wrong, so it is exempt rather than voided at 200 call sites.
      "@typescript-eslint/no-floating-promises": ["error", {
        allowForKnownSafeCalls: [{ from: "package", name: ["test", "describe", "it"], package: "node:test" }],
      }],
      "@typescript-eslint/await-thenable": "error",
      // Catches the failure TypeScript stays quiet about: a Promise used as a condition. An
      // un-awaited call is always truthy, so `if (!findThing())` silently stops running its body.
      // checksVoidReturn stays off: an async onClick is ordinary React, and React handles it.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-research-qa/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // vinext build output: bundled and generated, not authored here.
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    // Local data and browser audit artifacts can contain generated bundles.
    ".data/**",
  ]),
]);

export default eslintConfig;
