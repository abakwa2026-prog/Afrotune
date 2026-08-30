import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
};

export interface DownloadedFile {
  dir: string;
  path: string;
  cleanup: () => Promise<void>;
}

export async function downloadToTempFile(url: string): Promise<DownloadedFile> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download provider audio: ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const ext = CONTENT_TYPE_EXTENSIONS[contentType] ?? "mp3";

  const dir = await mkdtemp(join(tmpdir(), "afrotune-"));
  const path = join(dir, `original-${randomUUID()}.${ext}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path, buffer);

  return { dir, path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
