import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:") });
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_TRANSACTION_POOLER,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const users = await client.query(
  "select id, whatsapp_phone_number, created_at from users where whatsapp_phone_number = $1",
  ["15005550006"],
);
console.log("users:", users.rows);

if (users.rows.length) {
  const uid = users.rows[0].id;
  const sessions = await client.query(
    "select id, status, state from conversation_sessions where user_id = $1",
    [uid],
  );
  console.log("sessions:", JSON.stringify(sessions.rows, null, 2));

  const requests = await client.query(
    "select id, status, brief from song_requests where user_id = $1",
    [uid],
  );
  console.log("song_requests:", JSON.stringify(requests.rows, null, 2));
}

const events = await client.query(
  "select source, event_id, processed_at, created_at from webhook_events where source = 'twilio' order by created_at desc limit 3",
);
console.log("webhook_events:", events.rows);

await client.end();
