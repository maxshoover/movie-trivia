"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/authFetch";

interface GuessResult {
  id: string;
  guessText: string;
  matchedCategory: string | null;
  matchedValue: string | null;
  isCorrect: boolean;
}

interface ChallengeImage {
  id: string;
  tmdbFilePath: string;
  imageUrl: string;
  width: number;
  height: number;
}

interface ChallengeData {
  challengeId: string;
  date: string;
  images: ChallengeImage[];
  currentImageIndex: number;
  totalImages: number;
  session: {
    id: string;
    score: number;
    completedAt: string | null;
    guesses: GuessResult[];
  } | null;
}

interface Answers {
  title: string;
  directors: string[];
  writers: string[];
  actors: { name: string; character: string | null }[];
}

export default function GamePage() {
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [guesses, setGuesses] = useState<GuessResult[]>([]);
  const [guessInput, setGuessInput] = useState("");
  const [score, setScore] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [images, setImages] = useState<ChallengeImage[]>([]);
  const [viewingImageIndex, setViewingImageIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadChallenge = useCallback(async () => {
    try {
      const res = await authFetch("/api/challenge/today");
      if (!res.ok) {
        if (res.status === 404) {
          setError("No challenge available today. Check back tomorrow!");
          return;
        }
        throw new Error("Failed to load challenge");
      }
      const data: ChallengeData = await res.json();
      setChallenge(data);
      setImages(data.images);
      setCurrentImageIndex(data.currentImageIndex);
      setViewingImageIndex(data.currentImageIndex);
      if (data.session) {
        setGuesses(data.session.guesses);
        setScore(data.session.score);
        if (data.session.completedAt) {
          setShowResults(true);
        }
      }
    } catch {
      setError("Failed to load today's challenge");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChallenge();
  }, [loadChallenge]);

  const submitGuess = async () => {
    if (!challenge || !guessInput.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await authFetch("/api/challenge/guess", {
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          guessText: guessInput.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to submit guess");

      const data = await res.json();
      setGuesses((prev) => [...prev, data.guess]);
      setScore(data.sessionScore);
      setGuessInput("");
    } catch {
      setError("Failed to submit guess");
    } finally {
      setIsSubmitting(false);
    }
  };

  const revealNextImage = async () => {
    if (!challenge || isRevealing || currentImageIndex >= challenge.totalImages - 1)
      return;

    setIsRevealing(true);
    try {
      const res = await authFetch("/api/challenge/reveal", {
        method: "POST",
        body: JSON.stringify({ challengeId: challenge.challengeId }),
      });

      if (!res.ok) throw new Error("Failed to reveal image");

      const data = await res.json();
      setImages((prev) => [...prev, data.newImage]);
      setCurrentImageIndex(data.currentImageIndex);
      setViewingImageIndex(data.currentImageIndex);
      setScore(data.score);
    } catch {
      setError("Failed to reveal next image");
    } finally {
      setIsRevealing(false);
    }
  };

  const revealAnswers = async () => {
    if (!challenge) return;
    try {
      const res = await authFetch(
        `/api/challenge/results?challengeId=${challenge.challengeId}`
      );
      if (res.ok) {
        const data = await res.json();
        setAnswers(data.answers);
        setShowResults(true);
      }
    } catch {
      setError("Failed to load results");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <p className="text-lg">Loading...</p>
      </div>
    );
  }

  if (error && !challenge) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white gap-4">
        <h1 className="text-4xl font-bold">🎬 Flick Pics</h1>
        <p className="text-gray-400">{error}</p>
      </div>
    );
  }

  const canRevealMore = challenge && currentImageIndex < challenge.totalImages - 1;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🎬 Flick Pics</h1>
        <div className="flex items-center gap-4">
          <span className="text-amber-400 font-semibold">Score: {score}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {challenge && images.length > 0 && (
          <>
            {/* Image Counter & Navigation */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setViewingImageIndex(i)}
                    className={`w-3 h-3 rounded-full transition ${
                      i === viewingImageIndex
                        ? "bg-amber-400"
                        : "bg-gray-600 hover:bg-gray-500"
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm text-gray-500">
                Still {viewingImageIndex + 1} of {challenge.totalImages}
              </span>
            </div>

            {/* Movie Image */}
            <div className="mb-6 rounded-xl overflow-hidden shadow-2xl relative">
              <img
                src={images[viewingImageIndex].imageUrl}
                alt="Guess this movie"
                className="w-full h-auto"
              />
            </div>

            {/* Reveal Next Image Button */}
            {!showResults && canRevealMore && (
              <div className="mb-6 text-center">
                <button
                  onClick={revealNextImage}
                  disabled={isRevealing}
                  className="px-5 py-2 bg-gray-800 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 hover:border-gray-500 disabled:opacity-50 transition text-sm"
                >
                  {isRevealing
                    ? "Revealing..."
                    : `Reveal next still (−1 point)`}
                </button>
              </div>
            )}

            {/* Guess Input */}
            {!showResults && (
              <div className="mb-8">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={guessInput}
                    onChange={(e) => setGuessInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                    placeholder="Guess the movie title, director, actor, or writer..."
                    className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
                    disabled={isSubmitting}
                  />
                  <button
                    onClick={submitGuess}
                    disabled={isSubmitting || !guessInput.trim()}
                    className="px-6 py-3 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Guess
                  </button>
                </div>
                <button
                  onClick={revealAnswers}
                  className="mt-3 text-sm text-gray-500 hover:text-gray-300 transition"
                >
                  Give up &amp; reveal answers
                </button>
              </div>
            )}

            {/* Guesses List */}
            {guesses.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Your Guesses</h2>
                <div className="space-y-2">
                  {guesses.map((g, i) => (
                    <div
                      key={g.id || i}
                      className={`flex items-center gap-3 px-4 py-2 rounded-lg ${
                        g.isCorrect
                          ? "bg-green-900/40 border border-green-700"
                          : "bg-gray-800/60 border border-gray-700"
                      }`}
                    >
                      <span className={g.isCorrect ? "text-green-400" : "text-red-400"}>
                        {g.isCorrect ? "✓" : "✗"}
                      </span>
                      <span className="flex-1">{g.guessText}</span>
                      {g.isCorrect && (
                        <span className="text-sm text-green-400 font-medium">
                          {g.matchedCategory} — {g.matchedValue}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Results */}
            {showResults && answers && (
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
                <h2 className="text-xl font-semibold mb-4">Answers</h2>
                <div className="space-y-3">
                  <div>
                    <span className="text-gray-400 text-sm">Title:</span>
                    <p className="text-lg font-medium">{answers.title}</p>
                  </div>
                  <div>
                    <span className="text-gray-400 text-sm">Director(s):</span>
                    <p>{answers.directors.join(", ") || "Unknown"}</p>
                  </div>
                  <div>
                    <span className="text-gray-400 text-sm">Writer(s):</span>
                    <p>{answers.writers.join(", ") || "Unknown"}</p>
                  </div>
                  <div>
                    <span className="text-gray-400 text-sm">Actors:</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {answers.actors.map((a, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 bg-gray-700 rounded text-sm"
                        >
                          {a.name}
                          {a.character && (
                            <span className="text-gray-400"> as {a.character}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-6 text-amber-400 text-lg font-semibold">
                  Final Score: {score}
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {/* TMDb Attribution */}
      <footer className="text-center py-4 text-xs text-gray-600">
        This product uses the TMDb API but is not endorsed or certified by TMDb.
      </footer>
    </div>
  );
}
