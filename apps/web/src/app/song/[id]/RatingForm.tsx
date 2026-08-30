"use client";

import { useState } from "react";

export function RatingForm({ songId }: { songId: string }) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(rating: number) {
    setError(null);
    try {
      const res = await fetch(`/api/songs/${songId}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error("Request failed");
      setSubmitted(true);
    } catch {
      setError("Could not submit your rating, please try again.");
    }
  }

  if (submitted) return <p style={{ marginTop: 32 }}>Thanks for rating this song! 🙏</p>;

  return (
    <div style={{ marginTop: 32 }}>
      <p>How would you rate this song?</p>
      <div style={{ display: "flex", gap: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => submit(n)}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid #444",
              background: "#1c1c24",
              color: "#f5f5f5",
              cursor: "pointer",
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {error && <p style={{ color: "#ff8080" }}>{error}</p>}
    </div>
  );
}
