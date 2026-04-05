import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "MarkKalkyl — Mängdberäkning & Offert",
  description: "Professionell mängdberäkning och offertgenerering för svenska mark- och anläggningsentreprenörer.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"),
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MarkKalkyl",
  },
  openGraph: {
    title: "MarkKalkyl",
    description: "Mängdberäkning och offert på minuter — byggt för mark & anläggning.",
    type: "website",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="sv" className={inter.variable}>
        <head>
          <meta name="theme-color" content="#1A2030" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        </head>
        <body style={{ margin: 0, padding: 0 }}>
          {children}
          <script dangerouslySetInnerHTML={{ __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js')
                  .then(function(reg) { console.log('SW registrerad:', reg.scope); })
                  .catch(function(err) { console.log('SW misslyckades:', err); });
              });
            }
          `}} />
        </body>
      </html>
    </ClerkProvider>
  );
}
