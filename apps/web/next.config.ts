import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs/config';
import { sentryBuildOptions } from './scripts/sentry-build';

const nextConfig: NextConfig = {
  // Keep isolated QA and verification servers from sharing Next's output and dev lock with the main app.
  distDir: ['.next-research-qa', '.next-verify'].find(dir => dir === process.env.K5_NEXT_DIST_DIR) ?? '.next',
  devIndicators: false,
  // Administration moved into the app shell; keep bookmarks to the old area working.
  redirects() {
    return Promise.resolve([
      { source: "/platform", destination: "/app/admin", permanent: true },
      { source: "/platform/:path*", destination: "/app/admin/:path*", permanent: true },
    ]);
  },
  headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    }];
  },
  serverExternalPackages: ['@mastra/core', '@mastra/ai-sdk', '@mastra/memory', '@mastra/pg', 'pdfjs-dist', 'unpdf', 'tesseract.js', '@napi-rs/canvas', 'mammoth', 'mailparser', 'exceljs', 'pizzip', 'docx'],
  allowedDevOrigins: ["*.trycloudflare.com"],
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.env", "./.env.*"],
  },
};

export default withSentryConfig(nextConfig, {
  ...sentryBuildOptions,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !sentryBuildOptions.authToken,
    deleteSourcemapsAfterUpload: true,
  },
});
