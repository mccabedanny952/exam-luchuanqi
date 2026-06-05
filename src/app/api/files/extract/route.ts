import { NextResponse } from "next/server";
import mammoth from "mammoth";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FileStructureSummary } from "@/utils/excel-tools";

export const runtime = "nodejs";
export const maxDuration = 120;

const require = createRequire(import.meta.url);

function getPdfWorkerCandidates(): string[] {
  const candidates = new Set<string>();

  try {
    const pdfParseEntry = require.resolve("pdf-parse");
    const packageFormatDir = path.dirname(pdfParseEntry);
    candidates.add(path.join(packageFormatDir, "pdf.worker.mjs"));
    candidates.add(path.join(packageFormatDir, "..", "esm", "pdf.worker.mjs"));
    candidates.add(path.join(packageFormatDir, "..", "cjs", "pdf.worker.mjs"));
    candidates.add(path.join(packageFormatDir, "..", "..", "worker", "pdf.worker.mjs"));
  } catch {
    // Fall back to cwd-based paths below. This keeps the route catchable in bundled deployments.
  }

  candidates.add(
    path.join(process.cwd(), "node_modules", "pdf-parse", "dist", "pdf-parse", "cjs", "pdf.worker.mjs"),
  );
  candidates.add(
    path.join(process.cwd(), "node_modules", "pdf-parse", "dist", "pdf-parse", "esm", "pdf.worker.mjs"),
  );
  candidates.add(path.join(process.cwd(), "node_modules", "pdf-parse", "dist", "worker", "pdf.worker.mjs"));

  return [...candidates];
}

function resolvePdfWorkerPath(): string {
  const workerPath = getPdfWorkerCandidates().find((candidate) => fs.existsSync(candidate));

  if (!workerPath) {
    throw new Error("PDF 抽取组件未随线上包部署，请重新部署后再上传 PDF");
  }

  return workerPath;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(pathToFileURL(resolvePdfWorkerPath()).href);

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

function inferFileType(fileName: string): string {
  if (/\.(docx)$/i.test(fileName)) {
    return "word";
  }
  if (/\.(pdf)$/i.test(fileName)) {
    return "pdf";
  }
  return "unknown";
}

function buildTextSummary(fileName: string, fileType: string, text: string): FileStructureSummary {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    fileName,
    fileType,
    sheets: [
      {
        name: fileType === "pdf" ? "PDF文本" : "Word文本",
        rowCount: lines.length,
        columnCount: 1,
        sampleRows: lines.slice(0, 40).map((line) => [line]),
      },
    ],
    textPreview: lines.slice(0, 160).join("\n").slice(0, 12_000),
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    }

    const fileType = inferFileType(file.name);
    if (fileType === "unknown") {
      return NextResponse.json({ error: "仅支持 Word .docx 和 PDF 文件抽取" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (fileType === "word") {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      text = await extractPdfText(buffer);
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "文件文本为空，无法继续解析" }, { status: 400 });
    }

    return NextResponse.json({
      summary: buildTextSummary(file.name, fileType, text),
      text: text.slice(0, 80_000),
    });
  } catch (error) {
    console.error("File extract error:", error);
    const message = error instanceof Error ? error.message : "文件抽取失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
