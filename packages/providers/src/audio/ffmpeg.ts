/// <reference path="../types/ambient.d.ts" />
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
ffmpeg.setFfprobePath(ffprobeStatic.path);

export interface ProbeResult {
  durationSeconds: number;
  codec: string | undefined;
  formatName: string | undefined;
  sizeBytes: number | undefined;
}

/** Validates that a downloaded provider file is a real, playable audio file. */
export function probeAudioFile(path: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) {
        reject(new Error(`Provider audio failed validation (ffprobe): ${err.message}`));
        return;
      }
      const audioStream = data.streams.find((s) => s.codec_type === "audio");
      if (!audioStream) {
        reject(new Error("Provider audio has no audio stream"));
        return;
      }
      const duration = Number(data.format.duration ?? audioStream.duration ?? 0);
      if (!duration || duration < 1) {
        reject(new Error("Provider audio duration is missing or too short"));
        return;
      }
      resolve({
        durationSeconds: duration,
        codec: audioStream.codec_name,
        formatName: data.format.format_name,
        sizeBytes: data.format.size ? Number(data.format.size) : undefined,
      });
    });
  });
}

/**
 * Produces the WhatsApp/download-friendly delivery copy: trims leading/
 * trailing near-silence, applies single-pass loudness normalization, and
 * encodes to a broadly compatible 128kbps MP3. The original provider file
 * is left untouched by the caller - this only ever writes to outputPath.
 */
export function processForDelivery(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters([
        // Trim silence only at the very start/end, conservatively, so we
        // never eat into the actual song.
        "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB:detection=peak",
        "areverse",
        "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB:detection=peak",
        "areverse",
        // Single-pass loudness normalization to a standard streaming target.
        "loudnorm=I=-16:TP=-1.5:LRA=11",
      ])
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .format("mp3")
      .on("error", (err) => reject(new Error(`FFmpeg delivery processing failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(outputPath);
  });
}
