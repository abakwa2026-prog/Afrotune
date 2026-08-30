"use client";

import { useState } from "react";

export function BuyButton({ creditPackId, defaultPhone }: { creditPackId: string; defaultPhone: string }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    if (!phone) {
      setError("Enter the WhatsApp number you messaged AfroTune from.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappPhoneNumber: phone, creditPackId }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      window.location.href = data.authorizationUrl;
    } catch {
      setError("Could not start payment, please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <input
        placeholder="WhatsApp number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{ padding: 6, borderRadius: 4, border: "1px solid #444", background: "#0d0d12", color: "#fff" }}
      />
      <button
        onClick={buy}
        disabled={loading}
        style={{
          padding: "8px 16px",
          borderRadius: 6,
          border: "none",
          background: "#25d366",
          color: "#0d0d12",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {loading ? "Starting..." : "Buy"}
      </button>
      {error && <span style={{ color: "#ff8080", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
