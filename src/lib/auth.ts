import { CognitoJwtVerifier } from "aws-jwt-verify";
import { NextRequest } from "next/server";
import prisma from "@/lib/db";

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  tokenUse: "access",
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
});

export interface AuthenticatedUser {
  userId: string;
  cognitoId: string;
  siteRole: string;
}

export async function getAuthenticatedUser(
  req: NextRequest
): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    const token = authHeader.slice(7);
    const payload = await verifier.verify(token);
    const cognitoId = payload.sub;

    const user = await prisma.user.findUnique({
      where: { cognitoId },
      select: { id: true, cognitoId: true, siteRole: true },
    });

    if (!user || !user.cognitoId) return null;

    return {
      userId: user.id,
      cognitoId: user.cognitoId,
      siteRole: user.siteRole,
    };
  } catch {
    return null;
  }
}
