import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildOrderSkuKey, formatOrderSkuIdentity } from "@/utils/order-identity";

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

function findDuplicatedOrderSkuIndex(orders: IncomingOrder[]): { firstIndex: number; indexes: number[] } | null {
  const bucket = new Map<string, number[]>();

  orders.forEach((order, index) => {
    const key = buildOrderSkuKey(order);
    if (!key) {
      return;
    }

    const indexes = bucket.get(key) ?? [];
    indexes.push(index);
    bucket.set(key, indexes);
  });

  for (const indexes of bucket.values()) {
    if (indexes.length > 1) {
      return { firstIndex: indexes[0], indexes };
    }
  }

  return null;
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

    const externalCodes = [
      ...new Set(
        orders
          .map((order) => order.externalCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ];
    const skuLineCounts =
      externalCodes.length > 0
        ? await prisma.order.groupBy({
            by: ["externalCode"],
            where: {
              AND: [...conditions, { externalCode: { in: externalCodes } }],
            },
            _count: { _all: true },
          })
        : [];
    const lineCountMap = new Map(
      skuLineCounts.map((item) => [item.externalCode, item._count._all]),
    );
    const data = orders.map((order) => ({
      ...order,
      skuLineCount: order.externalCode ? lineCountMap.get(order.externalCode) ?? 1 : 1,
    }));

    return NextResponse.json({ data, total });
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

    const duplicatedBatch = findDuplicatedOrderSkuIndex(normalized);
    if (duplicatedBatch) {
      const rowLabels = duplicatedBatch.indexes.map((index) => index + 1).join(", ");
      return NextResponse.json(
        {
          error: `同一批次中 ${formatOrderSkuIdentity(normalized[duplicatedBatch.firstIndex])} 重复，涉及第 ${rowLabels} 条`,
        },
        { status: 400 },
      );
    }

    const externalCodes = [
      ...new Set(
        normalized
          .map((order) => order.externalCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ];
    const skuCodes = [...new Set(normalized.map((order) => order.skuCode).filter(Boolean))];

    if (externalCodes.length > 0 && skuCodes.length > 0) {
      const requestedKeys = new Set(normalized.map((order) => buildOrderSkuKey(order)).filter(Boolean));
      const existing = await prisma.order.findMany({
        where: {
          externalCode: { in: externalCodes },
          skuCode: { in: skuCodes },
        },
        select: { externalCode: true, skuCode: true },
      });
      const existingKeys = new Set(existing.map((order) => buildOrderSkuKey(order)));
      const duplicatedExisting = normalized.find((order) => existingKeys.has(buildOrderSkuKey(order)));

      if (duplicatedExisting && requestedKeys.has(buildOrderSkuKey(duplicatedExisting))) {
        return NextResponse.json(
          { error: `${formatOrderSkuIdentity(duplicatedExisting)} 已在数据库存在，请勿重复提交` },
          { status: 400 },
        );
      }
    }

    const result = await prisma.order.createMany({
      data: normalized,
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Order bulk insert error:", error);
    return NextResponse.json({ error: "提交下单失败" }, { status: 500 });
  }
}
