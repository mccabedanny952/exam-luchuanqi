import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    return NextResponse.json({ error: "Failed to check duplicates" }, { status: 500 });
  }
}
