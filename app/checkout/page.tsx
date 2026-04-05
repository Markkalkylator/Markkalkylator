"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const PLANS: Record<string, { name: string; price: string; features: string[] }> = {
  pro: {
    name: "Pro",
    price: "499 kr/mån",
    features: ["Obegränsat antal projekt", "Eget varumärke", "Excel-export", "Massabalans", "Projektmallar", "E-postsupport"],
  },
  team: {
    name: "Team",
    price: "999 kr/mån",
    features: ["Allt i Pro", "Upp till 5 användare", "Delat projektbibliotek", "Prioriterad support"],
  },
};

export default function CheckoutPage() {
  const params = useSearchParams();
  const planKey = params.get("plan") || "pro";
  const plan = PLANS[planKey] || PLANS.pro;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Något gick fel. Försök igen.");
      }
    } catch {
      setError("Kunde inte ansluta till betalningssystemet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg,#F8FAFF,#EEF2F7)",
      fontFamily: "Inter,-apple-system,sans-serif", padding: "20px",
    }}>
      <div style={{
        background: "#fff", borderRadius: 20, padding: "40px 36px",
        boxShadow: "0 8px 48px rgba(0,0,0,0.12)", border: "1px solid rgba(0,0,0,0.07)",
        width: "100%", maxWidth: 440,
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg,#1A2030,#3B6FD4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, margin: "0 auto 16px",
          }}>🏗️</div>
          <div style={{ fontSize: 13, color: "#94A3B8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
            MarkKalkyl {plan.name}
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, color: "#0F172A", letterSpacing: "-0.02em" }}>
            {plan.price}
          </div>
          <div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>
            14 dagars gratis provperiod · Avsluta när du vill
          </div>
        </div>

        {/* Features */}
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
          {plan.features.map((f) => (
            <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
              <span style={{ color: "#3B6FD4", fontWeight: 700 }}>✓</span>
              <span style={{ color: "#334155" }}>{f}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#C4281C" }}>
            {error}
          </div>
        )}
        <button
          onClick={startCheckout}
          disabled={loading}
          style={{
            width: "100%", padding: "15px", borderRadius: 12, border: "none",
            background: loading ? "#94A3B8" : "linear-gradient(135deg,#1A2030,#2C3A58)",
            color: "#fff", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "Inter,sans-serif",
            boxShadow: loading ? "none" : "0 4px 20px rgba(26,32,48,0.35)",
          }}
        >
          {loading ? "Skapar betalning…" : "Gå vidare till betalning →"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#94A3B8" }}>
          🔒 Säker betalning via Stripe · Visa, Mastercard, Klarna
        </div>
      </div>
    </div>
  );
}
