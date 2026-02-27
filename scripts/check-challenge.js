require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const a = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
const p = new PrismaClient({ adapter: a });

p.dailyChallenge.findFirst({
  include: {
    movie: { select: { title: true } },
    image1: { select: { tmdbFilePath: true } },
    image2: { select: { tmdbFilePath: true } },
    image3: { select: { tmdbFilePath: true } },
  }
}).then(r => {
  console.log("Challenge movie:", r.movie.title);
  console.log("Image 1:", "https://image.tmdb.org/t/p/w780" + r.image1.tmdbFilePath);
  console.log("Image 2:", "https://image.tmdb.org/t/p/w780" + r.image2.tmdbFilePath);
  console.log("Image 3:", "https://image.tmdb.org/t/p/w780" + r.image3.tmdbFilePath);
}).finally(() => p.$disconnect());
