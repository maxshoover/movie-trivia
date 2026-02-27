import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
const REVEAL_PENALTY = 1;
const MAX_IMAGE_INDEX = 2; // 0, 1, 2 = 3 images

export async function POST(req: NextRequest) {
  const authUser = await getAuthenticatedUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { challengeId } = await req.json();

  if (!challengeId) {
    return NextResponse.json(
      { error: "challengeId is required" },
      { status: 400 }
    );
  }

  const challenge = await prisma.dailyChallenge.findUnique({
    where: { id: challengeId },
    include: {
      image1: { select: { id: true, tmdbFilePath: true, width: true, height: true } },
      image2: { select: { id: true, tmdbFilePath: true, width: true, height: true } },
      image3: { select: { id: true, tmdbFilePath: true, width: true, height: true } },
    },
  });

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  // Get or create session
  let session = await prisma.guessSession.findUnique({
    where: {
      userId_dailyChallengeId: {
        userId: authUser.userId,
        dailyChallengeId: challengeId,
      },
    },
  });

  if (!session) {
    session = await prisma.guessSession.create({
      data: {
        userId: authUser.userId,
        dailyChallengeId: challengeId,
      },
    });
  }

  if (session.completedAt) {
    return NextResponse.json(
      { error: "Challenge already completed" },
      { status: 400 }
    );
  }

  if (session.currentImageIndex >= MAX_IMAGE_INDEX) {
    return NextResponse.json(
      { error: "All images already revealed" },
      { status: 400 }
    );
  }

  // Reveal next image: increment index, deduct penalty
  const updatedSession = await prisma.guessSession.update({
    where: { id: session.id },
    data: {
      currentImageIndex: { increment: 1 },
      score: { decrement: REVEAL_PENALTY },
    },
  });

  // Return the newly revealed image
  const allImages = [challenge.image1, challenge.image2, challenge.image3];
  const newImage = allImages[updatedSession.currentImageIndex];

  return NextResponse.json({
    currentImageIndex: updatedSession.currentImageIndex,
    score: updatedSession.score,
    penaltyApplied: REVEAL_PENALTY,
    newImage: {
      ...newImage,
      imageUrl: newImage.tmdbFilePath.startsWith("http")
        ? newImage.tmdbFilePath
        : `${TMDB_IMAGE_BASE}${newImage.tmdbFilePath}`,
    },
  });
}
