import { NextRequest } from "next/server";
import prisma from "@/lib/db";

export interface AuthenticatedUser {
  userId: string;
  cognitoId: string;
  siteRole: string;
}

export async function getAuthenticatedUser(
  _req: NextRequest
): Promise<AuthenticatedUser | null> {
  // For now, always return the dev user — auth will be added later
  const user = await prisma.user.findFirst({
    where: { cognitoId: "dev-local-user" },
    select: { id: true, cognitoId: true, siteRole: true },
  });
  if (!user || !user.cognitoId) return null;
  return {
    userId: user.id,
    cognitoId: user.cognitoId,
    siteRole: user.siteRole,
  };
}
