import "dotenv/config";
import postgres from "postgres";

// The pgvector `vector` column type only exists after the extension is created.
// Run this before `drizzle-kit push` so the kb_chunks table can be created.
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log("✓ pgvector extension is enabled");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Failed to enable pgvector extension:", err);
  process.exit(1);
});
