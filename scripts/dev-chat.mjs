#!/usr/bin/env node
// Interactive stand-in for WhatsApp: types you send here become inbound
// messages posted to apps/api's /dev/messages route (only available when
// WHATSAPP_PROVIDER=console), which enqueues them exactly like a real
// webhook would. AfroTune's replies print in the apps/worker terminal
// (ConsoleWhatsAppClient), not here - watch that terminal.
import readline from "node:readline";
import { config } from "dotenv";

config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:") });

const port = process.env.PORT ?? 8091;
const apiUrl = `http://localhost:${port}/dev/messages`;
const phone = process.argv[2] ?? "2348000000001";

console.log(`AfroTune dev chat - simulating WhatsApp number ${phone}`);
console.log(`Posting to ${apiUrl}`);
console.log("Replies print in the apps/worker terminal, not here. Type a message and press Enter. Ctrl+C to quit.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "you> " });
rl.prompt();

rl.on("line", async (line) => {
  const text = line.trim();
  if (text) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, text }),
      });
      if (!res.ok) {
        console.error(`  [error] ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      console.error(`  [error] ${err.message} - is apps/api running with WHATSAPP_PROVIDER=console?`);
    }
  }
  rl.prompt();
});
