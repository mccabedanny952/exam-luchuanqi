import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function isRecoverableRuleStorageError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "P2021" || code === "P1001" || message.includes("ParsingRule");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fingerprint = searchParams.get("fingerprint");

  try {
    if (!fingerprint) {
      const rules = await prisma.parsingRule.findMany({
        orderBy: { updatedAt: "desc" },
        take: 50,
      });

      return NextResponse.json({ data: rules });
    }

    const savedRule = await prisma.parsingRule.findUnique({
      where: { fingerprint },
    });

    return NextResponse.json(savedRule ?? {});
  } catch (error) {
    console.error("Rule fetch error:", error);
    if (isRecoverableRuleStorageError(error)) {
      return NextResponse.json({ data: [], warning: "规则库暂不可用，仍可校准字段并生成明细" });
    }
    return NextResponse.json({ error: "规则库读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { fingerprint, rule, name, fileType, mode } = await request.json();

    if (!fingerprint || !rule) {
      return NextResponse.json({ error: "规则指纹和规则内容不能为空" }, { status: 400 });
    }

    const normalizedRule = typeof rule === "string" ? rule : JSON.stringify(rule);
    const parsedRule = typeof rule === "string" ? JSON.parse(rule) : rule;
    const saved = await prisma.parsingRule.upsert({
      where: { fingerprint },
      update: {
        name: name || parsedRule.name || "未命名字段规则",
        fileType: fileType || "spreadsheet",
        mode: mode || parsedRule.mode || "column",
        rule: normalizedRule,
      },
      create: {
        fingerprint,
        name: name || parsedRule.name || "未命名字段规则",
        fileType: fileType || "spreadsheet",
        mode: mode || parsedRule.mode || "column",
        rule: normalizedRule,
      },
    });

    return NextResponse.json(saved);
  } catch (error) {
    console.error("Rule save error:", error);
    if (isRecoverableRuleStorageError(error)) {
      return NextResponse.json(
        { warning: "规则库暂不可用，本次字段规则未持久化" },
        { status: 202 },
      );
    }
    return NextResponse.json({ error: "字段规则保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const fingerprint = searchParams.get("fingerprint");

  if (!id && !fingerprint) {
    return NextResponse.json({ error: "规则 id 或指纹不能为空" }, { status: 400 });
  }

  try {
    if (id) {
      await prisma.parsingRule.delete({ where: { id } });
    } else if (fingerprint) {
      await prisma.parsingRule.delete({ where: { fingerprint } });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Rule delete error:", error);
    return NextResponse.json({ error: "字段规则移除失败" }, { status: 500 });
  }
}
