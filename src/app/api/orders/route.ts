import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const orders = await request.json();

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { error: "Payload must be a non-empty array" },
        { status: 400 },
      );
    }

    const result = await prisma.order.createMany({
      data: orders,
      skipDuplicates: true,
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Order bulk insert error:", error);
    return NextResponse.json({ error: "Failed to insert orders" }, { status: 500 });
  }
}
