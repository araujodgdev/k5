import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['@mastra/core', '@mastra/ai-sdk', 'pdfjs-dist', 'unpdf', 'tesseract.js', '@napi-rs/canvas', 'mammoth', 'mailparser', 'exceljs', 'pizzip', 'docx'],
  allowedDevOrigins: ["*.trycloudflare.com"],
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.env", "./.env.*"],
  },
};

export default nextConfig;
