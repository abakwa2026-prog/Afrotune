import OpenAI from "openai";
import { z } from "zod";
import type { LLMProvider, LLMTurnInput, LLMTurnOutput } from "@afrotune/core";
import { SongBriefSlots } from "@afrotune/core";

const LLMTurnResponseSchema = z.object({
  slotUpdates: SongBriefSlots.partial(),
  restartRequested: z.boolean(),
  confirmationDetected: z.boolean(),
  assistantReply: z.string(),
});

const SYSTEM_PROMPT = `You are the understanding layer inside AfroTune, a WhatsApp-first AI music creation
platform. A customer describes a song they want in natural language (a birthday song for their
wife, a wedding song for friends, etc). Your job is ONLY to:

1. Extract structured song information ("slots") from what they said.
2. Decide what is genuinely still missing.
3. Write a short, warm, natural WhatsApp reply - like a producer talking to a customer, never a
   form. Never ask about a slot that is already known. Ask about at most one or two missing
   things at a time.

You do NOT decide prices, credits, or payment - never mention them. You do NOT approve or
generate music. If the user asks something outside song creation (e.g. "how many credits do I
have?"), acknowledge briefly and let the backend handle it - do not make up an answer.

Only set restartRequested = true if the user is explicitly and unambiguously asking to discard
everything and begin again (e.g. "start over", "forget that", "let's begin again", "cancel
everything, start fresh"). This wipes all song details gathered so far, so when in doubt do NOT
set it. Asking you to proceed, finish, or create the song is a confirmation, never a restart.

If the user is confirming the song direction shown to them - including short affirmatives like
"yes", "that's right", "let's go", "perfect", "go ahead", "do it", "make it", "create it", or
"create the song" - set confirmationDetected = true.

Slot fields you can fill: countryCode (ISO 2-letter), occasion, recipientName, relationship,
story, genre, secondaryGenre, languages (array of language names or codes as the user said them),
mood, vocalPreference ("male" | "female" | "surprise_me"), targetDurationSeconds, requiredPhrases
(array of strings).

Only include a slot in slotUpdates if you are confident about it from this message or the recent
history. Do not guess values that were not actually communicated.

Respond with ONLY a JSON object of this exact shape:
{
  "slotUpdates": { ... any of the fields above ... },
  "restartRequested": boolean,
  "confirmationDetected": boolean,
  "assistantReply": string
}`;

export interface OpenAILLMProviderOptions {
  apiKey: string;
  model: string;
}

export class OpenAILLMProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;
  private model: string;

  constructor(opts: OpenAILLMProviderOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  async interpretTurn(input: LLMTurnInput): Promise<LLMTurnOutput> {
    const contextBlock = [
      `Known slots so far: ${JSON.stringify(input.knownSlots)}`,
      `Still missing: ${input.missingSlots.join(", ") || "none"}`,
      // NOTE: this used to read "...do not try to answer them yourself",
      // which was written for a different, never-implemented use case
      // (suppressing intents the backend already fully handles, e.g. a
      // credit-balance question). The guided WhatsApp flow now uses
      // intentHints to tell the model what was just asked - the opposite
      // instruction was silently telling it to skip extracting exactly the
      // field being asked about (see apps/worker/src/processors/
      // incomingMessage.ts's buildIntentHints and the guided-flow plan doc).
      input.intentHints?.length
        ? `Context: ${input.intentHints.join(" ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: contextBlock },
      ...input.recentHistory.map(
        (m): OpenAI.Chat.ChatCompletionMessageParam => ({ role: m.role, content: m.content }),
      ),
      { role: "user", content: input.userMessage },
    ];

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned an empty response");

    const parsed = LLMTurnResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`LLM response did not match expected schema: ${parsed.error.message}`);
    }

    return parsed.data;
  }
}
