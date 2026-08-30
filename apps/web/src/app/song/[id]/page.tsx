import { notFound } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { RatingForm } from "./RatingForm";

interface SongResponse {
  id: string;
  title: string | null;
  lyrics: string | null;
  status: string;
  durationSeconds: number | null;
  audioUrl: string | null;
  occasion: string | null;
  mood: string | null;
  recipientName: string | null;
  createdAt: string;
  completedAt: string | null;
}

export default async function SongPage({ params }: { params: { id: string } }) {
  let song: SongResponse;
  try {
    song = await apiFetch<SongResponse>(`/api/songs/${params.id}`);
  } catch {
    notFound();
  }

  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>{song.title ?? "Your AfroTune song"}</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        {[song.occasion, song.recipientName ? `for ${song.recipientName}` : null, song.mood]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {song.status !== "completed" && (
        <p style={{ padding: 12, background: "#1c1c24", borderRadius: 8 }}>
          This song is still being created ({song.status}). Refresh in a bit.
        </p>
      )}

      {song.audioUrl && (
        <audio controls style={{ width: "100%", marginTop: 16 }} src={song.audioUrl}>
          Your browser does not support audio playback.
        </audio>
      )}

      {song.audioUrl && (
        <a
          href={song.audioUrl}
          download
          style={{ display: "inline-block", marginTop: 12, color: "#7fd1ff" }}
        >
          Download MP3
        </a>
      )}

      {song.lyrics && (
        <>
          <h2 style={{ marginTop: 32 }}>Lyrics</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.6 }}>
            {song.lyrics}
          </pre>
        </>
      )}

      {song.status === "completed" && <RatingForm songId={song.id} />}
    </main>
  );
}
