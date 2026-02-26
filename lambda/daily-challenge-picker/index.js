const { Client } = require("pg");

exports.handler = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Target date is tomorrow (UTC)
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const dateStr = tomorrow.toISOString().split("T")[0];

    // Check if tomorrow already has a challenge
    const existing = await client.query(
      "SELECT id FROM daily_challenges WHERE date = $1",
      [dateStr]
    );
    if (existing.rows.length > 0) {
      console.log(`Challenge already exists for ${dateStr}`);
      return { statusCode: 200, body: "Already exists" };
    }

    // Pick a movie that has at least 3 unused images
    const movieResult = await client.query(`
      SELECT mi.movie_id, COUNT(*) as img_count
      FROM movie_images mi
      LEFT JOIN daily_challenges dc1 ON dc1.image1_id = mi.id
      LEFT JOIN daily_challenges dc2 ON dc2.image2_id = mi.id
      LEFT JOIN daily_challenges dc3 ON dc3.image3_id = mi.id
      WHERE dc1.id IS NULL AND dc2.id IS NULL AND dc3.id IS NULL
        AND mi.width >= 1280
      GROUP BY mi.movie_id
      HAVING COUNT(*) >= 3
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (movieResult.rows.length === 0) {
      console.error("No movies with 3+ unused images available!");
      return { statusCode: 500, body: "No movies available" };
    }

    const movieId = movieResult.rows[0].movie_id;

    // Pick 3 random images from that movie (prefer curated, weighted by difficulty)
    const imageResult = await client.query(`
      SELECT mi.id as image_id
      FROM movie_images mi
      LEFT JOIN daily_challenges dc1 ON dc1.image1_id = mi.id
      LEFT JOIN daily_challenges dc2 ON dc2.image2_id = mi.id
      LEFT JOIN daily_challenges dc3 ON dc3.image3_id = mi.id
      LEFT JOIN image_stats ist ON ist.image_id = mi.id
      WHERE mi.movie_id = $1
        AND dc1.id IS NULL AND dc2.id IS NULL AND dc3.id IS NULL
        AND mi.width >= 1280
      ORDER BY
        mi.is_curated DESC,
        CASE
          WHEN ist.difficulty_score IS NOT NULL
          THEN ABS(ist.difficulty_score - 0.5)
          ELSE 0.5
        END ASC,
        RANDOM()
      LIMIT 3
    `, [movieId]);

    if (imageResult.rows.length < 3) {
      console.error("Not enough images found for movie!");
      return { statusCode: 500, body: "Not enough images" };
    }

    const [img1, img2, img3] = imageResult.rows;

    await client.query(
      `INSERT INTO daily_challenges (id, date, movie_id, image1_id, image2_id, image3_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
      [dateStr, movieId, img1.image_id, img2.image_id, img3.image_id]
    );

    console.log(`Created challenge for ${dateStr}: movie=${movieId}, images=[${img1.image_id}, ${img2.image_id}, ${img3.image_id}]`);
    return { statusCode: 200, body: `Challenge created for ${dateStr}` };
  } finally {
    await client.end();
  }
};
