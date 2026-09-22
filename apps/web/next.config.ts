import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs/config';
import { sentryBuildOptions } from './scripts/sentry-build';

const nextConfig: NextConfig = {
  // Keep an isolated QA server from sharing Next's output and dev lock with the main app.
  distDir: process.env.K5_NEXT_DIST_DIR === '.next-research-qa' ? '.next-research-qa' : '.next',
  devIndicators: false,
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
  serverExternalPackages: ['@mastra/core', '@mastra/ai-sdk', 'pdfjs-dist', 'unpdf', 'tesseract.js', '@napi-rs/canvas', 'mammoth', 'mailparser', 'exceljs', 'pizzip', 'docx'],
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
