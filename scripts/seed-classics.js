require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const crypto = require("crypto");

const TMDB_BASE = "https://api.themoviedb.org/3";
const API_KEY = process.env.TMDB_API_KEY;

// Classic/well-known movies that have real scene stills on TMDb
const CLASSIC_MOVIE_IDS = [
  550,    // Fight Club
  680,    // Pulp Fiction
  155,    // The Dark Knight
  238,    // The Godfather
  13,     // Forrest Gump
  120,    // The Lord of the Rings: Fellowship
  278,    // The Shawshank Redemption
  424,    // Schindler's List
  769,    // GoodFellas
  597,    // Titanic
  11,     // Star Wars
  105,    // Back to the Future
  603,    // The Matrix
  857,    // Saving Private Ryan
  389,    // 12 Angry Men
  274,    // The Silence of the Lambs
  510,    // One Flew Over the Cuckoo's Nest
  311,    // Once Upon a Time in America
  240,    // The Godfather Part II
  807,    // Se7en
];

async function tmdbFetch(path) {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${TMDB_BASE}${path}${separator}api_key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDb error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
  const prisma = new PrismaClient({ adapter });

  // Create dev user
  const devUser = await prisma.user.upsert({
    where: { email: "dev@flickpick.local" },
    update: {},
    create: {
      id: crypto.randomUUID(),
      email: "dev@flickpick.local",
      name: "Dev Player",
      cognitoId: "dev-local-user",
      siteRole: "ADMIN",
    },
  });
  console.log(`Dev user: ${devUser.name} (${devUser.id})`);

  console.log("Fetching classic movies from TMDb...");
  const seededMovies = [];

  for (const tmdbId of CLASSIC_MOVIE_IDS) {
    try {
      const [details, credits, images] = await Promise.all([
        tmdbFetch(`/movie/${tmdbId}`),
        tmdbFetch(`/movie/${tmdbId}/credits`),
        tmdbFetch(`/movie/${tmdbId}/images`),
      ]);

      // Filter: no language tag, landscape, decent size
      // Sort by vote_count ascending — lower-voted = more likely real screenshots
      const backdrops = images.backdrops
        .filter((b) => b.width >= 1280 && b.aspect_ratio > 1.5 && b.iso_639_1 === null)
        .sort((a, b) => (a.vote_count || 0) - (b.vote_count || 0));

      if (backdrops.length < 3) {
        console.log(`  Skipping ${details.title} (only ${backdrops.length} scene stills)`);
        continue;
      }

      const movie = await prisma.movie.upsert({
        where: { tmdbId },
        update: {},
        create: {
          id: crypto.randomUUID(),
          tmdbId,
          title: details.title,
          releaseYear: details.release_date
            ? parseInt(details.release_date.substring(0, 4))
            : null,
          overview: details.overview,
          popularity: details.popularity,
          voteAverage: details.vote_average,
        },
      });

      const directors = credits.crew.filter((c) => c.job === "Director");
      const writers = credits.crew.filter(
        (c) => c.job === "Screenplay" || c.job === "Writer" || c.department === "Writing"
      );
      const uniqueWriters = [...new Map(writers.map((w) => [w.id, w])).values()];
      const actors = credits.cast.slice(0, 15);

      const allCredits = [
        ...directors.map((d) => ({ name: d.name, role: "DIRECTOR", character: null, tmdbPersonId: d.id })),
        ...uniqueWriters.map((w) => ({ name: w.name, role: "WRITER", character: null, tmdbPersonId: w.id })),
        ...actors.map((a) => ({ name: a.name, role: "ACTOR", character: a.character, tmdbPersonId: a.id })),
      ];

      for (const credit of allCredits) {
        await prisma.movieCredit.upsert({
          where: {
            movieId_tmdbPersonId_role: {
              movieId: movie.id,
              tmdbPersonId: credit.tmdbPersonId,
              role: credit.role,
            },
          },
          update: { personName: credit.name, character: credit.character },
          create: {
            id: crypto.randomUUID(),
            movieId: movie.id,
            personName: credit.name,
            role: credit.role,
            character: credit.character,
            tmdbPersonId: credit.tmdbPersonId,
          },
        });
      }

      const savedImages = [];
      for (const backdrop of backdrops.slice(0, 10)) {
        const img = await prisma.movieImage.upsert({
          where: { movieId_tmdbFilePath: { movieId: movie.id, tmdbFilePath: backdrop.file_path } },
          update: {},
          create: {
            id: crypto.randomUUID(),
            movieId: movie.id,
            tmdbFilePath: backdrop.file_path,
            width: backdrop.width,
            height: backdrop.height,
            aspectRatio: backdrop.aspect_ratio,
          },
        });
        savedImages.push(img);
      }

      console.log(`  ✓ ${details.title} (${details.release_date?.substring(0, 4)}) — ${allCredits.length} credits, ${savedImages.length} stills`);
      seededMovies.push({ movie, images: savedImages });
    } catch (err) {
      console.error(`  ✗ Error processing tmdb:${tmdbId}:`, err.message);
    }
  }

  // Create today's challenge — pick a random classic
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Delete existing challenge for today
  await prisma.guessSession.deleteMany({ where: { challenge: { date: today } } });
  await prisma.dailyChallenge.deleteMany({ where: { date: today } });

  if (seededMovies.length > 0) {
    const pick = seededMovies[Math.floor(Math.random() * seededMovies.length)];
    // Pick 3 random images
    const shuffled = pick.images.sort(() => Math.random() - 0.5);
    await prisma.dailyChallenge.create({
      data: {
        id: crypto.randomUUID(),
        date: today,
        movieId: pick.movie.id,
        image1Id: shuffled[0].id,
        image2Id: shuffled[1].id,
        image3Id: shuffled[2].id,
      },
    });
    console.log(`\n🎬 Today's challenge: "${pick.movie.title}"`);
  }

  console.log(`\nSeeded ${seededMovies.length} classic movies. Ready to play!`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
