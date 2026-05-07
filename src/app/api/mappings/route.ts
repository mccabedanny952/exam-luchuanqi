import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fingerprint = searchParams.get("fingerprint");

  if (!fingerprint) {
    return NextResponse.json({ error: "Fingerprint is required" }, { status: 400 });
  }

  try {
    const mapping = await prisma.templateMapping.findUnique({
      where: { fingerprint },
    });

    return NextResponse.json(mapping ?? {});
  } catch {
    return NextResponse.json({ error: "Failed to fetch mapping" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { fingerprint, mapping } = await request.json();

    if (!fingerprint || !mapping) {
      return NextResponse.json(
        { error: "Fingerprint and mapping are required" },
        { status: 400 },
      );
    }

    const saved = await prisma.templateMapping.upsert({
      where: { fingerprint },
      update: { mapping },
      create: { fingerprint, mapping },
    });

    return NextResponse.json(saved);
  } catch {
    return NextResponse.json({ error: "Failed to save mapping" }, { status: 500 });
  }
}
