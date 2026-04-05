"use client";
export const dynamic = "force-dynamic";

import { useState } from "react";

export default function CheckoutPage() {
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F8FAFF", fontFamily:"sans-serif" }}>
      <div style={{ textAlign:"center", maxWidth:480, padding:40 }}>
        <div style={{ fontSize:32, fontWeight:800, marginBottom:8 }}>MarkKalkylator Pro</div>
        <div style={{ fontSize:20, color:"#3B6FD4", fontWeight:700, marginBottom:8 }}>399 kr / månad</div>
        <div style={{ color:"#64748B", marginBottom:32 }}>14 dagars gratis provperiod · Ingen bindningstid</div>
        <button
          onClick={handleCheckout}
          disabled={loading}
          style={{ background:"#3B6FD4", color:"white", border:"none", borderRadius:12, padding:"16px 48px", fontSize:18, fontWeight:700, cursor:"pointer" }}
        >
          {loading ? "Laddar..." : "Starta gratis provperiod"}
        </button>
      </div>
    </div>
  );
}
