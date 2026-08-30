#!/usr/bin/env node
// Sends a correctly-signed synthetic Twilio WhatsApp webhook request at the
// running apps/api, to validate signature verification + parsing without
// spending a real WhatsApp message. Not part of the app - a one-off dev tool.
import { createHmac } from "node:crypto";
import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:") });

const url = process.env.TWILIO_WEBHOOK_URL;
const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TWILIO_WEBHOOK_URL and TWILIO_AUTH_TOKEN must be set in .env");
  process.exit(1);
}

const params = {
  MessageSid: `SMtest${Date.now()}`,
  From: "whatsapp:+15005550006", // Twilio's magic "valid" test number
  To: process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
  Body: "Make a birthday song for my wife Ada, we've been married 7 years, Afrobeats, romantic but danceable, some Yoruba in it",
};

// Twilio's signing algorithm: url + sorted "key"+"value" concatenation, HMAC-SHA1, base64.
const sortedKeys = Object.keys(params).sort();
let data = url;
for (const key of sortedKeys) data += key + params[key];
const signature = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");

const body = new URLSearchParams(params).toString();

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Twilio-Signature": signature,
  },
  body,
});

console.log("status:", res.status);
console.log("body:", await res.text());
