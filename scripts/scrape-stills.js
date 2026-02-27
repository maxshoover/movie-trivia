/**
 * MovieStillsDB scraper — fetches real movie scene stills with actor-per-image metadata.
 * Rate-limited and respectful. Caches to local DB via Prisma.
 *
 * Usage: node scripts/scrape-stills.js
 * Requires TMDB_API_KEY in .env (used to map IMDb IDs to TMDb IDs)
 */
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const crypto = require("crypto");

const MSTILLSDB_BASE = "https://www.moviestillsdb.com";
const CDN_BASE = "https://cdn.moviestillsdb.com";
const TMDB_BASE = "https://api.themoviedb.org/3";
const API_KEY = process.env.TMDB_API_KEY;

// Rate limit: wait between requests
const DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Movies to scrape: [imdbId, tmdbId]
const MOVIES = [
  ["0068646", 238],    // The Godfather
  ["0071562", 240],    // The Godfather Part II
  ["0110912", 680],    // Pulp Fiction
  ["0137523", 550],    // Fight Club
  ["0468569", 155],    // The Dark Knight
  ["0109830", 13],     // Forrest Gump
  ["0120737", 120],    // LOTR: Fellowship
  ["0111161", 278],    // Shawshank Redemption
  ["0108052", 424],    // Schindler's List
  ["0099685", 769],    // GoodFellas
  ["0120338", 857],    // Saving Private Ryan
  ["0076759", 11],     // Star Wars
  ["0088763", 105],    // Back to the Future
  ["0133093", 603],    // The Matrix
  ["0102926", 274],    // Silence of the Lambs
  ["0114369", 807],    // Se7en
  ["0081505", 510],    // The Shining
  ["0073486", 578],    // One Flew Over the Cuckoo's Nest
  ["0071315", 829],    // Chinatown
  ["0082971", 679],    // Raiders of the Lost Ark
];

async function scrapeMoviePage(imdbId) {
  // MovieStillsDB uses IMDb IDs without leading zeros in URL but with 'i' prefix
  const trimmedId = imdbId.replace(/^0+/, "");
  // We need to find the movie slug. Try fetching by IMDb ID pattern
  const searchUrl = `${MSTILLSDB_BASE}/movies?q=tt${imdbId}`;

  // Actually, MovieStillsDB URLs use format: /movies/{slug}-i{imdbIdWithoutLeadingZeros}
  // But we don't know the slug. Let's fetch the search/redirect page
  const res = await fetch(`${MSTILLSDB_BASE}/movies/title-i${trimmedId}`, {
    redirect: "follow",
    headers: {
      "User-Agent": "FlickPics/1.0 (movie trivia game; educational use)",
    },
  });

  if (!res.ok) {
    // Try with leading zeros
    const res2 = await fetch(`${MSTILLSDB_BASE}/movies/title-i${imdbId}`, {
      redirect: "follow",
      headers: {
        "User-Agent": "FlickPics/1.0 (movie trivia game; educational use)",
      },
    });
    if (!res2.ok) {
      console.log(`  Could not find movie page for IMDb ${imdbId} (${res.status}/${res2.status})`);
      return null;
    }
    return parseMoviePage(await res2.text());
  }

  return parseMoviePage(await res.text());
}

