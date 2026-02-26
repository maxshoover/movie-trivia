import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { cognitoId, email, name } = await req.json();

    if (!cognitoId || !email) {
      return NextResponse.json(
        { error: "cognitoId and email are required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.upsert({
      where: { cognitoId },
      update: { email, name: name || email },
      create: { cognitoId, email, name: name || email },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Auth sync error:", error);
    return NextResponse.json(
      { error: "Failed to sync user" },
      { status: 500 }
    );
  }
}
