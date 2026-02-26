import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

export async function GET(req: NextRequest) {
  const authUser = await getAuthenticatedUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const challenge = await prisma.dailyChallenge.findUnique({
    where: { date: today },
    include: {
      image1: { select: { id: true, tmdbFilePath: true, width: true, height: true } },
      image2: { select: { id: true, tmdbFilePath: true, width: true, height: true } },
      image3: { select: { id: true, tmdbFilePath: true, width: true, height: true } },
    },
  });

  if (!challenge) {
    return NextResponse.json(
      { error: "No challenge available today" },
      { status: 404 }
    );
  }

  // Check if user already has a session for today
  const existingSession = await prisma.guessSession.findUnique({
    where: {
      userId_dailyChallengeId: {
        userId: authUser.userId,
        dailyChallengeId: challenge.id,
      },
    },
    include: {
      guesses: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          guessText: true,
          matchedCategory: true,
          matchedValue: true,
          isCorrect: true,
          createdAt: true,
        },
      },
    },
  });

  const currentImageIndex = existingSession?.currentImageIndex ?? 0;

  // Build images array — only reveal up to the user's current index
  const allImages = [challenge.image1, challenge.image2, challenge.image3];
  const revealedImages = allImages.slice(0, currentImageIndex + 1).map((img) => ({
    ...img,
    imageUrl: `${TMDB_IMAGE_BASE}${img.tmdbFilePath}`,
  }));

  return NextResponse.json({
    challengeId: challenge.id,
    date: challenge.date,
    images: revealedImages,
    currentImageIndex,
    totalImages: 3,
    session: existingSession
      ? {
          id: existingSession.id,
          score: existingSession.score,
          completedAt: existingSession.completedAt,
          guesses: existingSession.guesses,
        }
      : null,
  });
}
