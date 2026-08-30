import { apiFetch } from "../../../lib/api";

interface StatusResponse {
  status: "pending" | "success" | "failed" | "abandoned";
  credits: number;
}

export default async function PayCompletePage({
  searchParams,
}: {
  searchParams: { reference?: string };
}) {
  if (!searchParams.reference) {
    return <main style={{ maxWidth: 480, margin: "80px auto", padding: 24 }}>Missing payment reference.</main>;
  }

  let status: StatusResponse | null = null;
  try {
    status = await apiFetch<StatusResponse>(`/api/payments/${searchParams.reference}/status`);
  } catch {
    // fall through to a generic pending message
  }

  return (
    <main style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center" }}>
      {status?.status === "success" ? (
        <>
          <h1>Payment received 🎉</h1>
          <p>
            {status.credits} credit{status.credits === 1 ? "" : "s"} added to your wallet. Head back to
            WhatsApp - AfroTune will pick up right where you left off.
          </p>
        </>
      ) : (
        <>
          <h1>Confirming payment...</h1>
          <p>
            This can take a few seconds after checkout. Check WhatsApp shortly - we&apos;ll message you as
            soon as it&apos;s confirmed.
          </p>
        </>
      )}
    </main>
  );
}
