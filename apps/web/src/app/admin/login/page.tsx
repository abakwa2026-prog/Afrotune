"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit() {
    const res = await fetch("/admin/login/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push("/admin");
      router.refresh();
    } else {
      setError("Incorrect password.");
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "120px auto", padding: 24, textAlign: "center" }}>
      <h1>AfroTune Admin</h1>
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ width: "100%", padding: 10, marginTop: 16, borderRadius: 6, border: "1px solid #444", background: "#1c1c24", color: "#fff" }}
      />
      <button
        onClick={submit}
        style={{ width: "100%", padding: 10, marginTop: 12, borderRadius: 6, border: "none", background: "#25d366", color: "#0d0d12", fontWeight: 600, cursor: "pointer" }}
      >
        Sign in
      </button>
      {error && <p style={{ color: "#ff8080" }}>{error}</p>}
    </main>
  );
}
