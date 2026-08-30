import { apiFetch } from "../../lib/api";
import { BuyButton } from "./BuyButton";

interface CreditPack {
  id: string;
  credits: number;
  price_minor_units: number;
  currency_code: string;
}

export default async function PayPage({
  searchParams,
}: {
  searchParams: { phone?: string; country?: string };
}) {
  const { packs } = await apiFetch<{ packs: CreditPack[] }>(
    `/api/credit-packs${searchParams.country ? `?country=${searchParams.country}` : "?country=NG"}`,
  );

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", padding: 24 }}>
      <h1>Buy AfroTune credits</h1>
      <p style={{ opacity: 0.7 }}>
        Credits stay in your wallet - use them whenever you create a new song on WhatsApp.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        {packs.map((pack) => (
          <div
            key={pack.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 16,
              background: "#1c1c24",
              borderRadius: 8,
            }}
          >
            <div>
              <strong>{pack.credits} credit{pack.credits === 1 ? "" : "s"}</strong>
              <div style={{ opacity: 0.7 }}>
                {(pack.price_minor_units / 100).toLocaleString()} {pack.currency_code}
              </div>
            </div>
            <BuyButton creditPackId={pack.id} defaultPhone={searchParams.phone ?? ""} />
          </div>
        ))}
      </div>
    </main>
  );
}
