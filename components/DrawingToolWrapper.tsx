"use client";

import dynamic from "next/dynamic";

// Client-komponent som laddar DrawingTool enbart på klienten.
// ssr: false eliminerar hydration-mismatch eftersom DrawingTool
// använder canvas, pdfjs och window-API:er som inte finns på servern.
const DrawingTool = dynamic(() => import("./DrawingTool"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        color: "#6B7280",
        fontSize: 16,
      }}
    >
      Laddar ritverktyg...
    </div>
  ),
});

export default DrawingTool;