function parseMoviePage(html) {
  // Extract the JSON data from the :initial-items Vue prop
  const match = html.match(/:initial-items="(\[.*?\])"/s);
  if (!match) {
    // Try alternate format
    const match2 = html.match(/:initial-items='(\[.*?\])'/s);
    if (!match2) return null;
    return JSON.parse(match2[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  }
  // Unescape HTML entities
  const jsonStr = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return JSON.parse(jsonStr);
}

async function tmdbFetch(path) {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${TMDB_BASE}${path}${separator}api_key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDb error ${res.status}`);
  return res.json();
}

async function main() {
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
  const prisma = new PrismaClient({ adapter });

  // Create dev user
  await prisma.user.upsert({
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

  console.log("Scraping MovieStillsDB for scene stills...\n");
  const seededMovies = [];

  for (const [imdbId, tmdbId] of MOVIES) {
    try {
      // Get movie details from TMDb (for title, credits, etc.)
      const [details, credits] = await Promise.all([
        tmdbFetch(`/movie/${tmdbId}`),
        tmdbFetch(`/movie/${tmdbId}/credits`),
      ]);

      console.log(`Scraping: ${details.title} (${details.release_date?.substring(0, 4)})...`);

      // Upsert movie
      const movie = await prisma.movie.upsert({
        where: { tmdbId },
        update: {},
        create: {
          id: crypto.randomUUID(),
          tmdbId,
          title: details.title,
          releaseYear: details.release_date ? parseInt(details.release_date.substring(0, 4)) : null,
          overview: details.overview,
          popularity: details.popularity,
          voteAverage: details.vote_average,
        },
      });

      // Upsert credits from TMDb
      const directors = credits.crew.filter((c) => c.job === "Director");
      const writers = credits.crew.filter((c) => c.job === "Screenplay" || c.job === "Writer" || c.department === "Writing");
      const uniqueWriters = [...new Map(writers.map((w) => [w.id, w])).values()];
      const actors = credits.cast.slice(0, 20);

      const allCredits = [
        ...directors.map((d) => ({ name: d.name, role: "DIRECTOR", character: null, tmdbPersonId: d.id })),
        ...uniqueWriters.map((w) => ({ name: w.name, role: "WRITER", character: null, tmdbPersonId: w.id })),
        ...actors.map((a) => ({ name: a.name, role: "ACTOR", character: a.character, tmdbPersonId: a.id })),
      ];

      for (const credit of allCredits) {
        await prisma.movieCredit.upsert({
          where: { movieId_tmdbPersonId_role: { movieId: movie.id, tmdbPersonId: credit.tmdbPersonId, role: credit.role } },
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

      // Scrape stills from MovieStillsDB
      await sleep(DELAY_MS);
      const stills = await scrapeMoviePage(imdbId);

      if (!stills || stills.length === 0) {
        console.log(`  ⚠ No stills found on MovieStillsDB`);
        continue;
      }

      // Filter: landscape stills only (ratio > 1.2), with preview images
      const landscapeStills = stills.filter(
        (s) => s.ratio > 1.2 && s.preview?.path && s.width >= 800
      );

      console.log(`  Found ${stills.length} total stills, ${landscapeStills.length} landscape scene stills`);

      if (landscapeStills.length < 3) {
        console.log(`  ⚠ Not enough landscape stills, skipping`);
        continue;
      }

      // Save top stills (up to 15)
      const savedImages = [];
      for (const still of landscapeStills.slice(0, 15)) {
        // Use the preview URL (500px wide, no auth needed)
        const imageUrl = still.preview.path;

        const img = await prisma.movieImage.upsert({
          where: { movieId_tmdbFilePath: { movieId: movie.id, tmdbFilePath: imageUrl } },
          update: {},
          create: {
            id: crypto.randomUUID(),
            movieId: movie.id,
            tmdbFilePath: imageUrl, // reusing this field for the MovieStillsDB URL
            width: still.preview.width || still.width,
            height: still.preview.height || still.height,
            aspectRatio: still.ratio,
          },
        });

        // Tag actors visible in this still (from MovieStillsDB people data)
        if (still.people && still.people.length > 0) {
          for (const person of still.people) {
            // Find matching credit in our DB
            const credit = await prisma.movieCredit.findFirst({
              where: {
                movieId: movie.id,
                personName: person.name,
                role: "ACTOR",
              },
            });
            if (credit) {
              await prisma.imageActor.upsert({
                where: { imageId_creditId: { imageId: img.id, creditId: credit.id } },
                update: {},
                create: {
                  id: crypto.randomUUID(),
                  imageId: img.id,
                  creditId: credit.id,
                },
              });
            }
          }
        }

        savedImages.push(img);
      }

      const taggedCount = await prisma.imageActor.count({
        where: { image: { movieId: movie.id } },
      });

      console.log(`  ✓ Saved ${savedImages.length} stills, ${taggedCount} actor tags`);
      seededMovies.push({ movie, images: savedImages });
    } catch (err) {
      console.error(`  ✗ Error:`, err.message);
    }

    await sleep(DELAY_MS);
  }

  // Create today's challenge
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await prisma.guessSession.deleteMany({ where: { challenge: { date: today } } });
  await prisma.dailyChallenge.deleteMany({ where: { date: today } });

  if (seededMovies.length > 0) {
    const pick = seededMovies[Math.floor(Math.random() * seededMovies.length)];
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

  console.log(`\nDone! Seeded ${seededMovies.length} movies with real scene stills.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
