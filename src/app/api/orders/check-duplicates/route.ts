import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function isRecoverableOrderStorageError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "P1001" || code === "P2021" || message.includes("Order");
}

export async function POST(request: Request) {
  try {
    const { codes } = await request.json();

    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    const existing = await prisma.order.findMany({
      where: {
        externalCode: { in: codes },
      },
      select: { externalCode: true },
    });

    const duplicates = existing
      .map((order: { externalCode: string | null }) => order.externalCode)
      .filter((code: string | null): code is string => Boolean(code));

    return NextResponse.json({ duplicates });
  } catch (error) {
    console.error("Check duplicates error:", error);
    if (isRecoverableOrderStorageError(error)) {
      return NextResponse.json({
        duplicates: [],
        warning: "数据库暂不可用，已跳过历史外部编码重复检测",
      });
    }
    return NextResponse.json({ error: "Failed to check duplicates" }, { status: 500 });
  }
}
