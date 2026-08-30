import { getSupabaseServiceClient } from "@afrotune/db";

async function getSummary() {
  const db = getSupabaseServiceClient();

  const [
    { count: totalUsers },
    { count: totalSongs },
    { count: completedSongs },
    { count: failedSongs },
    { count: successfulPayments },
    { data: recentFailedJobs },
    { data: recentPayments },
    { data: ratings },
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("songs").select("*", { count: "exact", head: true }),
    db.from("songs").select("*", { count: "exact", head: true }).eq("status", "completed"),
    db.from("songs").select("*", { count: "exact", head: true }).eq("status", "failed"),
    db.from("payments").select("*", { count: "exact", head: true }).eq("status", "success"),
    db
      .from("generation_jobs")
      .select("id, song_id, last_error, completed_at")
      .eq("status", "failed")
      .order("completed_at", { ascending: false })
      .limit(10),
    db
      .from("payments")
      .select("id, credits, amount_minor_units, currency_code, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("ratings").select("rating"),
  ]);

  const avgRating =
    ratings && ratings.length > 0
      ? (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(2)
      : "—";

  return {
    totalUsers: totalUsers ?? 0,
    totalSongs: totalSongs ?? 0,
    completedSongs: completedSongs ?? 0,
    failedSongs: failedSongs ?? 0,
    successfulPayments: successfulPayments ?? 0,
    avgRating,
    recentFailedJobs: recentFailedJobs ?? [],
    recentPayments: recentPayments ?? [],
  };
}

export default async function AdminPage() {
  const summary = await getSummary();

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <h1>AfroTune - Founder Dashboard</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 24 }}>
        <Stat label="Users" value={summary.totalUsers} />
        <Stat label="Songs created" value={summary.totalSongs} />
        <Stat label="Completed" value={summary.completedSongs} />
        <Stat label="Failed" value={summary.failedSongs} />
        <Stat label="Payments" value={summary.successfulPayments} />
        <Stat label="Avg rating" value={summary.avgRating} />
      </div>

      <h2 style={{ marginTop: 40 }}>Recent failed generations</h2>
      {summary.recentFailedJobs.length === 0 ? (
        <p style={{ opacity: 0.6 }}>None 🎉</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {summary.recentFailedJobs.map((job) => (
              <tr key={job.id} style={{ borderBottom: "1px solid #333" }}>
                <td style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>{job.song_id}</td>
                <td style={{ padding: 8, fontSize: 13, opacity: 0.8 }}>{job.last_error}</td>
                <td style={{ padding: 8, fontSize: 12, opacity: 0.5 }}>{job.completed_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 40 }}>Recent payments</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {summary.recentPayments.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #333" }}>
              <td style={{ padding: 8 }}>{p.credits} credits</td>
              <td style={{ padding: 8 }}>
                {(p.amount_minor_units / 100).toLocaleString()} {p.currency_code}
              </td>
              <td style={{ padding: 8 }}>{p.status}</td>
              <td style={{ padding: 8, fontSize: 12, opacity: 0.5 }}>{p.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: "#1c1c24", borderRadius: 8, padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
      <div style={{ opacity: 0.6, fontSize: 13 }}>{label}</div>
    </div>
  );
}
