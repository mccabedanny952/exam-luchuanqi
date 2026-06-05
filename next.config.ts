import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/files/extract": [
      "./node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs",
      "./node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs",
      "./node_modules/pdf-parse/dist/worker/pdf.worker.mjs",
    ],
  },
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
