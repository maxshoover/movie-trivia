const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const crypto = require("crypto");

const TMDB_BASE = "https://api.themoviedb.org/3";
const API_KEY = process.env.TMDB_API_KEY;

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

  // Create a dev user
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

  // Fetch popular movies — we need ones with 3+ backdrops
  console.log("Fetching popular movies from TMDb...");
  const seededMovies = [];

  for (let page = 1; page <= 3 && seededMovies.length < 10; page++) {
    const popular = await tmdbFetch(`/movie/popular?page=${page}`);

    for (const m of popular.results) {
      if (seededMovies.length >= 10) break;

      try {
        const [details, credits, images] = await Promise.all([
          tmdbFetch(`/movie/${m.id}`),
          tmdbFetch(`/movie/${m.id}/credits`),
          tmdbFetch(`/movie/${m.id}/images`),
        ]);

        const backdrops = images.backdrops.filter(
          (b) => b.width >= 1280 && b.aspect_ratio > 1.5 && b.iso_639_1 === null
        );
        if (backdrops.length < 3) {
          console.log(`  Skipping ${details.title} (only ${backdrops.length} backdrops)`);
          continue;
        }

        const movie = await prisma.movie.upsert({
          where: { tmdbId: m.id },
          update: {},
          create: {
            id: crypto.randomUUID(),
            tmdbId: m.id,
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
          (c) =>
            c.job === "Screenplay" ||
            c.job === "Writer" ||
            c.department === "Writing"
        );
        const uniqueWriters = [
          ...new Map(writers.map((w) => [w.id, w])).values(),
        ];
        const actors = credits.cast.slice(0, 15);

        const allCredits = [
          ...directors.map((d) => ({
            name: d.name,
            role: "DIRECTOR",
            character: null,
            tmdbPersonId: d.id,
          })),
          ...uniqueWriters.map((w) => ({
            name: w.name,
            role: "WRITER",
            character: null,
            tmdbPersonId: w.id,
          })),
          ...actors.map((a) => ({
            name: a.name,
            role: "ACTOR",
            character: a.character,
            tmdbPersonId: a.id,
          })),
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
            where: {
              movieId_tmdbFilePath: {
                movieId: movie.id,
                tmdbFilePath: backdrop.file_path,
              },
            },
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

        console.log(
          `  ✓ ${details.title} (${details.release_date?.substring(0, 4)}) — ${allCredits.length} credits, ${savedImages.length} images`
        );
        seededMovies.push({ movie, images: savedImages });
      } catch (err) {
        console.error(`  ✗ Error processing ${m.title}:`, err.message);
      }
    }
  }

  // Create today's challenge from the first movie with 3+ images
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const existing = await prisma.dailyChallenge.findUnique({
    where: { date: today },
  });

  if (!existing && seededMovies.length > 0) {
    const pick = seededMovies[0];
    await prisma.dailyChallenge.create({
      data: {
        id: crypto.randomUUID(),
        date: today,
        movieId: pick.movie.id,
        image1Id: pick.images[0].id,
        image2Id: pick.images[1].id,
        image3Id: pick.images[2].id,
      },
    });
    console.log(`\n🎬 Today's challenge: "${pick.movie.title}"`);
  } else if (existing) {
    console.log("\nToday's challenge already exists.");
  }

  console.log(`\nSeeded ${seededMovies.length} movies. Ready to play!`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
