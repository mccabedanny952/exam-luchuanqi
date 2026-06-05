import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface IncomingOrder {
  externalCode?: string | null;
  storeName?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  skuCode?: string;
  skuName?: string;
  skuQuantity?: number;
  skuSpec?: string | null;
  remark?: string | null;
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const skip = parseInt(searchParams.get("skip") || "0", 10);
  const take = parseInt(searchParams.get("take") || "20", 10);
  const search = searchParams.get("search") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  try {
    const conditions: Array<Record<string, unknown>> = [];

    if (search) {
      conditions.push({
        OR: [
          { externalCode: { contains: search } },
          { receiverName: { contains: search } },
          { storeName: { contains: search } },
          { skuCode: { contains: search } },
          { skuName: { contains: search } },
        ],
      });
    }

    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) {
        createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      }
      if (dateTo) {
        createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
      }
      conditions.push({ createdAt });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.order.count({ where }),
    ]);

    return NextResponse.json({ data: orders, total });
  } catch (error) {
    console.error("Order fetch error:", error);
    return NextResponse.json({ error: "入库记录读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const orders = (await request.json()) as IncomingOrder[];

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ error: "提交数据不能为空" }, { status: 400 });
    }

    const normalized = orders.map((order) => ({
      externalCode: cleanText(order.externalCode),
      storeName: cleanText(order.storeName),
      receiverName: cleanText(order.receiverName),
      receiverPhone: cleanText(order.receiverPhone),
      receiverAddress: cleanText(order.receiverAddress),
      skuCode: String(order.skuCode ?? "").trim(),
      skuName: String(order.skuName ?? "").trim(),
      skuQuantity: Number(order.skuQuantity ?? 0),
      skuSpec: cleanText(order.skuSpec),
      remark: cleanText(order.remark),
    }));

    const invalidIndex = normalized.findIndex((order) => {
      const hasStore = Boolean(order.storeName);
      const hasReceiver = Boolean(order.receiverName && order.receiverPhone && order.receiverAddress);
      return !order.skuCode || !order.skuName || order.skuQuantity <= 0 || (!hasStore && !hasReceiver);
    });

    if (invalidIndex !== -1) {
      return NextResponse.json(
        { error: `第 ${invalidIndex + 1} 条数据未通过服务端校验` },
        { status: 400 },
      );
    }

    const result = await prisma.order.createMany({
      data: normalized,
      skipDuplicates: true,
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Order bulk insert error:", error);
    return NextResponse.json({ error: "提交下单失败" }, { status: 500 });
  }
}
