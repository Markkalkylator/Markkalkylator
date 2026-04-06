import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MarkKalkyl — Mängdberäkning & Offert för Mark & Anläggning",
  description:
    "Ladda upp din PDF-ritning, mät ytor och längder direkt på skärmen och generera professionella offerter på sekunder. Byggt för svenska mark- och anläggningsentreprenörer.",
};

const FEATURES = [
  {
    icon: "📐",
    title: "Mät direkt på ritningen",
    desc: "Ladda upp valfri PDF-ritning och kalibrera skalan. Rita polygoner, linjer och rektanglar — programmet räknar m² och m åt dig.",
  },
  {
    icon: "📄",
    title: "Professionella offerter",
    desc: "Generera snygga PDF-offerter med ditt företagsnamn, logga, kunduppgifter och komplett mängdförteckning med moms.",
  },
  {
    icon: "📊",
    title: "Excel-export",
    desc: "Exportera hela mängdförteckningen till .xlsx med ett klick — redo att skicka till underentreprenörer.",
  },
  {
    icon: "⛏",
    title: "Massabalans",
    desc: "Räkna ut schaktvolym (m³) automatiskt från uppmätt yta × djup. Se direkt om du har överskott eller behöver köpa fyllnad.",
  },
  {
    icon: "🗂",
    title: "Flersidiga ritningar",
    desc: "Bläddra mellan sidor i komplexa flersidiga PDF:er och mät på varje sida separat.",
  },
  {
    icon: "📋",
    title: "Projektmallar",
    desc: "Spara dina vanligaste materialuppsättningar som mallar och ladda in dem i nästa projekt med ett klick.",
  },
];

const PLANS = [
  {
    name: "Gratis",
    price: "0",
    period: "",
    desc: "Testa utan kreditkort",
    cta: "Kom igång gratis",
    href: "/verktyg",
    highlight: false,
    features: [
      "3 projekt",
      "PDF-uppladdning & mätning",
      "Offertgenerering",
      "MarkKalkyl-varumärke på offerten",
    ],
  },
  {
    name: "Pro",
    price: "399",
    period: "/mån",
    desc: "För aktiva entreprenörer",
    cta: "Starta 14 dagars test",
    href: "/checkout?plan=pro",
    highlight: true,
    features: [
      "Obegränsat antal projekt",
      "Eget varumärke på offerten",
      "Excel-export",
      "Massabalans",
      "Projektmallar",
      "Flersidiga PDF:er",
      "Molnsynk & delning",
      "E-postsupport",
    ],
  },
  {
    name: "Team",
    price: "999",
    period: "/mån",
    desc: "Upp till 5 användare",
    cta: "Kontakta oss",
    href: "mailto:hej@markkalkylator.se",
    highlight: false,
    features: [
      "Allt i Pro",
      "Upp till 5 användare",
      "Delat projektbibliotek",
      "Prioriterad support",
      "Faktura (30 dagar netto)",
    ],
  },
];

