import { randomUUID } from "node:crypto";
import type {
  CompositionSpec,
  MusicGenerationHandle,
  MusicGenerationProvider,
  MusicGenerationResult,
  MusicProviderCapabilities,
} from "@afrotune/core";

/**
 * ElevenLabs Music implementation of MusicGenerationProvider.
 *
 * Verified directly against the live API (2026-08): `POST /v1/music/detailed`
 * is synchronous - it returns the finished track in one call, not a job id to
 * poll. The response is multipart/mixed: one `application/json` part (the
 * composition plan, whose `sections[].lines` are the generated lyrics) and
 * one `audio/*` part (the track). `model_id` must be `music_v1` (underscore,
 * not hyphen - the earlier `music-v1` was a 422). There is no separate status
 * endpoint, so generate() does the full call and getResult() just returns
 * what generate() already produced, via `handle.raw` - satisfies the
 * MusicGenerationProvider contract without changing it or its callers.
 */

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";

export interface ElevenLabsMusicProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface ElevenLabsGeneratedTrack {
  audioBuffer: Buffer;
  audioContentType: string;
  lyrics?: string;
}

export class ElevenLabsMusicProvider implements MusicGenerationProvider {
  readonly name = "elevenlabs";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts: ElevenLabsMusicProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "music_v1";
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  capabilities(): MusicProviderCapabilities {
    return {
      supportsLyricsInput: false,
      supportsDurationTarget: true,
      maxDurationSeconds: 300,
      supportedLanguageCodes: "any",
    };
  }

  async estimateCostMinorUnits(): Promise<number | null> {
    // ElevenLabs pricing is credit/character-based rather than a flat fee per
    // track at time of writing. Return null (unknown) rather than guess;
    // apps/worker logs actual provider usage from generation_metadata for
    // founder-visible cost tracking instead of relying on a pre-estimate.
    return null;
  }

  async generate(spec: CompositionSpec): Promise<MusicGenerationHandle> {
    const response = await fetch(`${this.baseUrl}/music/detailed`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: this.model,
        prompt: spec.compositionPrompt,
        music_length_ms: spec.targetDurationSeconds * 1000,
      }),
    });

    if (!response.ok) {
      const body = await safeReadText(response);
      throw new Error(`ElevenLabs generate() failed: ${response.status} ${body}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
    if (!boundary) {
      throw new Error(`ElevenLabs generate() response was not the expected multipart/mixed: ${contentType}`);
    }

    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    const parts = splitMultipart(bodyBuffer, boundary);

    const audioPart = parts.find((p) => p.headers["content-type"]?.startsWith("audio/"));
    if (!audioPart) {
      throw new Error("ElevenLabs generate() response did not include an audio part");
    }

    const jsonPart = parts.find((p) => p.headers["content-type"]?.includes("application/json"));
    let lyrics: string | undefined;
    if (jsonPart) {
      const metadata = JSON.parse(jsonPart.body.toString("utf8")) as {
        composition_plan?: { sections?: { lines?: string[] }[] };
      };
      const lines = (metadata.composition_plan?.sections ?? []).flatMap((s) => s.lines ?? []);
      lyrics = lines.length > 0 ? lines.join("\n") : undefined;
    }

    const providerJobId = response.headers.get("song-id") ?? randomUUID();
    const track: ElevenLabsGeneratedTrack = {
      audioBuffer: audioPart.body,
      audioContentType: audioPart.headers["content-type"] ?? "audio/mpeg",
      lyrics,
    };

    return { providerJobId, raw: track };
  }

  /**
   * No real polling happens - generate() already has the finished track by
   * the time it returns, stashed on handle.raw. This just hands it back in
   * the shape apps/worker's generation processor expects.
   */
  async getResult(handle: MusicGenerationHandle): Promise<MusicGenerationResult> {
    const track = handle.raw as ElevenLabsGeneratedTrack | undefined;
    if (!track?.audioBuffer) {
      return {
        status: "failed",
        error: { code: "missing_audio", message: "No audio was produced for this generation", retryable: false },
      };
    }

    return {
      status: "succeeded",
      audioUrl: `data:${track.audioContentType};base64,${track.audioBuffer.toString("base64")}`,
      lyrics: track.lyrics,
    };
  }
}

interface MultipartPart {
  headers: Record<string, string>;
  body: Buffer;
}

function splitMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const marker = Buffer.from(`--${boundary}`);
  const boundaryOffsets: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = body.indexOf(marker, searchFrom);
    if (idx === -1) break;
    boundaryOffsets.push(idx);
    searchFrom = idx + marker.length;
  }

  const parts: MultipartPart[] = [];
  for (let i = 0; i < boundaryOffsets.length - 1; i++) {
    const start = boundaryOffsets[i];
    const end = boundaryOffsets[i + 1];
    if (start === undefined || end === undefined) continue;
    let segment = body.subarray(start + marker.length, end);
    if (segment[0] === 0x0d && segment[1] === 0x0a) segment = segment.subarray(2);
    if (segment[segment.length - 2] === 0x0d && segment[segment.length - 1] === 0x0a) {
      segment = segment.subarray(0, segment.length - 2);
    }

    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers: Record<string, string> = {};
    for (const line of segment.subarray(0, headerEnd).toString("utf8").split("\r\n")) {
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim();
    }

    parts.push({ headers, body: segment.subarray(headerEnd + 4) });
  }

  return parts;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}
