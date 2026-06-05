import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildOrderSkuKey } from "@/utils/order-identity";

interface DuplicateCheckItem {
  externalCode?: unknown;
  skuCode?: unknown;
}

function isRecoverableOrderStorageError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "P1001" || code === "P2021" || message.includes("Order");
}

export async function POST(request: Request) {
  try {
    const { codes, items } = (await request.json()) as {
      codes?: unknown[];
      items?: DuplicateCheckItem[];
    };

    if (Array.isArray(items) && items.length > 0) {
      const requestedKeys = new Set(items.map((item) => buildOrderSkuKey(item)).filter(Boolean));

      if (requestedKeys.size === 0) {
        return NextResponse.json({ duplicates: [], duplicateKeys: [] });
      }

      const externalCodes = [
        ...new Set(
          items
            .map((item) => String(item.externalCode ?? "").trim())
            .filter(Boolean),
        ),
      ];
      const skuCodes = [
        ...new Set(
          items
            .map((item) => String(item.skuCode ?? "").trim())
            .filter(Boolean),
        ),
      ];

      const existing = await prisma.order.findMany({
        where: {
          externalCode: { in: externalCodes },
          skuCode: { in: skuCodes },
        },
        select: { externalCode: true, skuCode: true },
      });

      const duplicateKeys = [
        ...new Set(
          existing
            .map((order) => buildOrderSkuKey(order))
            .filter((key) => requestedKeys.has(key)),
        ),
      ];

      return NextResponse.json({ duplicates: duplicateKeys, duplicateKeys });
    }

    const legacyCodes = Array.isArray(codes)
      ? [
          ...new Set(
            codes
              .map((code) => String(code ?? "").trim())
              .filter(Boolean),
          ),
        ]
      : [];

    if (legacyCodes.length === 0) {
      return NextResponse.json({ duplicates: [], duplicateKeys: [] });
    }

    const existing = await prisma.order.findMany({
      where: {
        externalCode: { in: legacyCodes },
      },
      select: { externalCode: true },
    });

    const duplicates = existing
      .map((order: { externalCode: string | null }) => order.externalCode)
      .filter((code: string | null): code is string => Boolean(code));

    return NextResponse.json({ duplicates, duplicateKeys: [] });
  } catch (error) {
    console.error("Check duplicates error:", error);
    if (isRecoverableOrderStorageError(error)) {
      return NextResponse.json({
        duplicates: [],
        duplicateKeys: [],
        warning: "数据库暂不可用，已跳过历史外部编码重复检测",
      });
    }
    return NextResponse.json({ error: "Failed to check duplicates" }, { status: 500 });
  }
}