const TESTIMONIALS = [
  {
    quote:
      "Vi sparar minst två timmar per offert. Förut satt vi och räknade med linjal och miniräknare — nu är det klart på tio minuter.",
    name: "Anders Lindqvist",
    role: "Markentreprenör, Göteborg",
  },
  {
    quote:
      "Äntligen ett svenskt program som faktiskt funkar för markarbeten. Har testat internationella alternativ men de är för krångliga.",
    name: "Maria Holm",
    role: "Kalkylator, Stockholm",
  },
  {
    quote:
      "Massabalansen är guld värd. Vet direkt om vi behöver beställa fyllnad eller köra bort schaktmassor.",
    name: "Erik Svensson",
    role: "Platschef, Malmö",
  },
];

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "Inter,-apple-system,BlinkMacSystemFont,sans-serif", color: "#0F172A", background: "#fff" }}>

      {/* ── NAVBAR ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 clamp(20px,5vw,80px)", height: 60,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: "linear-gradient(135deg,#1A2030,#3B6FD4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, boxShadow: "0 2px 8px rgba(59,111,212,0.35)",
          }}>🏗️</div>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.01em" }}>MarkKalkyl</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/logga-in" className="nav-login" style={{
            padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 500,
            color: "#475569", textDecoration: "none",
          }}>Logga in</Link>
          <Link href="/verktyg" className="nav-cta" style={{
            padding: "9px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700,
            background: "linear-gradient(135deg,#1A2030,#2C3A58)",
            color: "#fff", textDecoration: "none",
            boxShadow: "0 2px 12px rgba(26,32,48,0.3)",
          }}>Testa gratis →</Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        padding: "clamp(60px,10vw,120px) clamp(20px,5vw,80px) clamp(40px,6vw,80px)",
        textAlign: "center",
        background: "linear-gradient(180deg,#F8FAFF 0%,#ffffff 100%)",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(59,111,212,0.08)", border: "1px solid rgba(59,111,212,0.2)",
          borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 600,
          color: "#3B6FD4", marginBottom: 28, letterSpacing: "0.02em",
        }}>
          🇸🇪 Byggt för svenska mark- och anläggningsentreprenörer
        </div>

        <h1 style={{
          fontSize: "clamp(32px,6vw,68px)", fontWeight: 900,
          lineHeight: 1.08, letterSpacing: "-0.03em",
          margin: "0 auto 24px", maxWidth: 780,
          background: "linear-gradient(135deg,#0F172A 0%,#334155 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          Mängdberäkning och offert på&nbsp;minuter
        </h1>

        <p style={{
          fontSize: "clamp(16px,2vw,20px)", color: "#475569", lineHeight: 1.7,
          maxWidth: 580, margin: "0 auto 40px",
        }}>
          Ladda upp din PDF-ritning, rita ytor och linjer direkt på skärmen och generera
          en professionell offert — utan CAD-kunskap och utan krångel.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/verktyg" style={{
            padding: "15px 32px", borderRadius: 12, fontSize: 16, fontWeight: 700,
            background: "linear-gradient(135deg,#1A2030,#2C3A58)",
            color: "#fff", textDecoration: "none",
            boxShadow: "0 4px 24px rgba(26,32,48,0.35)",
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            Kom igång gratis <span style={{ fontSize: 18 }}>→</span>
          </Link>
          <a href="#funktioner" style={{
            padding: "15px 28px", borderRadius: 12, fontSize: 16, fontWeight: 600,
            background: "#fff", color: "#334155", textDecoration: "none",
            border: "1px solid rgba(0,0,0,0.12)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}>
            Se hur det fungerar
          </a>
        </div>

        <p style={{ marginTop: 20, fontSize: 13, color: "#94A3B8" }}>
          Inget kreditkort krävs · Klart på 2 minuter
        </p>

        {/* App-förhandsgranskning */}
        <div style={{
          marginTop: 60, borderRadius: 20, overflow: "hidden",
          boxShadow: "0 30px 100px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)",
          background: "#EEF0F4", maxWidth: 960, margin: "60px auto 0",
          aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid rgba(0,0,0,0.08)",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🏗️</div>
            <div style={{ fontSize: 15, color: "#94A3B8", fontWeight: 500, marginBottom: 20 }}>
              Klicka nedan för att prova direkt
            </div>
            <Link href="/verktyg" style={{
              display: "inline-block", padding: "12px 28px",
              background: "#1A2030", color: "#fff", borderRadius: 10,
              fontSize: 14, fontWeight: 700, textDecoration: "none",
            }}>Öppna verktyget →</Link>
          </div>
        </div>
      </section>

      {/* ── FUNKTIONER ── */}
      <section id="funktioner" style={{
        padding: "clamp(60px,8vw,100px) clamp(20px,5vw,80px)",
        background: "#F8FAFC",
      }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "#3B6FD4", textTransform: "uppercase", marginBottom: 12 }}>
            Funktioner
          </div>
          <h2 style={{ fontSize: "clamp(26px,4vw,42px)", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
            Allt du behöver för mark-kalkylen
          </h2>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 24, maxWidth: 1080, margin: "0 auto",
        }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{
              background: "#fff", borderRadius: 16, padding: "28px 28px 24px",
              border: "1px solid rgba(0,0,0,0.07)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "linear-gradient(135deg,#EEF2FF,#E0E7FF)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, marginBottom: 16,
              }}>{f.icon}</div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px", letterSpacing: "-0.01em" }}>
                {f.title}
              </h3>
              <p style={{ fontSize: 14, color: "#64748B", lineHeight: 1.7, margin: 0 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRISER ── */}
      <section id="priser" style={{
        padding: "clamp(60px,8vw,100px) clamp(20px,5vw,80px)",
        background: "#fff",
      }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "#3B6FD4", textTransform: "uppercase", marginBottom: 12 }}>
            Priser
          </div>
          <h2 style={{ fontSize: "clamp(26px,4vw,42px)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 16px" }}>
            Enkla, transparenta priser
          </h2>
          <p style={{ fontSize: 16, color: "#64748B", margin: 0 }}>
            Inga bindningstider. Avsluta när du vill.
          </p>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 24, maxWidth: 960, margin: "0 auto",
        }}>
          {PLANS.map((plan) => (
            <div key={plan.name} style={{
              borderRadius: 20, padding: "32px 28px 28px",
              background: plan.highlight ? "linear-gradient(145deg,#1A2030,#2C3A58)" : "#F8FAFC",
              border: plan.highlight ? "none" : "1px solid rgba(0,0,0,0.08)",
              boxShadow: plan.highlight ? "0 20px 60px rgba(26,32,48,0.4)" : "0 2px 12px rgba(0,0,0,0.04)",
              position: "relative", transform: plan.highlight ? "scale(1.03)" : "none",
            }}>
              {plan.highlight && (
                <div style={{
                  position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
                  background: "linear-gradient(90deg,#3B6FD4,#60A5FA)",
                  color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
                  padding: "4px 14px", borderRadius: 20, textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}>
                  Mest populär
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 600, color: plan.highlight ? "rgba(255,255,255,0.6)" : "#94A3B8", marginBottom: 8 }}>
                {plan.name}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: plan.highlight ? "#fff" : "#0F172A", letterSpacing: "-0.02em" }}>
                  {plan.price}
                </span>
                <span style={{ fontSize: 14, color: plan.highlight ? "rgba(255,255,255,0.6)" : "#64748B" }}>
                  {plan.price === "0" ? "kr" : `kr${plan.period}`}
                </span>
              </div>
              <p style={{ fontSize: 13, color: plan.highlight ? "rgba(255,255,255,0.55)" : "#94A3B8", marginBottom: 28, margin: "0 0 28px" }}>
                {plan.desc}
              </p>

              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
                {plan.features.map((feat) => (
                  <li key={feat} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14 }}>
                    <span style={{ color: plan.highlight ? "#60A5FA" : "#3B6FD4", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span style={{ color: plan.highlight ? "rgba(255,255,255,0.85)" : "#334155" }}>{feat}</span>
                  </li>
                ))}
              </ul>

              <Link href={plan.href} style={{
                display: "block", textAlign: "center",
                padding: "13px 0", borderRadius: 11, fontSize: 14, fontWeight: 700,
                textDecoration: "none",
                background: plan.highlight ? "#fff" : "#1A2030",
                color: plan.highlight ? "#1A2030" : "#fff",
                boxShadow: plan.highlight ? "0 4px 16px rgba(0,0,0,0.2)" : "none",
              }}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p style={{ textAlign: "center", marginTop: 40, fontSize: 13, color: "#94A3B8" }}>
          Alla priser exkl. moms · Betala med kort · Faktura tillgängligt för Team
        </p>
      </section>

      {/* ── OMDÖMEN ── */}
      <section style={{
        padding: "clamp(60px,8vw,100px) clamp(20px,5vw,80px)",
        background: "#F8FAFC",
      }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: "clamp(24px,3.5vw,38px)", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
            Vad säger användarna?
          </h2>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 20, maxWidth: 960, margin: "0 auto",
        }}>
          {TESTIMONIALS.map((t) => (
            <div key={t.name} style={{
              background: "#fff", borderRadius: 16, padding: "24px 24px 20px",
              border: "1px solid rgba(0,0,0,0.07)",
              boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize: 28, color: "#3B6FD4", marginBottom: 12, fontWeight: 900, lineHeight: 1 }}>"</div>
              <p style={{ fontSize: 15, color: "#334155", lineHeight: 1.7, margin: "0 0 20px" }}>
                {t.quote}
              </p>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{t.name}</div>
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{
        padding: "clamp(60px,8vw,100px) clamp(20px,5vw,80px)",
        background: "linear-gradient(135deg,#1A2030 0%,#2C3A58 100%)",
        textAlign: "center",
      }}>
        <h2 style={{ fontSize: "clamp(26px,4vw,44px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.02em", margin: "0 0 20px" }}>
          Redo att spara tid på varje offert?
        </h2>
        <p style={{ fontSize: 17, color: "rgba(255,255,255,0.65)", margin: "0 0 36px" }}>
          Kom igång på 2 minuter. Inget kreditkort krävs.
        </p>
        <Link href="/verktyg" style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "16px 36px", borderRadius: 12, fontSize: 17, fontWeight: 800,
          background: "#fff", color: "#1A2030", textDecoration: "none",
          boxShadow: "0 4px 28px rgba(0,0,0,0.3)",
          letterSpacing: "-0.01em",
        }}>
          Starta gratis nu <span style={{ fontSize: 20 }}>→</span>
        </Link>
      </section>

      {/* ── OM OSS ── */}
      <section style={{
        padding: "clamp(40px,6vw,72px) clamp(20px,5vw,80px)",
        background: "#fff", borderTop: "1px solid rgba(0,0,0,0.07)",
      }}>
        <div style={{
          maxWidth: 720, margin: "0 auto", display: "flex",
          gap: "clamp(24px,4vw,64px)", alignItems: "flex-start", flexWrap: "wrap",
        }}>
          <div style={{ flex: "1 1 280px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "#3B6FD4", textTransform: "uppercase", marginBottom: 12 }}>
              Om MarkKalkyl
            </div>
            <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.8, margin: 0 }}>
              MarkKalkyl utvecklas och drivs av <strong style={{ color: "#0F172A" }}>Karlssons Stensättning AB</strong> —
              ett aktivt mark- och anläggningsföretag med lång erfarenhet av stensättning, markarbeten och VA.
              Verktyget är byggt för att lösa de utmaningar vi själva möter varje dag: snabb och exakt
              mängdberäkning direkt från ritningen och professionella offerter utan onödig administration.
            </p>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "#3B6FD4", textTransform: "uppercase", marginBottom: 12 }}>
              Kontakt
            </div>
            <div style={{ fontSize: 14, color: "#475569", lineHeight: 2 }}>
              <div><strong style={{ color: "#0F172A" }}>Karlssons Stensättning AB</strong></div>
              <div>
                <Link href="mailto:hej@markkalkylator.se" style={{ color: "#3B6FD4", textDecoration: "none" }}>
                  hej@markkalkylator.se
                </Link>
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#94A3B8" }}>
                Org.nr visas vid fakturering
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        padding: "24px clamp(20px,5vw,80px)",
        background: "#0F172A",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 16, fontSize: 13,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: "linear-gradient(135deg,#1A2030,#3B6FD4)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
          }}>🏗️</div>
          <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>MarkKalkyl</span>
          <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
            Karlssons Stensättning AB © {new Date().getFullYear()}
          </span>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {([["Integritetspolicy", "/integritet"], ["Villkor", "/villkor"], ["Kontakt", "mailto:hej@markkalkylator.se"]] as [string, string][]).map(([label, href]) => (
            <Link key={label} href={href} style={{ color: "rgba(255,255,255,0.35)", textDecoration: "none", fontSize: 13 }}>
              {label}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
