import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg,#F8FAFF 0%,#EEF2F7 100%)",
      fontFamily: "Inter,-apple-system,sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg,#1A2030,#3B6FD4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, margin: "0 auto 16px",
            boxShadow: "0 4px 16px rgba(59,111,212,0.4)",
          }}>🏗️</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em" }}>
            Logga in på MarkKalkyl
          </div>
          <div style={{ fontSize: 14, color: "#64748B", marginTop: 6 }}>
            Välkommen tillbaka
          </div>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: { width: "100%" },
              card: {
                borderRadius: 16,
                boxShadow: "0 8px 48px rgba(0,0,0,0.12)",
                border: "1px solid rgba(0,0,0,0.07)",
              },
            },
          }}
          forceRedirectUrl="/verktyg"
          signUpUrl="/registrera"
        />
      </div>
    </div>
  );
}
