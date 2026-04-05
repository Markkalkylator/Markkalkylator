import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MarkKalkyl — Mängdberäkning & Offert",
    short_name: "MarkKalkyl",
    description: "Mängdberäkning och offertgenerering för mark & anläggning",
    start_url: "/verktyg",
    display: "standalone",
    background_color: "#EEF0F4",
    theme_color: "#1A2030",
    orientation: "landscape",
    categories: ["business", "productivity", "utilities"],
    lang: "sv",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: "Nytt projekt",
        short_name: "Nytt",
        description: "Öppna verktyget",
        url: "/verktyg",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
