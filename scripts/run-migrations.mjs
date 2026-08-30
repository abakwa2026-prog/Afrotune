#!/usr/bin/env node
// Applies supabase/migrations/*.sql (and optionally supabase/seed.sql) against
// the project's Postgres connection, in order. Uses SUPABASE_TRANSACTION_POOLER
// (or DATABASE_URL as a fallback) from the repo-root .env.
//
// Usage:
//   node scripts/run-migrations.mjs            # migrations only
//   node scripts/run-migrations.mjs --seed      # migrations + seed.sql

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
config({ path: join(repoRoot, ".env") });

const connectionString = process.env.SUPABASE_TRANSACTION_POOLER || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Set SUPABASE_TRANSACTION_POOLER (or DATABASE_URL) in .env before running migrations.");
  process.exit(1);
}

const migrationsDir = join(repoRoot, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const includeSeed = process.argv.includes("--seed");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  console.log(`Connected. Applying ${files.length} migration(s)...`);

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`-> ${file}`);
    try {
      await client.query(sql);
    } catch (err) {
      console.error(`Failed on ${file}:`, err.message);
      throw err;
    }
  }

  if (includeSeed) {
    console.log("-> seed.sql");
    const seedSql = readFileSync(join(repoRoot, "supabase", "seed.sql"), "utf8");
    await client.query(seedSql);
  }

  console.log("Done.");
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
