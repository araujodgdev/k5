import { defineConfig, loadEnv } from "vite";
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { sentryBuildOptions } from './scripts/sentry-build';
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
// import.meta.dirname rather than __dirname: this package is ESM ("type": "module").

export default defineConfig(({ mode }) => ({
  define: {
    'process.env.K5_RUNTIME': JSON.stringify('cloudflare'),
    'process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT': JSON.stringify(loadEnv(mode, process.cwd(), 'NEXT_PUBLIC_').NEXT_PUBLIC_SENTRY_ENVIRONMENT || (mode === 'production' ? 'staging' : 'development')),
  },
  build: { sourcemap: sentryBuildOptions.authToken ? 'hidden' : false },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
    sentryVitePlugin({
      ...sentryBuildOptions,
      sourcemaps: {
        disable: !sentryBuildOptions.authToken,
        assets: ['./dist/**'],
        filesToDeleteAfterUpload: ['./dist/client/**/*.map'],
      },
    }),
  ],
  resolve: {
    // Regular expressions, not bare strings: a string alias matches by prefix, so
    // "pdfjs-dist/legacy/build/pdf.mjs" would resolve to "empty-stub.js/legacy/build/pdf.mjs".
    // The optional (/.*)? group sends the package and every subpath to the same stub.
    //
    // These three cannot run in workerd: @napi-rs/canvas is a native addon, and pdfjs-dist and
    // tesseract.js depend on it to rasterise and recognise. Extraction and OCR stay in the Node
    // worker. Stubbing beats externalising because an external import would resolve at build time
    // and then fail at runtime, in production, on a document a person just uploaded.
    alias: [
      { find: /^@napi-rs\/canvas(\/.*)?$/, replacement: new URL("./empty-stub.js", import.meta.url).pathname },
      { find: /^pdfjs-dist(\/.*)?$/, replacement: new URL("./empty-stub.js", import.meta.url).pathname },
      { find: /^tesseract\.js(\/.*)?$/, replacement: new URL("./empty-stub.js", import.meta.url).pathname },
      // pkce-challenge declares no "workerd" export condition, so resolution fails outright. It
      // arrives only transitively, through @ai-sdk/mcp and shadcn's MCP SDK; nothing in src/ builds
      // an MCP client, and Lume's WebMCP runs in the browser. The stub throws if that ever changes.
      { find: /^pkce-challenge(\/.*)?$/, replacement: new URL("./empty-stub.js", import.meta.url).pathname },
    ],
  },
}));
