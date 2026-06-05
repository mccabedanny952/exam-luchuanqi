import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FileStructureSummary } from "@/utils/excel-tools";

export const runtime = "nodejs";

const PDF_WORKER_PATH = path.join(
  process.cwd(),
  "node_modules",
  "pdf-parse",
  "dist",
  "pdf-parse",
  "esm",
  "pdf.worker.mjs",
);

function configurePdfWorker() {
  PDFParse.setWorker(pathToFileURL(PDF_WORKER_PATH).href);
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
      configurePdfWorker();
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        text = result.text;
      } finally {
        await parser.destroy();
      }
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
