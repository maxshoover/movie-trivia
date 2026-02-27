const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
const p = new PrismaClient({ adapter });
p.user
  .findMany()
  .then((r) => console.log("OK, users:", r.length))
  .catch((e) => console.error("Error:", e.message))
  .finally(() => p.$disconnect());
