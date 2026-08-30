# Connecting a Real WhatsApp Number

This is the step-by-step for going from "works locally with the console
provider" to "a real phone number that real customers can message." It
assumes you've already validated the conversation → payment → generation
loop end to end (see the dev-testing section of `SETUP_GUIDE.md` / use
`scripts/dev-chat.mjs`) and just need to wire up the real channel.

There are two ways to get a production WhatsApp number talking to
`apps/api`. Pick one - **Option A (Meta direct) is recommended** because it
needs no paid Twilio upgrade and the code already supports it
(`WHATSAPP_PROVIDER=meta`, the default). Option B is only worth it if you
specifically want Twilio's dashboard/abstraction on top of WhatsApp.

---

## Option A — Meta WhatsApp Cloud API directly (recommended)

No Twilio account needed at all for this path.

### 1. Create a Meta Business app
1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App** → type **Business**.
2. Create it under AfroTune's own Meta Business Manager account, not a personal one.
3. In the app dashboard, **Add Product** → **WhatsApp**.

### 2. Get a real phone number into WhatsApp
Meta gives you a free test number for initial API setup, but it can only message a handful of pre-verified test recipients - not real customers. To go live you need to add a **real phone number** you own:
1. WhatsApp → **API Setup** (or **Configuration** in newer UI) → **Add phone number**.
2. Use a number that has never been active on regular WhatsApp/WhatsApp Business (or migrate/remove it from those first).
3. Verify it via the SMS/voice code Meta sends.
4. Set your **display name** (e.g. "AfroTune") - this goes through Meta's name-approval review, which can take a day or two. You can keep testing before it's approved; customers just won't see the friendly name yet.

### 3. Collect your credentials
From WhatsApp → **API Setup**, note:
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`

Then generate a **permanent access token** (the temporary one shown in API Setup expires in 24h):
1. Meta Business Settings → **Users** → **System Users** → **Add** (create one, e.g. "afrotune-api").
2. **Add Assets** → assign it your WhatsApp app with **Full control**.
3. **Generate New Token** → select the app → permissions: `whatsapp_business_messaging` + `whatsapp_business_management` → no expiration.
4. Copy this token → `WHATSAPP_ACCESS_TOKEN`.

From App Settings → **Basic**, copy `META_APP_ID` and `META_APP_SECRET`.

### 4. Get `apps/api` a real public URL
Meta's webhook config needs a stable HTTPS URL (not a per-restart ngrok URL) for anything beyond quick manual testing. Deploy `apps/api` (see "Deploying" in `SETUP_GUIDE.md` - Railway/Render both work) and note its public URL, e.g. `https://api.afrotune.app`. (You *can* use ngrok for a quick one-off verification, but expect to redo step 5 every time the tunnel restarts.)

### 5. Point Meta's webhook at your API
1. Choose any secret string for `WHATSAPP_VERIFY_TOKEN` in `.env`.
2. In WhatsApp → **Configuration** → **Webhook**, set:
   - Callback URL: `https://<your-api-domain>/webhooks/whatsapp`
   - Verify token: the same `WHATSAPP_VERIFY_TOKEN` value
3. Click **Verify and Save** - if this fails, `apps/api` isn't reachable at that URL yet, or the token doesn't match exactly.
4. Under **Webhook fields**, subscribe to `messages`.

### 6. Configure and deploy
In your production `.env` (not the local dev one):
```
WHATSAPP_PROVIDER=meta
WHATSAPP_ACCESS_TOKEN=<the permanent system-user token>
WHATSAPP_PHONE_NUMBER_ID=<from step 3>
WHATSAPP_BUSINESS_ACCOUNT_ID=<from step 3>
META_APP_SECRET=<from step 3>
WHATSAPP_VERIFY_TOKEN=<your chosen secret>
WHATSAPP_API_VERSION=v20.0   # or whatever's current
```
Deploy `apps/api` and `apps/worker` with this `.env`. Restart both (env loads once at boot).

### 7. Confirm you're live
1. From a phone that is **not** one of Meta's pre-approved test recipients (i.e. a real number), message your AfroTune WhatsApp number.
2. Watch `apps/worker` logs for the incoming-message job and an LLM-generated reply.
3. Confirm the reply actually arrives on WhatsApp (not just in the log) - this is the real signal you're live, since Meta's outbound send is what the console/Twilio providers were standing in for.
4. Run one full request through to a finished song (see "End-to-end test" in `SETUP_GUIDE.md`) using real credits/payment this time, not `DEV_BYPASS_PAYMENT`.
5. Once name approval clears (step 2), double-check the display name customers see is correct.

If Meta's display-name review flags your number as unverified/restricted, you can still send/receive - it just shows as the raw number until approved.

---

## Option B — Twilio-managed WhatsApp Sender

Only do this if you specifically want Twilio's layer on top of WhatsApp. It requires upgrading past the free trial (a paid Twilio account) and still goes through Meta for the actual WhatsApp Business approval underneath - there's no way to reach real customers on WhatsApp without Meta involved somewhere.

1. **Upgrade the Twilio account**: Console → **Upgrade** → add a payment method. The Sandbox (`whatsapp:+14155238886`) only works for two-way testing with numbers that sent it a `join <code>` message - it can never be your production number.
2. **Register a WhatsApp Sender**: Console → **Messaging** → **Senders** → **WhatsApp senders** → **Get Started**. This walks you through connecting a phone number and your Meta Business Manager account, and submits your number + display name for Meta's approval (same underlying review as Option A).
3. Once approved, note the new sender's WhatsApp-enabled number - this replaces `TWILIO_WHATSAPP_FROM` (currently `whatsapp:+14155238886`, the sandbox number) in `.env`.
4. Update the Sandbox Settings' "when a message comes in" webhook to your production `apps/api` URL, or (if Twilio's newer UI manages this per-Sender rather than globally) set it on the Sender itself: `https://<your-api-domain>/webhooks/whatsapp/twilio`.
5. Update `TWILIO_WEBHOOK_URL` in your production `.env` to that exact URL - required for signature verification in `apps/api/src/routes/twilioWebhook.ts`.
6. Keep `WHATSAPP_PROVIDER=twilio`, redeploy, and repeat the "Confirm you're live" checklist from Option A step 7.

---

## Either way: before real customers see it

- Rotate all secrets (`WHATSAPP_ACCESS_TOKEN` / `TWILIO_AUTH_TOKEN`, `APP_SECRET`, Supabase/Paystack keys) to production values - never reuse anything used during dev/sandbox testing.
- Turn off `DEV_BYPASS_PAYMENT` in production `.env` (leave unset or `false`) - it's double-gated behind `NODE_ENV !== "production"` already, but don't rely on that alone.
- Switch Paystack to live keys and re-point its webhook URL to the production `apps/api` domain (see `SETUP_GUIDE.md` §3).
- Set `WHATSAPP_PROVIDER` back to `console` only in *local* dev `.env` files - never in anything deployed.
