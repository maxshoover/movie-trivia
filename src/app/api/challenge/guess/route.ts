import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { findBestMatch } from "@/lib/fuzzyMatch";

export async function POST(req: NextRequest) {
  const authUser = await getAuthenticatedUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { challengeId, guessText } = await req.json();

  if (!challengeId || !guessText?.trim()) {
    return NextResponse.json(
      { error: "challengeId and guessText are required" },
      { status: 400 }
    );
  }

  // Get the challenge with movie data and all 3 images
  const challenge = await prisma.dailyChallenge.findUnique({
    where: { id: challengeId },
    include: {
      movie: {
        include: {
          credits: true,
        },
      },
      image1: { include: { imageActors: { include: { credit: true } } } },
      image2: { include: { imageActors: { include: { credit: true } } } },
      image3: { include: { imageActors: { include: { credit: true } } } },
    },
  });

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  // Get or create the guess session
  let session = await prisma.guessSession.findUnique({
    where: {
      userId_dailyChallengeId: {
        userId: authUser.userId,
        dailyChallengeId: challengeId,
      },
    },
    include: { guesses: true },
  });

  if (!session) {
    session = await prisma.guessSession.create({
      data: {
        userId: authUser.userId,
        dailyChallengeId: challengeId,
      },
      include: { guesses: true },
    });
  }

  if (session.completedAt) {
    return NextResponse.json(
      { error: "Challenge already completed" },
      { status: 400 }
    );
  }

  // Build match candidates
  // For actors: use image-specific actors from all revealed images if curated, otherwise full cast
  const revealedImages = [challenge.image1, challenge.image2, challenge.image3]
    .slice(0, (session.currentImageIndex ?? 0) + 1);
  const allImageActors = revealedImages.flatMap((img) => img.imageActors);
  const actorCredits =
    allImageActors.length > 0
      ? allImageActors.map((ia) => ia.credit)
      : challenge.movie.credits.filter((c) => c.role === "ACTOR");

  const candidates = [
    { value: challenge.movie.title, category: "TITLE" as const },
    ...challenge.movie.credits
      .filter((c) => c.role === "DIRECTOR")
      .map((c) => ({ value: c.personName, category: "DIRECTOR" as const })),
    ...challenge.movie.credits
      .filter((c) => c.role === "WRITER")
      .map((c) => ({ value: c.personName, category: "WRITER" as const })),
    ...actorCredits.map((c) => ({
      value: c.personName,
      category: "ACTOR" as const,
    })),
  ];

  // Check if this category was already guessed correctly
  const alreadyGuessed = session.guesses
    .filter((g) => g.isCorrect)
    .map((g) => `${g.matchedCategory}:${g.matchedValue}`);

  const match = findBestMatch(guessText.trim(), candidates);

  // Check for duplicate correct guess
  const isDuplicate =
    match.matched &&
    alreadyGuessed.includes(`${match.category}:${match.matchedValue}`);

  const isCorrect = match.matched && !isDuplicate;

  // Save the guess
  const guess = await prisma.guess.create({
    data: {
      sessionId: session.id,
      guessText: guessText.trim(),
      matchedCategory: isCorrect ? match.category : null,
      matchedValue: isCorrect ? match.matchedValue : null,
      isCorrect,
    },
  });

  // Update score if correct
  if (isCorrect) {
    await prisma.guessSession.update({
      where: { id: session.id },
      data: { score: { increment: 1 } },
    });
  }

  return NextResponse.json({
    guess: {
      id: guess.id,
      guessText: guess.guessText,
      matchedCategory: guess.matchedCategory,
      matchedValue: guess.matchedValue,
      isCorrect: guess.isCorrect,
    },
    isDuplicate,
    sessionScore: session.score + (isCorrect ? 1 : 0),
  });
}
