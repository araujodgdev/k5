import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    files: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "tests/**/*.ts", "e2e/**/*.ts", "e2e.config.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {

      "@typescript-eslint/no-floating-promises": ["error", {
        allowForKnownSafeCalls: [{ from: "package", name: ["test", "describe", "it"], package: "node:test" }],
      }],
      "@typescript-eslint/await-thenable": "error",

      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },

  globalIgnores([

    ".next/**",
    ".next-research-qa/**",
    ".next-verify/**",
    ".next-agent-verify/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    "dist/**",
    ".vinext/**",
    ".wrangler/**",

    ".data/**",
    ".e2e/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
