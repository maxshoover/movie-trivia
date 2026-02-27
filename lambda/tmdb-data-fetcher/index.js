const { Client } = require("pg");

const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdbFetch(path) {
  const url = `${TMDB_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`TMDb API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchMovieDetails(tmdbId) {
  const [details, credits, images] = await Promise.all([
    tmdbFetch(`/movie/${tmdbId}`),
    tmdbFetch(`/movie/${tmdbId}/credits`),
    tmdbFetch(`/movie/${tmdbId}/images`),
  ]);
  return { details, credits, images };
}

exports.handler = async (event) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const mode = event.mode || "popular";
    let movieIds = [];

    if (mode === "popular") {
      // Fetch multiple pages of popular movies
      for (let page = 1; page <= 5; page++) {
        const data = await tmdbFetch(`/movie/popular?page=${page}`);
        movieIds.push(...data.results.map((m) => m.id));
      }
    } else if (mode === "top_rated") {
      for (let page = 1; page <= 5; page++) {
        const data = await tmdbFetch(`/movie/top_rated?page=${page}`);
        movieIds.push(...data.results.map((m) => m.id));
      }
    } else if (mode === "discover") {
      // Discover movies by decade for variety
      const decades = [1970, 1980, 1990, 2000, 2010, 2020];
      for (const decade of decades) {
        const data = await tmdbFetch(
          `/discover/movie?primary_release_date.gte=${decade}-01-01&primary_release_date.lte=${decade + 9}-12-31&sort_by=vote_count.desc&page=1`
        );
        movieIds.push(...data.results.map((m) => m.id));
      }
    }

    console.log(`Fetching details for ${movieIds.length} movies...`);

    let processed = 0;
    for (const tmdbId of movieIds) {
      try {
        const { details, credits, images } = await fetchMovieDetails(tmdbId);

        // Upsert movie
        const movieResult = await client.query(
          `INSERT INTO movies (id, tmdb_id, title, release_year, overview, popularity, vote_average, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (tmdb_id) DO UPDATE SET
             title = EXCLUDED.title,
             popularity = EXCLUDED.popularity,
             vote_average = EXCLUDED.vote_average
           RETURNING id`,
          [
            tmdbId,
            details.title,
            details.release_date ? parseInt(details.release_date.substring(0, 4)) : null,
            details.overview,
            details.popularity,
            details.vote_average,
          ]
        );
        const movieId = movieResult.rows[0].id;

        // Upsert credits (directors, writers, top 20 actors)
        const directors = credits.crew.filter((c) => c.job === "Director");
        const writers = credits.crew.filter(
          (c) => c.job === "Screenplay" || c.job === "Writer" || c.department === "Writing"
        );
        // Deduplicate writers by person ID
        const uniqueWriters = [...new Map(writers.map((w) => [w.id, w])).values()];
        const actors = credits.cast.slice(0, 20);

        const allCredits = [
          ...directors.map((d) => ({ ...d, role: "DIRECTOR", character: null })),
          ...uniqueWriters.map((w) => ({ ...w, role: "WRITER", character: null })),
          ...actors.map((a) => ({ ...a, role: "ACTOR", character: a.character })),
        ];

        for (const credit of allCredits) {
          await client.query(
            `INSERT INTO movie_credits (id, movie_id, person_name, role, character, tmdb_person_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
             ON CONFLICT (movie_id, tmdb_person_id, role) DO UPDATE SET
               person_name = EXCLUDED.person_name,
               character = EXCLUDED.character`,
            [movieId, credit.name, credit.role, credit.character, credit.id]
          );
        }

        // Upsert backdrop images (filter for landscape backdrops)
        const backdrops = images.backdrops.filter(
          (b) => b.width >= 1280 && b.aspect_ratio > 1.5 && b.iso_639_1 === null
        );

        for (const backdrop of backdrops) {
          await client.query(
            `INSERT INTO movie_images (id, movie_id, tmdb_file_path, width, height, aspect_ratio, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
             ON CONFLICT (movie_id, tmdb_file_path) DO NOTHING`,
            [movieId, backdrop.file_path, backdrop.width, backdrop.height, backdrop.aspect_ratio]
          );
        }

        processed++;
      } catch (err) {
        console.error(`Error processing movie ${tmdbId}:`, err.message);
      }
    }

    console.log(`Successfully processed ${processed}/${movieIds.length} movies`);
    return { statusCode: 200, body: `Processed ${processed} movies` };
  } finally {
    await client.end();
  }
};
