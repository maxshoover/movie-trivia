import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authUser = await getAuthenticatedUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const challengeId = searchParams.get("challengeId");

  if (!challengeId) {
    return NextResponse.json({ error: "challengeId required" }, { status: 400 });
  }

  // Get or create session so results work even with no guesses
  let session = await prisma.guessSession.findUnique({
    where: {
      userId_dailyChallengeId: {
        userId: authUser.userId,
        dailyChallengeId: challengeId,
      },
    },
    include: {
      guesses: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!session) {
    session = await prisma.guessSession.create({
      data: {
        userId: authUser.userId,
        dailyChallengeId: challengeId,
        completedAt: new Date(),
      },
      include: {
        guesses: { orderBy: { createdAt: "asc" } },
      },
    });
  } else if (!session.completedAt) {
    // Mark as completed on give-up
    session = await prisma.guessSession.update({
      where: { id: session.id },
      data: { completedAt: new Date() },
      include: {
        guesses: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  const challenge = await prisma.dailyChallenge.findUnique({
    where: { id: challengeId },
    include: {
      movie: {
        include: { credits: true },
      },
      image1: { include: { imageActors: { include: { credit: true } } } },
      image2: { include: { imageActors: { include: { credit: true } } } },
      image3: { include: { imageActors: { include: { credit: true } } } },
    },
  });

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  // Collect curated actors across all 3 images
  const allImageActors = [challenge.image1, challenge.image2, challenge.image3]
    .flatMap((img) => img.imageActors);
  const actorCredits =
    allImageActors.length > 0
      ? allImageActors.map((ia) => ia.credit)
      : challenge.movie.credits.filter((c) => c.role === "ACTOR");
  // Deduplicate actors by credit id
  const uniqueActors = [...new Map(actorCredits.map((c) => [c.id, c])).values()];

  return NextResponse.json({
    movie: {
      title: challenge.movie.title,
      releaseYear: challenge.movie.releaseYear,
      overview: challenge.movie.overview,
    },
    answers: {
      title: challenge.movie.title,
      directors: challenge.movie.credits
        .filter((c) => c.role === "DIRECTOR")
        .map((c) => c.personName),
      writers: challenge.movie.credits
        .filter((c) => c.role === "WRITER")
        .map((c) => c.personName),
      actors: uniqueActors.map((c) => ({
        name: c.personName,
        character: c.character,
      })),
    },
    session: {
      score: session.score,
      guesses: session.guesses,
      completedAt: session.completedAt,
    },
  });
}
