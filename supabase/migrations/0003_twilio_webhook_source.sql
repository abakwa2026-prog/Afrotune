-- Twilio WhatsApp Sandbox is a development-time alternative transport to
-- Meta WhatsApp Cloud API (see WHATSAPP_PROVIDER). Its inbound webhook
-- deliveries are deduped through the same webhook_events table as Meta and
-- Paystack, so the enum needs a matching value.
alter type webhook_source add value if not exists 'twilio';
