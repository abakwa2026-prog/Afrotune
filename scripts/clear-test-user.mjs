import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:") });
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_TRANSACTION_POOLER,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// Cascades to conversation_sessions, song_requests, credit_wallets, credit_ledger, etc.
const result = await client.query("delete from users where whatsapp_phone_number = $1 returning id", [
  "15005550006",
]);
console.log("deleted users:", result.rows);

await client.end();
