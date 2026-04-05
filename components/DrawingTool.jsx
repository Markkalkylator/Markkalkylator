"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

// ─── Math helpers ─────────────────────────────────────────────────────────────

function shoelaceArea(pts) {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function dist(a, b)          { return Math.hypot(b.x - a.x, b.y - a.y); }
function clamp(v, lo, hi)    { return Math.max(lo, Math.min(hi, v)); }
// Snappa till närmaste 45°-riktning från `from`
function snapTo45(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: from.x + len * Math.cos(snapped), y: from.y + len * Math.sin(snapped) };
}
function isNear(a, b, t = 12){ return dist(a, b) < t; }
function centroid(pts)       { return { x: pts.reduce((s,p)=>s+p.x,0)/pts.length, y: pts.reduce((s,p)=>s+p.y,0)/pts.length }; }
function midPt(a, b)         { return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }; }

function fmtN(v, d = 1) {
  return Number(v).toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtSEK(v) {
  return Number(v).toLocaleString("sv-SE", { style:"currency", currency:"SEK", maximumFractionDigits:0 });
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const MATERIALS = [
  { id:"m1", label:"Asfalt",           unit:"m²", price:250, color:"#64748B", geo:"area" },
  { id:"m2", label:"Grus / Makadam",   unit:"m²", price:120, color:"#CA8A04", geo:"area" },
  { id:"m3", label:"Betongplatta",     unit:"m²", price:420, color:"#818CF8", geo:"area" },
  { id:"m4", label:"Natursten",        unit:"m²", price:520, color:"#D97706", geo:"area" },
  { id:"m5", label:"Gräsyta",          unit:"m²", price: 95, color:"#34D399", geo:"area" },
  { id:"m6", label:"Schakt",           unit:"m²", price:180, color:"#F87171", geo:"area" },
  { id:"m7", label:"Kantsten granit",  unit:"m",  price:310, color:"#38BDF8", geo:"line" },
  { id:"m8", label:"Betongkantsten",   unit:"m",  price:220, color:"#A78BFA", geo:"line" },
];

// ─── Design tokens — white & silver metallic luxury ──────────────────────────

const T = {
  bg0:     "#EEF0F4",          // cool silver-white app background
  bg1:     "#FFFFFF",          // pure white panels
  bg2:     "rgba(255,255,255,0.7)",  // glass surface
  bg3:     "rgba(0,0,0,0.03)", // hover tint
  bgPanel: "rgba(255,255,255,0.92)", // blurred panel
  border:  "rgba(0,0,0,0.08)",
  borderS: "rgba(0,0,0,0.15)",
  // Metallic silver gradients
  metalGrad: "linear-gradient(135deg,#D4D8E2 0%,#ECEEF3 45%,#C2C6D2 100%)",
  metalBtn:  "linear-gradient(160deg,#E2E5EC 0%,#F5F6F9 50%,#CDD0D8 100%)",
  metalDark: "linear-gradient(160deg,#2C3344 0%,#1A2030 100%)",
  // Typography
  bg:        "#1A2030",         // dark charcoal — used in gradients
  accent:    "#1A2030",         // deep charcoal — primary CTA
  accentSoft:"rgba(26,32,48,0.07)",
  accentBlue:"#3B6FD4",        // selective blue accent
  text:      "#111318",        // near-black
  textSub:   "#3A3F4A",        // secondary text
  muted:     "#8A909E",        // muted labels
  dim:       "#B0B6C3",        // very muted
  green:     "#0A7C54",
  greenSoft: "rgba(10,124,84,0.1)",
  yellow:    "#B07D10",
  red:       "#C4281C",
  redSoft:   "rgba(196,40,28,0.08)",
};

// ─── Global styles ────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @keyframes spin      { to { transform: rotate(360deg); } }
  @keyframes fadeIn    { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
  @keyframes calPulse  { 0%,100% { box-shadow: 0 0 0 2px rgba(59,111,212,0.25); } 50% { box-shadow: 0 0 0 4px rgba(59,111,212,0.55); } }
  .cal-pulse { animation: calPulse 1.8s ease-in-out infinite; }
  /* ── Mobil/Surfplatta ─────────────────────────────────────── */
  @media (max-width: 900px) {
    .mobile-hide { display: none !important; }
    .mobile-compact { padding: 4px 8px !important; font-size: 10px !important; }
    .lux-btn { min-height: 40px; min-width: 40px; }
  }
  @media (max-width: 640px) {
    .aside-panel { width: 220px !important; min-width: 220px !important; }
    .topbar-logo { display: none !important; }
    header { height: 48px !important; }
  }
  /* Större klickyta på alla knappar på touch-enheter */
  @media (hover: none) and (pointer: coarse) {
    .lux-btn { min-height: 44px; min-width: 44px; padding: 8px 14px !important; }
    button { min-height: 44px; }
  }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.22); }
  .lux-btn { transition: all 0.16s cubic-bezier(.4,0,.2,1); }
  .lux-btn:hover { filter: brightness(1.06); transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
  .lux-btn:active { transform: translateY(0); filter: brightness(0.97); }
  .lux-card { transition: border-color 0.18s, box-shadow 0.18s, background 0.18s; }
  .lux-card:hover { border-color: rgba(0,0,0,0.14) !important; box-shadow: 0 2px 12px rgba(0,0,0,0.08) !important; }
  .lux-input:focus { outline: none; border-color: rgba(59,111,212,0.5) !important; box-shadow: 0 0 0 3px rgba(59,111,212,0.1) !important; }
`;

// ─── Micro-components ─────────────────────────────────────────────────────────

function Divider() {
  return <div style={{ height:1, background:"rgba(0,0,0,0.07)", margin:"6px 0" }} />;
}

function PanelLabel({ icon, children }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 0 5px",
      fontSize:9, fontWeight:700, color:T.muted, letterSpacing:"0.14em",
      textTransform:"uppercase", fontFamily:"Inter,sans-serif" }}>
      {icon && <span style={{ fontSize:10, opacity:0.6 }}>{icon}</span>}
      {children}
    </div>
  );
}

function IconBtn({ active, onClick, title, children, accent }) {
  const col = accent || T.accentBlue;
  return (
    <button title={title} onClick={onClick} className="lux-btn" style={{
      display:"flex", alignItems:"center", justifyContent:"center", gap:5,
      padding:"6px 12px",
      border: active ? `1px solid rgba(59,111,212,0.35)` : "1px solid rgba(0,0,0,0.1)",
      borderRadius:8,
      background: active
        ? "linear-gradient(135deg,rgba(59,111,212,0.12),rgba(59,111,212,0.06))"
        : T.metalBtn,
      color: active ? "#2655B8" : T.textSub,
      fontSize:11.5, fontWeight: active ? 600 : 400,
      cursor:"pointer", whiteSpace:"nowrap",
      fontFamily:"Inter,sans-serif",
      boxShadow: active ? "0 0 0 1px rgba(59,111,212,0.15), 0 1px 4px rgba(0,0,0,0.08)"
                       : "0 1px 3px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
    }}>
      {children}
    </button>
  );
}

function Badge({ children, color }) {
  return (
    <span style={{ padding:"2px 7px", borderRadius:20, fontSize:9, fontWeight:700,
      background:"rgba(0,0,0,0.06)", color:T.muted,
      letterSpacing:"0.07em", fontFamily:"Inter,sans-serif" }}>
      {children}
    </span>
  );
}

function StatRow({ label, value, unit, mono }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"5px 0", borderBottom:"1px solid rgba(0,0,0,0.055)" }}>
      <span style={{ fontSize:11, color:T.muted, fontFamily:"Inter,sans-serif" }}>{label}</span>
      <span style={{ fontSize:12, color:T.text,
        fontFamily: mono?"'SF Mono','Fira Code',monospace":"Inter,sans-serif", fontWeight:600 }}>
        {value}{unit && <span style={{ fontSize:9.5, color:T.dim, marginLeft:3 }}>{unit}</span>}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DrawingTool({ pdfUrl = null, pixelsPerMeter: initPpm = 100 }) {
  const canvasRef   = useRef(null);
  const viewportRef = useRef(null);
  const zoomRef     = useRef(1);
  const panRef      = useRef({ x:0, y:0 });
  const shiftRef    = useRef(false);
  const curPtsRef   = useRef([]);
  const historyRef  = useRef([]);

  const [canvasSize, setCanvasSize] = useState({ width:900, height:640 });
  const [pdfStatus,  setPdfStatus]  = useState("idle");

  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x:0, y:0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [panning,   setPanning]   = useState(false);
  const [panStart,  setPanStart]  = useState(null);

  const [mode,       setMode]       = useState("draw");
  const [drawType,   setDrawType]   = useState("area"); // "area" | "line" | "rect"
  const [showDrawMenu,  setShowDrawMenu]  = useState(false);
  const [showProjMenu,  setShowProjMenu]  = useState(false); // Projekt-dropdown
  const [objects,    setObjects]    = useState([]);
  const [curPts,     setCurPts]     = useState([]);
  const [mousePos,   setMousePos]   = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, objectId } — högerklicksmeny
  const [dragging,   setDragging]   = useState(null);

  // ── Lager (Layers) ────────────────────────────────────────────────────
  const [layers, setLayers] = useState([
    { id:"ly-1", name:"Markarbeten", color:"#3B6FD4", visible:true },
    { id:"ly-2", name:"Kantsten & VA", color:"#38BDF8", visible:true },
  ]);
  const [activeLayerId, setActiveLayerId] = useState("ly-1");
  const [editLayerName, setEditLayerName] = useState(null);

  // ── Import coordinates ────────────────────────────────────────────────
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  // ── Slope calculation ─────────────────────────────────────────────────
  const [slopeInputs, setSlopeInputs] = useState({});
  const [showSlopeFor, setShowSlopeFor] = useState(null);

  const [materials, setMaterials] = useState(MATERIALS);
  const [selMatId,  setSelMatId]  = useState(MATERIALS[0].id);

  const [ppm,      setPpm]      = useState(initPpm);
  const [calPts,   setCalPts]   = useState([]);
  const [projName, setProjName] = useState("Namnlöst projekt");

  const [panel,      setPanel]      = useState("tools");   // tools | materials | summary
  const [editingMat, setEditingMat] = useState(null);
  const [showLabels, setShowLabels] = useState(true);

  // ── Företagsinformation (visas på offerten) ───────────────────────────
  const [companyName, setCompanyName] = useState("");
  const [companyInfo, setCompanyInfo] = useState("");   // adress, org.nr, telefon etc.
  const [companyLogo, setCompanyLogo] = useState(null); // base64 data-URL

  // ── Extra rader på offerten (t.ex. fast pris, resor, ritagrunder) ────
  const [extraRows,    setExtraRows]    = useState([]);  // [{id, label, amount}]
  const [showCompanyForm, setShowCompanyForm] = useState(false);

  // ── Kunduppgifter på offerten ─────────────────────────────────────────
  const [customerName,    setCustomerName]    = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerOrgNr,   setCustomerOrgNr]   = useState("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);

  // ── Mätlinjal (mät avstånd utan kalkyl) ──────────────────────────────
  const [measurePts,   setMeasurePts]   = useState([]);        // 0 eller 1 punkt under pågående mätning
  const [measurements, setMeasurements] = useState([]);        // [{id, a, b, distM}]
  const [selMeasureId, setSelMeasureId] = useState(null);

  // ── Anteckningar ──────────────────────────────────────────────────────
  const [notes,         setNotes]         = useState([]);      // [{id, x, y, text}]
  const [editingNoteId, setEditingNoteId] = useState(null);    // id för notat som redigeras
  const [pendingNote,   setPendingNote]   = useState(null);    // {x,y} ny notat innan text
  const [selNoteId,     setSelNoteId]     = useState(null);

  // ── Export ────────────────────────────────────────────────────────────────
  const [exportStatus, setExportStatus] = useState(null); // null | "exporting" | "done"

  // ── Projekthistorik + molnsynk ─────────────────────────────────────────────
  const [showProjectHistory, setShowProjectHistory] = useState(false);
  const [savedProjects,      setSavedProjects]      = useState([]);
  const [saveStatus,         setSaveStatus]         = useState(null); // null | "saving" | "saved" | "error"
  const [cloudProjectId,     setCloudProjectId]     = useState(null); // ID för sparat molnprojekt
  const [shareToast,         setShareToast]         = useState(false); // "Länk kopierad!"

  // ── Onboarding ────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem("mw_onboarded"); } catch { return true; }
  });
  const [onboardStep, setOnboardStep] = useState(0);

  // ── Feature 1: Undo/Ångra ─────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const MAX_HISTORY = 40;

  // ── Feature 2: Auto-scale detection ────────────────────────────────────────
  const [autoScaleDetected, setAutoScaleDetected] = useState(null);

  // ── Projektmallar ────────────────────────────────────────────────────────
  const [templates,        setTemplates]        = useState(() => {
    try { return JSON.parse(localStorage.getItem("mw_templates")||"[]"); } catch { return []; }
  });
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [newTplName,        setNewTplName]        = useState("");

  // ── Massabalans ──────────────────────────────────────────────────────────
  const [massDepth,     setMassDepth]     = useState(""); // schaktdjup i meter
  const [massFillVol,   setMassFillVol]   = useState(""); // fyllnad m³ (manuellt)
  const [showMassPanel, setShowMassPanel] = useState(false);

  // ── Multi-sida PDF ───────────────────────────────────────────────────────
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfTotalPages,  setPdfTotalPages]  = useState(1);
  const pdfDocRef = useRef(null); // håller kvar laddad pdf-doc

  // ── Feature 3: Offert-status + Anteckningar ──────────────────────────────
  const [offerStatus, setOfferStatus] = useState("draft"); // "draft"|"sent"|"negotiating"|"accepted"|"rejected"
  const [offerNotes,  setOfferNotes]  = useState(""); // fritext, visas längst ner på offerten

  // ── Feature 4: Foton ──────────────────────────────────────────────────────
  const [photos, setPhotos] = useState([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState(null);
  const [showPhotoViewer, setShowPhotoViewer] = useState(null);

  // ── Feature 5: Varumärke (branding) ───────────────────────────────────────
  const [brand, setBrand] = useState({
    primaryColor: "#1A2030",
    accentColor:  "#3B6FD4",
    appName:      "",
  });
  const [showBrandPanel, setShowBrandPanel] = useState(false);

  // ── Feature 6: Webhook integration ────────────────────────────────────────
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [showWebhookPanel, setShowWebhookPanel] = useState(false);

  // ── Hjälp / Guide ─────────────────────────────────────────────────────────
  const [showHelp, setShowHelp] = useState(false);
  const [helpTab,  setHelpTab]  = useState("verktyg"); // "verktyg"|"arbetsflode"|"kortkommandon"

  // ── Refs sync ─────────────────────────────────────────────────────────────
  useEffect(()=>{ zoomRef.current  = zoom;     },[zoom]);
  useEffect(()=>{ panRef.current   = pan;      },[pan]);
  useEffect(()=>{ shiftRef.current   = shiftHeld; },[shiftHeld]);
  useEffect(()=>{ curPtsRef.current  = curPts;    },[curPts]);
  useEffect(()=>{ historyRef.current = history;   },[history]);

  // ── Auto-load projekt från URL (?project=id) ──────────────────────────────
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("project");
    if (!pid) return;
    fetch(`/api/projects/${pid}`)
      .then(r=>r.ok?r.json():null)
      .then(p=>{ if(p && p.id) { loadProjectData(p); setCloudProjectId(p.id); } })
      .catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ── Render en specifik sida ur redan laddad pdf ───────────────────────────
  const renderPdfPage = useCallback(async (pdf, pageNum, detectScale) => {
    const page = await pdf.getPage(pageNum);
    const vp   = page.getViewport({ scale:2.0 });
    const canvas = canvasRef.current;
    const dpr    = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(vp.width  * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width  = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    setCanvasSize({ width:vp.width, height:vp.height });
    await page.render({ canvasContext:canvas.getContext("2d"), viewport:vp,
      transform: dpr!==1?[dpr,0,0,dpr,0,0]:null }).promise;
    if (detectScale) {
      try {
        const textContent = await page.getTextContent();
        const fullText = textContent.items.map(i=>i.str).join(' ');
        const scaleMatch = fullText.match(/(?:skala|scale|s\.)[:\s]*1\s*:\s*(\d+)|1\s*:\s*(\d+)/i);
        if (scaleMatch) {
          const ratio = parseInt(scaleMatch[1] || scaleMatch[2]);
          if (ratio > 0 && ratio <= 10000) {
            const ppmAuto = vp.width / (0.297 * ratio);
            if (ppmAuto > 1 && ppmAuto < 10000) {
              setPpm(ppmAuto);
              setAutoScaleDetected(`Skala 1:${ratio} detekterad — ppm satt automatiskt`);
              setTimeout(() => setAutoScaleDetected(null), 5000);
            }
          }
        }
      } catch(e) { }
    }
  }, []);

  // ── Load PDF (körs när fil byts) ──────────────────────────────────────────
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    setPdfStatus("loading");
    setPdfCurrentPage(1);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument(pdfUrl).promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPdfTotalPages(pdf.numPages);
        await renderPdfPage(pdf, 1, true);
        if (!cancelled) setPdfStatus("ready");
      } catch(e) { console.error(e); if(!cancelled) setPdfStatus("error"); }
    })();
    return ()=>{ cancelled=true; };
  }, [pdfUrl, renderPdfPage]);

  // ── Byt sida ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfDocRef.current || pdfStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        await renderPdfPage(pdfDocRef.current, pdfCurrentPage, false);
        if (!cancelled) fitScreen();
      } catch(e) { console.error(e); }
    })();
    return ()=>{ cancelled=true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfCurrentPage]);

  // ── Fit screen ────────────────────────────────────────────────────────────
  const fitScreen = useCallback(() => {
    if (!viewportRef.current || !canvasSize.width) return;
    const r = viewportRef.current.getBoundingClientRect();
    const z = clamp(Math.min((r.width-32)/canvasSize.width,(r.height-32)/canvasSize.height),0.05,5);
    setZoom(z);
    setPan({ x:(r.width-canvasSize.width*z)/2, y:(r.height-canvasSize.height*z)/2 });
  }, [canvasSize]);

  useEffect(()=>{ if(pdfStatus==="ready") fitScreen(); },[pdfStatus,fitScreen]);

  // ── Coord helper ──────────────────────────────────────────────────────────
  const svgPt = useCallback((e) => {
    const r = viewportRef.current.getBoundingClientRect();
    return { x:(e.clientX-r.left-panRef.current.x)/zoomRef.current,
             y:(e.clientY-r.top -panRef.current.y)/zoomRef.current };
  }, []);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const zoomBy = useCallback((f, ox, oy) => {
    const pz=zoomRef.current, pp=panRef.current, nz=clamp(pz*f,0.05,5);
    setZoom(nz);
    setPan({ x:ox-(ox-pp.x)/pz*nz, y:oy-(oy-pp.y)/pz*nz });
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const r = viewportRef.current.getBoundingClientRect();
    if (e.ctrlKey||e.metaKey||e.altKey) zoomBy(Math.exp(-e.deltaY*0.0018),e.clientX-r.left,e.clientY-r.top);
    else setPan(p=>({x:p.x-e.deltaX,y:p.y-e.deltaY}));
  },[zoomBy]);

  useEffect(()=>{
    const el=viewportRef.current; if(!el) return;
    el.addEventListener("wheel",handleWheel,{passive:false});
    return ()=>el.removeEventListener("wheel",handleWheel);
  },[handleWheel]);

  // ── Calibration ───────────────────────────────────────────────────────────
  const finishCal = useCallback((pt) => {
    if (calPts.length===0) { setCalPts([pt]); return; }
    const px   = dist(calPts[0], pt);
    const real = parseFloat(window.prompt("Ange det verkliga avståndet i meter:", "10"));
    if (!isNaN(real) && real>0) setPpm(px/real);
    setCalPts([]); setMode("draw");
  }, [calPts]);

  // ── History helper (Undo) ────────────────────────────────────────────────
  function pushHistory() {
    setHistory(h => [...h.slice(-(MAX_HISTORY-1)), { objects:[...objects], notes:[...notes], measurements:[...measurements] }]);
  }

  function undo() {
    const h = historyRef.current;
    if (h.length === 0) return;
    const prev = h[h.length - 1];
    setObjects(prev.objects);
    setNotes(prev.notes);
    setMeasurements(prev.measurements);
    setHistory(h.slice(0, -1));
  }

  // ── Close polygon ─────────────────────────────────────────────────────────
  const closePoly = useCallback(() => {
    if (curPts.length<3) return;
    pushHistory();
    const mat = materials.find(m=>m.id===selMatId) || materials[0];
    const geoType = drawType==="hole" ? "hole" : "area";
    setObjects(prev=>[...prev,{
      id:`o-${Date.now()}`, geo:geoType, pts:curPts,
      matId:mat.id, label:mat.label, color:mat.color, unit:mat.unit, price:mat.price,
      layerId: activeLayerId,
    }]);
    setCurPts([]);
  },[curPts,materials,selMatId,activeLayerId,drawType]);

  // ── SVG click ─────────────────────────────────────────────────────────────
  const handleSVGClick = useCallback((e) => {
    if (panning) return;
    // Ignorera om detta är ett dubbelklick (hanteras av handleSVGDblClick)
    if (e.detail >= 2) return;
    const rawPt = svgPt(e);
    // Shift-snap: lås till 45° om Shift hålls och det finns en föregående punkt
    const pts = curPtsRef.current;
    const pt = (shiftRef.current && pts.length > 0)
      ? snapTo45(pts[pts.length-1], rawPt)
      : rawPt;
    if (mode==="cal")  { finishCal(pt); return; }
    if (mode==="select") return;

    // ── Mätlinjal ────────────────────────────────────────────────────────
    if (mode==="measure") {
      if (measurePts.length===0) { setMeasurePts([pt]); return; }
      const distM = ppm > 0 ? dist(measurePts[0], pt) / ppm : 0;
      setMeasurements(prev=>[...prev,{ id:`m-${Date.now()}`, a:measurePts[0], b:pt, distM }]);
      setMeasurePts([]);
      return;
    }

    // ── Anteckningar ─────────────────────────────────────────────────────
    if (mode==="note") {
      if (e.target.tagName==="text"||e.target.closest?.("g[data-note]")) return;
      pushHistory();
      const id = `n-${Date.now()}`;
      setNotes(prev=>[...prev,{ id, x:pt.x, y:pt.y, text:"" }]);
      setEditingNoteId(id);
      setPendingNote(null);
      return;
    }

    // ── Foton ────────────────────────────────────────────────────────────
    if (mode==="photo") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          pushHistory();
          const id = `ph-${Date.now()}`;
          setPhotos(prev => [...prev, { id, x:pt.x, y:pt.y, dataUrl:e.target?.result, caption:"" }]);
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }

    if (mode!=="draw") return;
    const mat = materials.find(m=>m.id===selMatId)||materials[0];
    if (drawType==="area" || drawType==="hole") {
      if (curPts.length>=3 && isNear(pt,curPts[0])) { closePoly(); return; }
      if (e.target.tagName==="polygon"||e.target.tagName==="line") return;
      setCurPts(p=>[...p,pt]);
    } else if (drawType==="rect") {
      if (curPts.length===0) { setCurPts([pt]); return; }
      // Second click: create rectangle
      pushHistory();
      const cornerA = curPts[0];
      const cornerB = pt;
      const rect = [cornerA, {x:cornerB.x, y:cornerA.y}, cornerB, {x:cornerA.x, y:cornerB.y}];
      setObjects(prev=>[...prev,{
        id:`o-${Date.now()}`, geo:"area", pts:rect,
        matId:mat.id, label:mat.label, color:mat.color, unit:mat.unit, price:mat.price,
        layerId: activeLayerId,
      }]);
      setCurPts([]);
    } else if (drawType==="polyline") {
      setCurPts(p=>[...p,pt]);
    } else {
      if (curPts.length===0) { setCurPts([pt]); return; }
      pushHistory();
      setObjects(prev=>[...prev,{
        id:`o-${Date.now()}`, geo:"line", start:curPts[0], end:pt,
        matId:mat.id, label:mat.label, color:mat.color, unit:mat.unit, price:mat.price,
        layerId: activeLayerId,
      }]);
      setCurPts([]);
    }
  },[panning,mode,drawType,measurePts,ppm,svgPt,curPts,materials,selMatId,closePoly,finishCal,activeLayerId]);

  // ── SVG double-click: stäng polygon / avsluta polyline ───────────────────
  const handleSVGDblClick = useCallback((e) => {
    e.preventDefault();
    if (panning || mode !== "draw") return;
    if ((drawType === "area" || drawType === "hole") && curPtsRef.current.length >= 3) {
      closePoly();
      return;
    }
    if (drawType === "polyline" && curPtsRef.current.length >= 2) {
      pushHistory();
      const pts = curPtsRef.current;
      const mat = materials.find(m=>m.id===selMatId)||materials[0];
      setObjects(prev=>[...prev,{
        id:`o-${Date.now()}`, geo:"polyline", pts,
        matId:mat.id, label:mat.label, color:mat.color, unit:mat.unit, price:mat.price,
        layerId: activeLayerId,
      }]);
      setCurPts([]);
    }
  },[panning,mode,drawType,closePoly,materials,selMatId,activeLayerId]);

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e) => {
    if (panning && panStart) {
      setPan({x:panStart.px+e.clientX-panStart.mx,y:panStart.py+e.clientY-panStart.my});
      return;
    }
    setMousePos(svgPt(e));
    if (dragging && mode==="select") {
      const pt=svgPt(e);
      setObjects(prev=>prev.map(o=>{
        if (o.id!==dragging.id) return o;
        if (o.geo==="area" || o.geo==="polyline") { const np=[...o.pts]; np[dragging.idx]=pt; return {...o,pts:np}; }
        if (dragging.role==="start") return {...o,start:pt};
        if (dragging.role==="end")   return {...o,end:pt};
        return o;
      }));
    }
  },[panning,panStart,svgPt,dragging,mode]);

  const handleMouseUp   = useCallback(()=>{
    if (dragging && mode==="select") { pushHistory(); }
    setPanning(false);setPanStart(null);setDragging(null);
  },[dragging,mode]);
  const handleMouseDown = useCallback((e)=>{
    if (spaceHeld) {
      e.preventDefault();
      setPanning(true);
      setPanStart({mx:e.clientX,my:e.clientY,px:panRef.current.x,py:panRef.current.y});
    }
  },[spaceHeld]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const kd=(e)=>{
      if(e.code==="Space"){e.preventDefault();setSpaceHeld(true);}
      if(e.code==="ShiftLeft"||e.code==="ShiftRight") setShiftHeld(true);
      // Materialgenvägar 1–8 (ej i textfält)
      if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){
        const idx=parseInt(e.key)-1;
        if(idx>=0&&idx<=7){
          setMaterials(prev=>{ const m=prev[idx]; if(m){ setSelMatId(m.id); } return prev; });
        }
      }
      if((e.ctrlKey||e.metaKey)&&e.key==="z"){e.preventDefault();undo();}
      if(e.key==="?"&&!e.ctrlKey&&!e.metaKey&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){
        setShowHelp(v=>!v);
      }
      if(e.key==="Escape"){
        if(showHelp){ setShowHelp(false); return; }
        setCurPts([]);setSelectedId(null);setCalPts([]);
        setShowDrawMenu(false);setMeasurePts([]);
        setEditingNoteId(null);setPendingNote(null);setSelNoteId(null);setSelMeasureId(null);
        setShowImportModal(false);setImportText("");setImportError("");
        setSelectedPhotoId(null);
        if(mode==="cal")setMode("draw");
      }
      if(e.key==="Enter"&&mode==="draw"&&(drawType==="area"||drawType==="rect"||drawType==="hole")) closePoly();
      if(e.key==="Enter"&&mode==="draw"&&drawType==="polyline"&&curPts.length>=2){
        pushHistory();
        const mat = materials.find(m=>m.id===selMatId) || materials[0];
        setObjects(prev=>[...prev,{
          id:`o-${Date.now()}`, geo:"polyline", pts:curPts,
          matId:mat.id, label:mat.label, color:mat.color, unit:mat.unit, price:mat.price,
          layerId: activeLayerId,
        }]);
        setCurPts([]);
      }
      if(e.key==="Delete"||e.key==="Backspace"){
        if(editingNoteId) return; // låt textredigering hantera det
        if(selectedId){ pushHistory(); setObjects(p=>p.filter(o=>o.id!==selectedId)); setSelectedId(null); }
        if(selNoteId){ pushHistory(); setNotes(p=>p.filter(n=>n.id!==selNoteId)); setSelNoteId(null); }
        if(selMeasureId){ pushHistory(); setMeasurements(p=>p.filter(m=>m.id!==selMeasureId)); setSelMeasureId(null); }
        if(selectedPhotoId){ pushHistory(); setPhotos(p=>p.filter(ph=>ph.id!==selectedPhotoId)); setSelectedPhotoId(null); }
      }
    };
    const ku=(e)=>{
      if(e.code==="Space") setSpaceHeld(false);
      if(e.code==="ShiftLeft"||e.code==="ShiftRight") setShiftHeld(false);
    };
    window.addEventListener("keydown",kd);
    window.addEventListener("keyup",ku);
    window.addEventListener("mouseup",handleMouseUp);
    return ()=>{
      window.removeEventListener("keydown",kd);
      window.removeEventListener("keyup",ku);
      window.removeEventListener("mouseup",handleMouseUp);
    };
  },[mode,drawType,selectedId,selNoteId,selMeasureId,editingNoteId,closePoly,handleMouseUp,selectedPhotoId,curPts,materials,selMatId,activeLayerId]);

  // ── Touch / pinch-zoom handlers ────────────────────────────────────────────
  const touchRef = useRef({ touches:[], lastDist:0, lastMid:{x:0,y:0} });

  const handleTouchStart = useCallback((e) => {
    const t = touchRef.current;
    t.touches = Array.from(e.touches);
    if (t.touches.length === 2) {
      const [a, b] = t.touches;
      t.lastDist = Math.hypot(b.clientX-a.clientX, b.clientY-a.clientY);
      t.lastMid = { x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2 };
    } else if (t.touches.length === 1) {
      // Single finger pan with two-finger mode flag
      t.panStart = { px:panRef.current.x, py:panRef.current.y,
        mx:t.touches[0].clientX, my:t.touches[0].clientY };
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
    const t = touchRef.current;
    t.touches = Array.from(e.touches);
    if (t.touches.length === 2) {
      const [a, b] = t.touches;
      const newDist = Math.hypot(b.clientX-a.clientX, b.clientY-a.clientY);
      const mid = { x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2 };
      if (t.lastDist > 0) {
        const factor = newDist / t.lastDist;
        if (!viewportRef.current) return;
        const r = viewportRef.current.getBoundingClientRect();
        zoomBy(factor, mid.x - r.left, mid.y - r.top);
      }
      t.lastDist = newDist;
      t.lastMid = mid;
    } else if (t.touches.length === 1 && t.panStart) {
      const dx = t.touches[0].clientX - t.panStart.mx;
      const dy = t.touches[0].clientY - t.panStart.my;
      setPan({ x:t.panStart.px+dx, y:t.panStart.py+dy });
    }
  }, [zoomBy]);

  const handleTouchEnd = useCallback(() => {
    touchRef.current.touches = [];
    touchRef.current.lastDist = 0;
    touchRef.current.panStart = null;
  }, []);

  // ── Calculations ──────────────────────────────────────────────────────────
  const rows = useMemo(()=>{
    const map={};
    for(const o of objects){
      const lyr = layers.find(l=>l.id===o.layerId);
      if(lyr?.visible===false) continue;
      let qty;
      if(o.geo==="area")      qty =  shoelaceArea(o.pts)/(ppm*ppm);
      else if(o.geo==="hole") qty = -shoelaceArea(o.pts)/(ppm*ppm); // avdrag
      else if(o.geo==="polyline") qty=o.pts.reduce((s,p,i)=>i===0?0:s+dist(o.pts[i-1],p),0)/ppm;
      else qty=dist(o.start,o.end)/ppm;
      if(!map[o.matId])map[o.matId]={label:o.label,unit:o.unit,price:o.price,color:o.color,qty:0};
      map[o.matId].qty+=qty;
    }
    return Object.values(map)
      .map(r=>({...r, qty:Math.max(0,r.qty), total:Math.max(0,r.qty)*r.price }))
      .filter(r=>r.qty>0||r.total>0);
  },[objects,ppm,layers]);

  const grandTotal = useMemo(()=>rows.reduce((s,r)=>s+r.total,0),[rows]);

  const totalArea = useMemo(()=>{
    let a = 0;
    for(const o of objects){
      if(o.geo==="area") a += shoelaceArea(o.pts)/(ppm*ppm);
      else if(o.geo==="hole") a -= shoelaceArea(o.pts)/(ppm*ppm);
    }
    return Math.max(0, a);
  },[objects,ppm]);

  // ── Print offer ───────────────────────────────────────────────────────────
  function printOffer() {
    const date    = new Date().toLocaleDateString("sv-SE",{year:"numeric",month:"long",day:"numeric"});
    const offerNr = `${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    // Summera extra rader
    const extraTotal = extraRows.reduce((s,r)=>s+Number(r.amount||0),0);
    const exVat  = grandTotal + extraTotal;
    const vat    = exVat * 0.25;
    const incVat = exVat + vat;

    // Accentfärg (från varumärkesinställning eller default)
    const accent = brand.accentColor || "#3B6FD4";

    // Materialposter
    const matRowsHtml = rows.length===0
      ? `<tr><td colspan="4" class="empty">Inga mätposter — lägg till material och rita ytor/linjer</td></tr>`
      : rows.map((r,i)=>`
        <tr class="${i%2===0?"even":"odd"}">
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:12px;height:12px;border-radius:${r.unit==="m"?"3px":"50%"};background:${r.color};flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></div>
              <div>
                <div style="font-weight:600;color:#0F172A">${r.label}</div>
                <div style="font-size:10px;color:#94A3B8">${r.unit==="m²"?"Yta":"Längd"}</div>
              </div>
            </div>
          </td>
          <td class="num">${fmtN(r.qty,2)} ${r.unit}</td>
          <td class="num">${fmtSEK(r.price)}/${r.unit}</td>
          <td class="num bold">${fmtSEK(r.total)}</td>
        </tr>`).join("");

    // Extra rader
    const extraRowsHtml = extraRows.filter(r=>r.label||r.amount).map(r=>`
      <tr class="extra-row">
        <td colspan="3" style="font-style:italic;color:#475569">${r.label||"(ej namngivet)"}</td>
        <td class="num bold">${fmtSEK(Number(r.amount||0))}</td>
      </tr>`).join("");

    // Logga
    const logoHtml = companyLogo
      ? `<img src="${companyLogo}" style="max-height:80px;max-width:220px;object-fit:contain;display:block;margin-bottom:8px" />`
      : `<div style="width:48px;height:48px;border-radius:14px;background:${accent};display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:22px">🏗️</div>`;

    // Företagsinfo
    const brandHtml = companyName
      ? `${logoHtml}<div class="brand">${companyName}</div><div class="company-info">${companyInfo.replace(/\n/g,"<br>")}</div>`
      : `${logoHtml}<div class="brand">Mark &amp; Anläggning</div><div class="company-info">Mängdberäkning &amp; Kalkyl</div>`;

    // Offert-status badge
    const statusMap = { draft:"Utkast", sent:"Skickad", negotiating:"Förhandling", accepted:"Accepterad", rejected:"Avvisad" };
    const statusColorMap = { draft:"#94A3B8", sent:"#3B6FD4", negotiating:"#B07D10", accepted:"#0A7C54", rejected:"#C4281C" };
    const statusBadge = `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:${statusColorMap[offerStatus]}20;color:${statusColorMap[offerStatus]};border:1px solid ${statusColorMap[offerStatus]}40">${statusMap[offerStatus]||offerStatus}</span>`;

    const win = window.open("","_blank","width=900,height=900");
    if (!win) { alert("Popup blockerades — tillåt popup för den här sidan"); return; }
    win.document.write(`<!DOCTYPE html>
<html lang="sv"><head>
<meta charset="utf-8">
<title>Offert ${offerNr} — ${projName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,sans-serif;background:#EEF2F7;color:#0F172A;padding:40px 20px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{background:#fff;max-width:800px;margin:0 auto;border-radius:16px;box-shadow:0 8px 48px rgba(0,0,0,0.12);overflow:hidden}

  /* ── TOPPLIST ──────────────────────────────── */
  .topbar{height:6px;background:linear-gradient(90deg,${accent},${accent}88)}

  /* ── HEADER ────────────────────────────────── */
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding:40px 48px 32px;border-bottom:1px solid #E2E8F0}
  .brand{font-size:20px;font-weight:800;color:#0F172A;letter-spacing:-0.02em;margin-bottom:2px}
  .company-info{font-size:11px;color:#64748B;line-height:1.7;margin-top:4px}
  .header-right{text-align:right}
  .offer-title{font-size:13px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px}
  .offer-nr{font-size:22px;font-weight:800;color:#0F172A;font-variant-numeric:tabular-nums;margin-bottom:8px}
  .meta-line{font-size:12px;color:#64748B;line-height:1.8}

  /* ── KUND ────────────────────────────────── */
  .customer-block{margin-top:16px;padding:14px 18px;background:#F1F5F9;border-radius:10px;font-size:12px;color:#334155;line-height:1.8}
  .customer-label{font-size:9px;font-weight:700;letter-spacing:0.12em;color:#94A3B8;text-transform:uppercase;margin-bottom:6px}
  .customer-name{font-size:14px;font-weight:700;color:#0F172A;margin-bottom:2px}

  /* ── PROJEKTNAMN ─────────────────────────── */
  .proj-section{padding:24px 48px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between}
  .proj-label{font-size:10px;font-weight:700;letter-spacing:0.1em;color:#94A3B8;text-transform:uppercase;margin-bottom:4px}
  .proj-name{font-size:18px;font-weight:700;color:#0F172A}

  /* ── TABELL ──────────────────────────────── */
  .table-section{padding:0 48px 24px}
  .section-title{font-size:10px;font-weight:700;letter-spacing:0.1em;color:#94A3B8;text-transform:uppercase;padding:28px 0 12px}
  table{width:100%;border-collapse:collapse}
  thead tr{background:#F1F5F9}
  th{font-size:10px;font-weight:700;letter-spacing:0.08em;color:#64748B;text-transform:uppercase;padding:12px 16px;text-align:left;border-bottom:2px solid ${accent}33}
  th:not(:first-child){text-align:right}
  td{padding:14px 16px;font-size:13px;color:#334155;border-bottom:1px solid #F1F5F9;vertical-align:middle}
  .num{text-align:right;font-family:'SF Mono','Fira Code',monospace;font-size:12px}
  .bold{font-weight:700;color:#0F172A}
  .even td{background:#fff}
  .odd td{background:#FAFBFD}
  .extra-row td{background:#FFFBEB;font-size:12px}
  .empty{text-align:center;color:#94A3B8;padding:28px!important;font-style:italic}
  tr:last-child td{border-bottom:none}

  /* ── TOTALSUMMERING ──────────────────────── */
  .totals-section{margin:0 48px 40px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden}
  .tot-header{padding:16px 24px;background:${accent};color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase}
  .tot-body{padding:16px 24px}
  .tot-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px}
  .tot-row .label{color:#64748B}
  .tot-row .val{font-family:'SF Mono','Fira Code',monospace;font-weight:600;color:#334155}
  .tot-divider{height:1px;background:#E2E8F0;margin:10px 0}
  .tot-row.grand .label{font-size:14px;font-weight:800;color:#0F172A}
  .tot-row.grand .val{font-size:22px;font-weight:800;color:${accent};font-family:'SF Mono','Fira Code',monospace}

  /* ── ANTECKNINGAR ─────────────────────────── */
  .notes-section{margin:0 48px 32px;padding:20px 24px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px}
  .notes-label{font-size:10px;font-weight:700;letter-spacing:0.1em;color:#B07D10;text-transform:uppercase;margin-bottom:10px}
  .notes-text{font-size:13px;color:#334155;line-height:1.8;white-space:pre-wrap}

  /* ── FOOTER ──────────────────────────────── */
  .footer{margin:0 48px;padding:24px 0;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:flex-end}
  .footer-note{font-size:10px;color:#94A3B8;line-height:1.9;max-width:420px}
  .footer-note strong{color:#64748B}
  .signature-block{text-align:right}
  .signature-line{width:160px;border-bottom:1px solid #CBD5E1;margin-bottom:6px;height:36px}
  .signature-label{font-size:10px;color:#94A3B8}

  /* ── PRINT-KNAPP ─────────────────────────── */
  .print-bar{background:#F1F5F9;padding:20px 48px;display:flex;gap:12px;align-items:center;justify-content:flex-end;border-top:1px solid #E2E8F0}
  .print-btn{padding:12px 28px;background:${accent};color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;letter-spacing:0.04em;box-shadow:0 4px 16px ${accent}55}
  .close-btn{padding:12px 20px;background:#fff;color:#64748B;border:1px solid #E2E8F0;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif}
  @media print{
    .print-bar{display:none}
    body{background:white;padding:0}
    .page{box-shadow:none;border-radius:0;max-width:none}
  }
</style>
</head><body>
<div class="page">
  <div class="topbar"></div>

  <div class="header">
    <div class="header-left">${brandHtml}</div>
    <div class="header-right">
      <div class="offer-title">Offert</div>
      <div class="offer-nr">${offerNr}</div>
      <div class="meta-line">
        Datum: <strong>${date}</strong><br>
        Giltig t.o.m.: <strong>${new Date(Date.now()+30*864e5).toLocaleDateString("sv-SE")}</strong>
      </div>
      ${customerName ? `<div class="customer-block">
        <div class="customer-label">Kund / Beställare</div>
        <div class="customer-name">${customerName}</div>
        ${customerAddress ? `<div>${customerAddress.replace(/\n/g,"<br>")}</div>` : ""}
        ${customerOrgNr ? `<div style="color:#64748B;font-size:11px">Org.nr: ${customerOrgNr}</div>` : ""}
      </div>` : ""}
    </div>
  </div>

  <div class="proj-section">
    <div>
      <div class="proj-label">Projekt</div>
      <div class="proj-name">${projName}</div>
    </div>
    <div>${statusBadge}</div>
  </div>

  <div class="table-section">
    <div class="section-title">Mängdförteckning</div>
    <table>
      <thead>
        <tr>
          <th>Material / Arbete</th>
          <th style="text-align:right">Mängd</th>
          <th style="text-align:right">Á-pris</th>
          <th style="text-align:right">Summa</th>
        </tr>
      </thead>
      <tbody>${matRowsHtml}${extraRowsHtml}</tbody>
    </table>
  </div>

  <div class="totals-section">
    <div class="tot-header">Sammanfattning</div>
    <div class="tot-body">
      <div class="tot-row"><span class="label">Nettosumma exkl. moms</span><span class="val">${fmtSEK(exVat)}</span></div>
      <div class="tot-row"><span class="label">Moms 25 %</span><span class="val">${fmtSEK(vat)}</span></div>
      <div class="tot-divider"></div>
      <div class="tot-row grand"><span class="label">Totalt inkl. moms</span><span class="val">${fmtSEK(incVat)}</span></div>
    </div>
  </div>

  ${offerNotes.trim() ? `<div class="notes-section">
    <div class="notes-label">📝 Anteckningar</div>
    <div class="notes-text">${offerNotes.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")}</div>
  </div>` : ""}

  <div class="footer">
    <div class="footer-note">
      Priserna avser uppmätta mängder enligt bifogad ritning.<br>
      <strong>Objekt:</strong> ${objects.length} st &nbsp;·&nbsp;
      <strong>Total yta:</strong> ${fmtN(totalArea,1)} m² &nbsp;·&nbsp;
      <strong>Skala:</strong> ${fmtN(ppm,1)} px/m<br>
      Betalningsvillkor: 30 dagar netto. Vid försenad betalning utgår dröjsmålsränta.
    </div>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-label">Underskrift</div>
    </div>
  </div>

  <div class="print-bar">
    <button class="close-btn" onclick="window.close()">Stäng</button>
    <button class="print-btn" onclick="window.print()">⎙ Skriv ut / Spara PDF</button>
  </div>
</div>
</body></html>`);
    win.document.close();
  }

  // ── Export Excel (XLSX) ───────────────────────────────────────────────────
  async function exportExcel() {
    const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
    const extraTotal = extraRows.reduce((s,r)=>s+Number(r.amount||0),0);
    const exVat  = grandTotal + extraTotal;
    const vat    = exVat * 0.25;
    const incVat = exVat + vat;

    // Rubrikrad
    const header = [["Material / Arbete", "Typ", "Mängd", "Enhet", "Á-pris (kr)", "Summa (kr)"]];

    // Materialposter
    const matData = rows.map(r => [r.label, r.unit==="m²"?"Yta":"Längd", fmtN(r.qty,2), r.unit, r.price, r.total]);

    // Extra rader
    const extraData = extraRows.filter(r=>r.label||r.amount).map(r => [r.label||"(ej namngivet)", "Extra", "", "", "", Number(r.amount||0)]);

    // Summering
    const sumData = [
      [],
      ["", "", "", "", "Netto exkl. moms:", exVat],
      ["", "", "", "", "Moms 25%:", vat],
      ["", "", "", "", "TOTALT inkl. moms:", incVat],
    ];

    const allRows = [...header, ...matData, ...extraData, ...sumData];
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    // Kolumnbredder
    ws["!cols"] = [{ wch:32 },{ wch:10 },{ wch:10 },{ wch:8 },{ wch:14 },{ wch:14 }];

    // Formatera priskolumner som valuta
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = 1; R <= range.e.r; R++) {
      ["E","F"].forEach(col => {
        const cell = ws[`${col}${R+1}`];
        if (cell && typeof cell.v === "number") cell.z = '#,##0.00" kr"';
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mängdförteckning");
    const safeName = (projName||"Projekt").replace(/[^a-zA-Z0-9_\-åäöÅÄÖ ]/g,"").trim();
    XLSX.writeFile(wb, `${safeName}_mängd.xlsx`);
  }

  // ── Export PNG ────────────────────────────────────────────────────────────
  function exportPNG() {
    const src = canvasRef.current;
    if (!src) return;
    setExportStatus("exporting");
    const out = document.createElement("canvas");
    out.width  = canvasSize.width;
    out.height = canvasSize.height;
    const ctx = out.getContext("2d");
    // Klistra in PDF-bakgrunden (hantera DPR-skalning)
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, canvasSize.width, canvasSize.height);
    // Rita objekt
    for (const o of objects) {
      const lyr = layers.find(l=>l.id===o.layerId);
      if (lyr?.visible === false) continue;
      ctx.save();
      if (o.geo==="area") {
        ctx.beginPath();
        o.pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
        ctx.closePath();
        ctx.fillStyle   = o.color+"28"; ctx.fill();
        ctx.strokeStyle = o.color; ctx.lineWidth=1.5; ctx.stroke();
        if (showLabels) {
          const c=centroid(o.pts), qty=shoelaceArea(o.pts)/(ppm*ppm);
          const lbl=fmtN(qty,1)+" m²";
          ctx.font="bold 8px monospace"; ctx.textAlign="center";
          ctx.fillStyle="rgba(255,255,255,0.88)";
          ctx.fillRect(c.x-22,c.y-8,44,15);
          ctx.fillStyle=o.color; ctx.fillText(lbl,c.x,c.y+3);
        }
      } else {
        ctx.beginPath(); ctx.moveTo(o.start.x,o.start.y); ctx.lineTo(o.end.x,o.end.y);
        ctx.strokeStyle=o.color; ctx.lineWidth=1.8; ctx.stroke();
        if (showLabels) {
          const mp=midPt(o.start,o.end), qty=dist(o.start,o.end)/ppm;
          const lbl=fmtN(qty,1)+" m";
          ctx.font="bold 9px monospace"; ctx.textAlign="center";
          ctx.fillStyle="rgba(255,255,255,0.88)"; ctx.fillRect(mp.x-22,mp.y-8,44,15);
          ctx.fillStyle=o.color; ctx.fillText(lbl,mp.x,mp.y+3);
        }
      }
      ctx.restore();
    }
    // Rita mätlinjer
    for (const m of measurements) {
      ctx.save();
      ctx.strokeStyle="#0EA5E9"; ctx.lineWidth=1.5;
      ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(m.a.x,m.a.y); ctx.lineTo(m.b.x,m.b.y); ctx.stroke();
      const mp=midPt(m.a,m.b), lbl=fmtN(m.distM,2)+" m";
      ctx.setLineDash([]);
      ctx.font="bold 10px monospace"; ctx.textAlign="center";
      ctx.fillStyle="rgba(255,255,255,0.94)"; ctx.fillRect(mp.x-30,mp.y-11,60,18);
      ctx.fillStyle="#0369A1"; ctx.fillText(lbl,mp.x,mp.y+3);
      ctx.restore();
    }
    // Rita anteckningar
    for (const n of notes) {
      if (!n.text) continue;
      ctx.save();
      ctx.fillStyle="#F59E0B";
      ctx.beginPath(); ctx.arc(n.x,n.y,5,0,Math.PI*2); ctx.fill();
      ctx.font="11px Inter,sans-serif"; ctx.textAlign="left";
      ctx.fillStyle="rgba(255,255,255,0.92)";
      ctx.fillRect(n.x+8,n.y-10,n.text.length*6.5+12,18);
      ctx.fillStyle="#78350F"; ctx.fillText(n.text,n.x+14,n.y+3);
      ctx.restore();
    }
    const link = document.createElement("a");
    link.download = (projName||"ritning").replace(/\s+/g,"_")+".png";
    link.href = out.toDataURL("image/png");
    link.click();
    setExportStatus("done");
    setTimeout(()=>setExportStatus(null), 2500);
  }

  // ── Projekthistorik + molnsynk ─────────────────────────────────────────────

  function buildSnapshot(overrideId) {
    return {
      id: overrideId || cloudProjectId || null,
      name: projName, date: new Date().toISOString(),
      objects, notes, measurements, layers, activeLayerId,
      ppm, materials, extraRows, companyName, companyInfo, showLabels,
      photos, offerStatus, offerNotes, brand, companyLogo,
      customerName, customerAddress, customerOrgNr,
    };
  }

  // Gemensam laddning (används av loadProject och auto-load från URL)
  function loadProjectData(p) {
    setObjects(p.objects||[]);
    setNotes(p.notes||[]);
    setMeasurements(p.measurements||[]);
    setLayers(p.layers||[{id:"ly-1",name:"Markarbeten",color:"#3B6FD4",visible:true}]);
    setActiveLayerId(p.activeLayerId||"ly-1");
    setPpm(p.ppm||100);
    setProjName(p.name||"Namnlöst projekt");
    setMaterials(p.materials||MATERIALS);
    setExtraRows(p.extraRows||[]);
    setCompanyName(p.companyName||"");
    setCompanyInfo(p.companyInfo||"");
    setShowLabels(p.showLabels!==false);
    setPhotos(p.photos||[]);
    setOfferStatus(p.offerStatus||"draft");
    setOfferNotes(p.offerNotes||"");
    setCustomerName(p.customerName||"");
    setCustomerAddress(p.customerAddress||"");
    setCustomerOrgNr(p.customerOrgNr||"");
    setBrand(p.brand||{primaryColor:"#1A2030",accentColor:"#3B6FD4",appName:""});
    setCompanyLogo(p.companyLogo||null);
    setCurPts([]); setSelectedId(null); setMeasurePts([]);
  }

  // ── Mallar: spara/ladda ────────────────────────────────────────────────────
  function saveTemplate(name) {
    if (!name.trim()) return;
    const tpl = { id: Date.now(), name: name.trim(), materials: materials, created: new Date().toISOString() };
    const updated = [...templates, tpl];
    setTemplates(updated);
    try { localStorage.setItem("mw_templates", JSON.stringify(updated)); } catch {}
    setNewTplName("");
  }

  function loadTemplate(tpl) {
    setMaterials(tpl.materials);
  }

  function deleteTemplate(id) {
    const updated = templates.filter(t=>t.id!==id);
    setTemplates(updated);
    try { localStorage.setItem("mw_templates", JSON.stringify(updated)); } catch {}
  }

  async function openProjectHistory() {
    setShowProjectHistory(true);
    try {
      const res  = await fetch("/api/projects");
      const list = res.ok ? await res.json() : [];
      setSavedProjects(list);
    } catch { setSavedProjects([]); }
  }

  async function saveProject() {
    setSaveStatus("saving");
    try {
      const snapshot = buildSnapshot();
      const res  = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const { id } = await res.json();
      setCloudProjectId(id);
      // Uppdatera historiklistan om den är öppen
      setSavedProjects(prev => {
        const next = prev.filter(p=>p.id!==id);
        next.unshift({ id, name:projName, date:snapshot.date,
          nObjects:objects.length, layers:layers.map(l=>({id:l.id,name:l.name,color:l.color})) });
        return next;
      });
      setSaveStatus("saved");
      setTimeout(()=>setSaveStatus(null), 2500);
    } catch {
      setSaveStatus("error");
      setTimeout(()=>setSaveStatus(null), 3000);
    }
  }

  async function loadProject(p) {
    try {
      const res  = await fetch(`/api/projects/${p.id}`);
      const full = res.ok ? await res.json() : p;
      loadProjectData(full);
      setCloudProjectId(full.id);
    } catch { loadProjectData(p); setCloudProjectId(p.id); }
    setShowProjectHistory(false);
  }

  async function deleteProject(id) {
    try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); } catch {}
    setSavedProjects(prev => prev.filter(p=>p.id!==id));
    if (cloudProjectId===id) setCloudProjectId(null);
  }

  function copyShareLink() {
    if (!cloudProjectId) { saveProject().then(()=>{}); return; }
    const url = `${window.location.origin}${window.location.pathname}?project=${cloudProjectId}`;
    navigator.clipboard.writeText(url).catch(()=>{});
    setShareToast(true);
    setTimeout(()=>setShareToast(false), 2500);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const mat = materials.find(m=>m.id===selMatId)||materials[0];

  // Snappad musposition (Shift = 45°-lås mot senaste punkt)
  const effectiveMouse = useMemo(()=>{
    if (!mousePos || !shiftHeld || curPts.length===0 || mode!=="draw") return mousePos;
    return snapTo45(curPts[curPts.length-1], mousePos);
  }, [mousePos, shiftHeld, curPts, mode]);

  const snapToStart = drawType==="area"&&curPts.length>=3&&effectiveMouse&&isNear(effectiveMouse,curPts[0]);
  const preview     = curPts.length>0&&effectiveMouse
    ?(drawType==="area"||drawType==="polyline"?[...curPts,effectiveMouse]:[curPts[0],effectiveMouse]):null;
  const cursor = panning?"grabbing":spaceHeld?"grab":shiftHeld&&mode==="draw"?"crosshair":mode==="cal"?"crosshair":mode==="select"?"default":"crosshair";
  const zoomPct = Math.round(zoom*100);

  // ── Kontextkänslig statustext ──────────────────────────────────────────
  const statusHint = useMemo(() => {
    if (pdfStatus !== "ready") return "Ladda upp en PDF-ritning för att börja";
    if (ppm <= 1)              return "⚠️  Kalibrera skalan först — välj Kalibrera och klicka på två punkter med känd verklig längd";
    if (mode === "cal") {
      if (calPts.length === 0) return "Kalibrera: klicka på den första punkten (t.ex. ena änden av ett mått)";
      return "Kalibrera: klicka på den andra punkten, sedan ange den verkliga längden";
    }
    if (mode === "select") return "Välj ett objekt genom att klicka på det — dra för att flytta";
    if (mode === "measure") {
      if (measurePts.length === 0) return "Mätlinjal: klicka på startpunkt";
      return "Mätlinjal: klicka på slutpunkt för att mäta sträcka";
    }
    if (mode === "note")  return "Anteckning: klicka på ritningen där du vill placera en notering";
    if (mode === "photo") return "Foto: klicka på ritningen för att fästa ett foto på den platsen";
    if (mode === "draw") {
      if (drawType === "rect") {
        if (curPts.length === 0) return "Rektangel: klicka för att placera ett hörn";
        return "Rektangel: klicka för att placera det diagonalt motsatta hörnet";
      }
      if (drawType === "line") {
        if (curPts.length === 0) return "Linje (m): klicka för att placera startpunkt";
        return "Linje: klicka för att placera slutpunkt — håll Shift för att låsa 45°";
      }
      if (drawType === "area") {
        if (curPts.length === 0) return "Yta (m²): klicka för att lägga till den första punkten";
        if (curPts.length < 3)   return `Yta: ${curPts.length} punkt${curPts.length>1?"er":""} — fortsätt klicka för att rita polygonen`;
        return `Yta: ${curPts.length} punkter — klicka på startpunkten, tryck Enter eller dubbelklicka för att stänga`;
      }
      if (drawType === "polyline") {
        if (curPts.length === 0) return "Polylinje: klicka för att lägga till den första punkten";
        return `Polylinje: ${curPts.length} punkter — fortsätt klicka, tryck Enter eller dubbelklicka för att avsluta`;
      }
    }
    return "Välj ett verktyg i verktygsfältet ovan";
  }, [pdfStatus, ppm, mode, drawType, calPts.length, measurePts.length, curPts.length]);

  // ── Färgmatematik (client-side CIE Lab ΔE) ────────────────────────────
  function _hexToLab(hex) {
    const h = hex.replace("#","");
    const [r,g,b] = [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);
    const lin = c => c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
    const [rl,gl,bl] = [r,g,b].map(lin);
    const X=rl*0.4124564+gl*0.3575761+bl*0.1804375;
    const Y=rl*0.2126729+gl*0.7151522+bl*0.0721750;
    const Z=rl*0.0193339+gl*0.1191920+bl*0.9503041;
    const f=t=>t>0.008856?t**(1/3):7.787*t+16/116;
    return [116*f(Y)-16, 500*(f(X/0.95047)-f(Y)), 200*(f(Y)-f(Z/1.08883))];
  }
  function colorDeltaE(h1,h2) {
    try {
      const [L1,a1,b1]=_hexToLab(h1), [L2,a2,b2]=_hexToLab(h2);
      return Math.sqrt((L1-L2)**2+(a1-a2)**2+(b1-b2)**2);
    } catch { return 999; }
  }

  // ── Pixel-sampling från canvas inuti polygon ───────────────────────────
  function sampleCanvasPolygon(pts) {
    const canvas = canvasRef.current;
    if (!canvas || pts.length < 3) return null;
    const ctx = canvas.getContext("2d");

    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
    const x0=Math.max(0,Math.floor(Math.min(...xs)));
    const y0=Math.max(0,Math.floor(Math.min(...ys)));
    const x1=Math.min(canvas.width-1,Math.ceil(Math.max(...xs)));
    const y1=Math.min(canvas.height-1,Math.ceil(Math.max(...ys)));
    if (x1<=x0||y1<=y0) return null;

    const w=x1-x0+1, h=y1-y0+1;
    let imgData;
    try { imgData = ctx.getImageData(x0,y0,w,h); } catch { return null; }

    // Sampla var 3:e pixel → snabb utan att missa mönster
    const samples=[];
    for (let py=y0; py<=y1; py+=3) {
      for (let px=x0; px<=x1; px+=3) {
        // Point-in-polygon (ray casting)
        let inside=false, j=pts.length-1;
        for (let i=0;i<pts.length;i++) {
          const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;
          if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
          j=i;
        }
        if (inside) {
          const idx=((py-y0)*w+(px-x0))*4;
          samples.push([imgData.data[idx],imgData.data[idx+1],imgData.data[idx+2]]);
        }
      }
    }
    if (samples.length<5) return null;

    // ── Filtrera bort nära-vita bakgrundspixlar (papper, linjer, text) ──
    // Hatch-mönster = material-pixlar + massa vitt däremellan.
    // Medelvärdet av ALLA pixlar drar mot vitt → vi tar bara material-pixlarna.
    const BG_THRESH = 230; // pixlar ljusare än detta räknas som bakgrund
    const matSamples = samples.filter(([r,g,b]) =>
      !(r >= BG_THRESH && g >= BG_THRESH && b >= BG_THRESH)
    );
    // Fallback: om allt är ljust (t.ex. ljusgrå betong) sänk tröskeln
    const useSamples = matSamples.length >= 5 ? matSamples : samples;

    const n=useSamples.length;
    const meanR=useSamples.reduce((s,p)=>s+p[0],0)/n;
    const meanG=useSamples.reduce((s,p)=>s+p[1],0)/n;
    const meanB=useSamples.reduce((s,p)=>s+p[2],0)/n;

    // Texture = standardavvikelse på alla (inkl. bakgrund) → indikerar hatch
    const allN=samples.length;
    const aR=samples.reduce((s,p)=>s+p[0],0)/allN;
    const aG=samples.reduce((s,p)=>s+p[1],0)/allN;
    const aB=samples.reduce((s,p)=>s+p[2],0)/allN;
    const stdR=Math.sqrt(samples.reduce((s,p)=>s+(p[0]-aR)**2,0)/allN);
    const stdG=Math.sqrt(samples.reduce((s,p)=>s+(p[1]-aG)**2,0)/allN);
    const stdB=Math.sqrt(samples.reduce((s,p)=>s+(p[2]-aB)**2,0)/allN);
    const texture=(stdR+stdG+stdB)/3;

    const toHex = v=>`${Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")}`;
    const hex = `#${toHex(meanR)}${toHex(meanG)}${toHex(meanB)}`.toUpperCase();

    // bgRatio = andel bakgrundspixlar (hög → hatch-mönster)
    const bgRatio = Math.round((1 - matSamples.length / allN) * 100);

    return { hex, meanRGB:[Math.round(meanR),Math.round(meanG),Math.round(meanB)],
             texture:Math.round(texture*10)/10, nSamples:n, bgRatio };
  }

  // ── PDF-koordinater → canvas-pixlar ────────────────────────────────────
  // PDF-origo är nere-till-vänster; canvas-origo är uppe-till-vänster.
  function pdfPtToCanvas(pdfX, pdfY) {
    const dims = { width_pt:1190.55, height_pt:842 };
    const scaleX = canvasSize.width  / dims.width_pt;
    const scaleY = canvasSize.height / dims.height_pt;
    return { x: pdfX * scaleX, y: canvasSize.height - pdfY * scaleY };
  }

  // ── Konvertera PNG-pixlar → canvas-koordinater ────────────────────────
  // PNG-origo: uppe-till-vänster. Canvas-origo (pdfjs): uppe-till-vänster.
  // Ingen Y-flip behövs — båda koordinatsystemen har y=0 överst.
  // Netto: canvas_x = png_x * (canvas_w / png_w)
  //        canvas_y = png_y * (canvas_h / png_h)
  // ══════════════════════════════════════════════════════════════════════════

  const inputStyle = {
    width:"100%", padding:"8px 11px", borderRadius:9,
    border:"1px solid rgba(0,0,0,0.1)", background:"rgba(255,255,255,0.8)",
    color:T.text, fontSize:12, fontFamily:"Inter,sans-serif",
    outline:"none", transition:"border-color 0.15s, box-shadow 0.15s",
    boxShadow:"inset 0 1px 3px rgba(0,0,0,0.06)",
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden",
      fontFamily:"Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      background:T.bg0, color:T.text }}>

      <style>{GLOBAL_CSS}</style>

      {/* ══ TOP BAR ═══════════════════════════════════════════════════ */}
      <header style={{
        height:50, flexShrink:0, zIndex:20,
        display:"flex", alignItems:"center", gap:0,
        background:"rgba(255,255,255,0.92)",
        backdropFilter:"blur(24px)",
        borderBottom:"1px solid rgba(0,0,0,0.08)",
        boxShadow:"0 1px 0 rgba(255,255,255,0.8), 0 2px 14px rgba(0,0,0,0.06)",
      }}>

        {/* ── LOGO ───────────────────────────────────────────── */}
        <div className="topbar-logo" style={{
          width:220, display:"flex", alignItems:"center", gap:10,
          padding:"0 18px", height:"100%", flexShrink:0,
          borderRight:"1px solid rgba(0,0,0,0.07)",
          background:"linear-gradient(180deg,rgba(255,255,255,0.95) 0%,rgba(246,248,252,0.95) 100%)",
        }}>
          <div style={{
            width:28, height:28, borderRadius:8, flexShrink:0,
            background:`linear-gradient(135deg,${T.bg} 0%,${T.accentBlue} 100%)`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:14, boxShadow:`0 2px 8px ${T.accentBlue}44`,
          }}>🏗️</div>
          <div>
            <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:"0.04em", color:T.text }}>
              {brand.appName || "MarkKalkyl"}
            </div>
            <div style={{ fontSize:8.5, color:T.muted, letterSpacing:"0.14em", textTransform:"uppercase", marginTop:1 }}>
              Kalkylverktyg
            </div>
          </div>
        </div>

        {/* ── PROJEKTNAMN ─────────────────────────────────────── */}
        <div style={{ display:"flex", alignItems:"center", padding:"0 14px", gap:6, borderRight:"1px solid rgba(0,0,0,0.07)", height:"100%", minWidth:140, maxWidth:200, flexShrink:1 }}>
          <span style={{ fontSize:11, color:T.dim, flexShrink:0 }}>📁</span>
          <input
            value={projName} onChange={e=>setProjName(e.target.value)}
            onKeyDown={e=>e.stopPropagation()}
            style={{ background:"transparent", border:"none", outline:"none",
              fontSize:13, color:T.text, fontWeight:500, width:"100%",
              fontFamily:"Inter,sans-serif", letterSpacing:"0.01em" }}
            placeholder="Projektnamn…"
          />
        </div>

        {/* ── RITVERKTYG (pill group) ──────────────────────────── */}
        <div style={{ display:"flex", alignItems:"center", padding:"0 10px", gap:4, height:"100%", borderRight:"1px solid rgba(0,0,0,0.07)", flexShrink:0 }}>
          <div style={{
            display:"flex", gap:2, alignItems:"center",
            background:"rgba(0,0,0,0.04)", borderRadius:10,
            border:"1px solid rgba(0,0,0,0.08)", padding:"3px",
            boxShadow:"inset 0 1px 2px rgba(0,0,0,0.05)",
          }}>

            {/* Rita-knapp + dropdown */}
            <div style={{ position:"relative" }}>
              <div style={{ display:"flex", alignItems:"stretch", borderRadius:7,
                background: mode==="draw" ? `linear-gradient(135deg,${T.bg} 0%,#232B3E 100%)` : "transparent",
                boxShadow: mode==="draw" ? "0 2px 8px rgba(0,0,0,0.25)" : "none",
              }}>
                <button title="Rita (V)" className="lux-btn"
                  onClick={()=>{ setMode("draw"); setCurPts([]); setShowDrawMenu(false); }}
                  style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 10px",
                    background:"transparent", border:"none",
                    color: mode==="draw" ? "#fff" : T.textSub,
                    fontSize:12, fontWeight: mode==="draw" ? 700 : 500, cursor:"pointer",
                    fontFamily:"Inter,sans-serif", borderRadius:"7px 0 0 7px" }}>
                  <span style={{ fontSize:13 }}>{drawType==="area" ? "▦" : drawType==="rect" ? "⬜" : drawType==="hole" ? "⊘" : drawType==="polyline" ? "〜" : "╱"}</span>
                  <span>Rita</span>
                </button>
                <button title="Välj rittyp" className="lux-btn"
                  onClick={e=>{ e.stopPropagation(); setShowDrawMenu(v=>!v); }}
                  style={{ display:"flex", alignItems:"center", justifyContent:"center",
                    width:22, padding:0, background:"transparent",
                    borderTop:"none", borderBottom:"none", borderRight:"none",
                    borderLeft: mode==="draw" ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(0,0,0,0.08)",
                    color: mode==="draw" ? "rgba(255,255,255,0.7)" : T.dim,
                    fontSize:9, cursor:"pointer", borderRadius:"0 7px 7px 0" }}>▾</button>
              </div>
              {showDrawMenu && (
                <div style={{ position:"absolute", top:"calc(100% + 8px)", left:0, zIndex:200,
                  background:"#fff", borderRadius:12, border:"1px solid rgba(0,0,0,0.1)",
                  boxShadow:"0 12px 40px rgba(0,0,0,0.16)", overflow:"hidden", minWidth:190 }}
                  onMouseLeave={()=>setShowDrawMenu(false)}>
                  <div style={{ padding:"8px 12px 6px", fontSize:9.5, fontWeight:700, letterSpacing:"0.1em", color:T.muted, textTransform:"uppercase" }}>Välj rittyp</div>
                  {[
                    { type:"area",     icon:"▦",  label:"Rita yta",      sub:"m² · polygon" },
                    { type:"rect",     icon:"⬜",  label:"Rektangel",     sub:"m² · två klick" },
                    { type:"hole",     icon:"⊘",  label:"Hål / Avdrag",  sub:"m² · subtraheras" },
                    { type:"line",     icon:"╱",  label:"Rita sträcka",  sub:"m · linje" },
                    { type:"polyline", icon:"〜",  label:"Polylinje",     sub:"m · flersektion" },
                  ].map(opt=>(
                    <button key={opt.type} className="lux-btn"
                      onClick={()=>{ setDrawType(opt.type); setMode("draw"); setCurPts([]); setShowDrawMenu(false); const match=MATERIALS.find(m=>m.geo===opt.type); if(match) setSelMatId(match.id); }}
                      style={{ display:"flex", alignItems:"center", gap:10, width:"100%",
                        padding:"9px 14px", background:drawType===opt.type?`${T.accentBlue}0d`:"transparent",
                        border:"none", cursor:"pointer", textAlign:"left", fontFamily:"Inter,sans-serif",
                        borderBottom:"1px solid rgba(0,0,0,0.04)" }}>
                      <span style={{ fontSize:16, width:22, textAlign:"center" }}>{opt.icon}</span>
                      <span>
                        <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{opt.label}</div>
                        <div style={{ fontSize:10, color:T.muted }}>{opt.sub}</div>
                      </span>
                      {drawType===opt.type && <span style={{ marginLeft:"auto", color:T.accentBlue, fontSize:14 }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Övriga lägen */}
            {[
              { m:"select",  icon:"↖",  tip:"Välj & flytta (S)",    lbl:"Välj"  },
              { m:"measure", icon:"📏", tip:"Mät avstånd (M)",       lbl:"Mät"   },
              { m:"note",    icon:"📝", tip:"Anteckning (N)",         lbl:"Notat" },
              { m:"photo",   icon:"📷", tip:"Lägg till foto (P)",    lbl:"Foto"  },
            ].map(({m, icon, tip, lbl})=>{
              const active = mode===m;
              return (
                <button key={m} title={tip} className="lux-btn"
                  onClick={()=>{ setMode(m); setCurPts([]); setMeasurePts([]); setPendingNote(null); setEditingNoteId(null); setShowDrawMenu(false); }}
                  style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 10px", borderRadius:7,
                    background: active ? `linear-gradient(135deg,${T.bg} 0%,#232B3E 100%)` : "transparent",
                    border:"none", color: active ? "#fff" : T.textSub,
                    fontSize:12, fontWeight: active ? 700 : 500, cursor:"pointer",
                    fontFamily:"Inter,sans-serif",
                    boxShadow: active ? "0 2px 8px rgba(0,0,0,0.2)" : "none" }}>
                  <span style={{ fontSize:13 }}>{icon}</span>
                  <span>{lbl}</span>
                </button>
              );
            })}

            {/* Kalibrera — pulserar om den behövs */}
            {(()=>{
              const active = mode==="cal";
              const needsCal = ppm<=1 && pdfStatus==="ready";
              return (
                <button title="Kalibrera skala (C)" className={needsCal&&!active?"lux-btn cal-pulse":"lux-btn"}
                  onClick={()=>{ setMode("cal"); setCalPts([]); setCurPts([]); setShowDrawMenu(false); }}
                  style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 10px", borderRadius:7,
                    background: active ? `linear-gradient(135deg,${T.bg} 0%,#232B3E 100%)` : needsCal ? `${T.accentBlue}15` : "transparent",
                    border: needsCal&&!active ? `1px solid ${T.accentBlue}55` : "none",
                    color: active ? "#fff" : needsCal ? T.accentBlue : T.textSub,
                    fontSize:12, fontWeight: (active||needsCal) ? 700 : 500, cursor:"pointer",
                    fontFamily:"Inter,sans-serif",
                    boxShadow: active ? "0 2px 8px rgba(0,0,0,0.2)" : "none" }}>
                  <span style={{ fontSize:13 }}>📐</span>
                  <span>Kalibrera{needsCal&&!active?" ●":""}</span>
                </button>
              );
            })()}
          </div>
        </div>

        {/* ── VY-KONTROLLER ────────────────────────────────────── */}
        <div style={{ display:"flex", alignItems:"center", padding:"0 10px", gap:3, height:"100%", borderRight:"1px solid rgba(0,0,0,0.07)", flexShrink:0 }}>

          {/* Zoom */}
          <div style={{ display:"flex", alignItems:"center", gap:0,
            background:T.metalBtn, borderRadius:8, border:"1px solid rgba(0,0,0,0.09)",
            overflow:"hidden", boxShadow:"inset 0 1px 2px rgba(0,0,0,0.05)" }}>
            <button className="lux-btn" title="Zooma ut" onClick={()=>{ if(!viewportRef.current)return; const r=viewportRef.current.getBoundingClientRect(); zoomBy(1/1.3,r.width/2,r.height/2); }}
              style={{ border:"none", background:"none", color:T.muted, cursor:"pointer",
                width:28, height:30, fontSize:16, fontWeight:300,
                display:"flex", alignItems:"center", justifyContent:"center",
                borderRight:"1px solid rgba(0,0,0,0.07)" }}>−</button>
            <button className="lux-btn" title="Anpassa till skärm" onClick={fitScreen}
              style={{ border:"none", background:"none", fontSize:10.5, color:T.textSub,
                minWidth:42, height:30, cursor:"pointer", fontFamily:"'SF Mono','Fira Code',monospace",
                fontWeight:600, padding:"0 2px" }}>
              {zoomPct}%
            </button>
            <button className="lux-btn" title="Zooma in" onClick={()=>{ if(!viewportRef.current)return; const r=viewportRef.current.getBoundingClientRect(); zoomBy(1.3,r.width/2,r.height/2); }}
              style={{ border:"none", background:"none", color:T.muted, cursor:"pointer",
                width:28, height:30, fontSize:16, fontWeight:300,
                display:"flex", alignItems:"center", justifyContent:"center",
                borderLeft:"1px solid rgba(0,0,0,0.07)" }}>+</button>
          </div>

          {/* Centrera */}
          <button className="lux-btn" title="Centrera ritningen (Dubbeklicka på zoom)" onClick={fitScreen}
            style={{ width:30, height:30, borderRadius:8, border:"1px solid rgba(0,0,0,0.09)",
              background:T.metalBtn, color:T.textSub, fontSize:15, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"inset 0 1px 2px rgba(0,0,0,0.05)" }}>⊡</button>

          {/* Labels-toggle */}
          <button className="lux-btn" title={showLabels?"Dölj mått-etiketter":"Visa mått-etiketter"}
            onClick={()=>setShowLabels(v=>!v)}
            style={{ width:30, height:30, borderRadius:8,
              border: showLabels ? `1px solid ${T.accentBlue}44` : "1px solid rgba(0,0,0,0.09)",
              background: showLabels ? `${T.accentBlue}14` : T.metalBtn,
              color: showLabels ? T.accentBlue : T.textSub,
              fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow: showLabels ? `0 0 0 1px ${T.accentBlue}22` : "inset 0 1px 2px rgba(0,0,0,0.05)" }}>
            {showLabels ? "◉" : "◎"}
          </button>
        </div>

        {/* ── ÅNGRA ─────────────────────────────────────────────── */}
        <div style={{ display:"flex", alignItems:"center", padding:"0 10px", height:"100%", borderRight:"1px solid rgba(0,0,0,0.07)", flexShrink:0 }}>
          <button className="lux-btn" title={`Ångra (Ctrl+Z)${history.length>0?" · "+history.length+" steg":""}`}
            onClick={undo} disabled={history.length===0}
            style={{ display:"flex", alignItems:"center", gap:5, height:30, padding:"0 12px",
              borderRadius:8, fontFamily:"Inter,sans-serif", fontSize:12, cursor: history.length===0?"not-allowed":"pointer",
              border: history.length>0 ? `1px solid ${T.accentBlue}33` : "1px solid rgba(0,0,0,0.09)",
              background: history.length>0 ? `${T.accentBlue}12` : T.metalBtn,
              color: history.length===0 ? T.dim : T.accentBlue,
              fontWeight: history.length>0 ? 700 : 400, opacity: history.length===0?0.45:1,
              boxShadow: history.length>0 ? `0 0 0 1px ${T.accentBlue}18` : "inset 0 1px 2px rgba(0,0,0,0.05)" }}>
            <span style={{ fontSize:16, lineHeight:1 }}>↶</span>
            <span>Ångra{history.length>0?` (${history.length})`:""}</span>
          </button>
        </div>

        {/* ── PROJEKT-DROPDOWN (Spara · Dela · Historik · Export · Import) ── */}
        <div style={{ display:"flex", alignItems:"center", padding:"0 10px", height:"100%", borderRight:"1px solid rgba(0,0,0,0.07)", position:"relative", flexShrink:0 }}>
          {showProjMenu && <div style={{ position:"fixed", inset:0, zIndex:149 }} onClick={()=>setShowProjMenu(false)} />}
          <button className="lux-btn" onClick={()=>setShowProjMenu(v=>!v)}
            style={{ display:"flex", alignItems:"center", gap:6, height:30, padding:"0 12px",
              borderRadius:8, fontFamily:"Inter,sans-serif", fontSize:12, cursor:"pointer",
              border:"1px solid rgba(0,0,0,0.09)", background: showProjMenu ? `${T.accentBlue}12` : T.metalBtn,
              color: T.textSub, fontWeight:500,
              boxShadow:"inset 0 1px 2px rgba(0,0,0,0.05)" }}>
            <span style={{ fontSize:14 }}>☁</span>
            <span>Projekt</span>
            <span style={{ fontSize:9, color:T.dim, marginLeft:2 }}>▾</span>
          </button>
          {showProjMenu && (
            <div style={{ position:"absolute", top:"calc(100% + 8px)", left:10, zIndex:150,
              background:"rgba(255,255,255,0.98)", borderRadius:14,
              border:"1px solid rgba(0,0,0,0.1)",
              boxShadow:"0 12px 48px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)",
              backdropFilter:"blur(16px)", overflow:"hidden", minWidth:220,
              fontFamily:"Inter,sans-serif", animation:"fadeIn 0.14s ease" }}>
              {/* Spara */}
              <button onClick={()=>{ saveProject(); setShowProjMenu(false); }} className="lux-btn"
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 16px",
                  border:"none", background:"transparent", cursor: saveStatus==="saving"?"wait":"pointer",
                  textAlign:"left", borderBottom:"1px solid rgba(0,0,0,0.05)" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${T.accentBlue}08`}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{ fontSize:16, width:22, textAlign:"center" }}>
                  {saveStatus==="saving"?"⏳":saveStatus==="saved"?"✅":saveStatus==="error"?"⚠️":"☁️"}
                </span>
                <span>
                  <div style={{ fontSize:12, fontWeight:600, color: saveStatus==="saved"?T.green:saveStatus==="error"?T.red:T.text }}>
                    {saveStatus==="saving"?"Sparar…":saveStatus==="saved"?"Sparat!":saveStatus==="error"?"Fel vid sparande":"Spara projekt"}
                  </div>
                  <div style={{ fontSize:10, color:T.muted }}>Synkas till molnet</div>
                </span>
              </button>
              {/* Dela */}
              <button onClick={()=>{ copyShareLink(); setShowProjMenu(false); }} className="lux-btn"
                disabled={!cloudProjectId}
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 16px",
                  border:"none", background:"transparent", cursor:!cloudProjectId?"not-allowed":"pointer",
                  textAlign:"left", opacity:!cloudProjectId?0.45:1, borderBottom:"1px solid rgba(0,0,0,0.05)" }}
                onMouseEnter={e=>{ if(cloudProjectId) e.currentTarget.style.background=`${T.accentBlue}08`; }}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{ fontSize:16, width:22, textAlign:"center" }}>{shareToast?"✅":"🔗"}</span>
                <span>
                  <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{shareToast?"Länk kopierad!":"Dela länk"}</div>
                  <div style={{ fontSize:10, color:T.muted }}>{cloudProjectId?"Kopiera delningslänk":"Spara projektet först"}</div>
                </span>
              </button>
              {/* Historik */}
              <button onClick={()=>{ openProjectHistory(); setShowProjMenu(false); }} className="lux-btn"
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 16px",
                  border:"none", background:"transparent", cursor:"pointer",
                  textAlign:"left", borderBottom:"1px solid rgba(0,0,0,0.05)" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${T.accentBlue}08`}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{ fontSize:16, width:22, textAlign:"center" }}>📂</span>
                <span>
                  <div style={{ fontSize:12, fontWeight:600, color:T.text }}>Projekthistorik</div>
                  <div style={{ fontSize:10, color:T.muted }}>Öppna sparade projekt</div>
                </span>
              </button>
              <div style={{ height:1, background:"rgba(0,0,0,0.06)", margin:"2px 0" }} />
              {/* Exportera PNG */}
              <button onClick={()=>{ exportPNG(); setShowProjMenu(false); }} className="lux-btn"
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 16px",
                  border:"none", background:"transparent", cursor:"pointer",
                  textAlign:"left", borderBottom:"1px solid rgba(0,0,0,0.05)" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${T.accentBlue}08`}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{ fontSize:16, width:22, textAlign:"center" }}>🖼️</span>
                <span>
                  <div style={{ fontSize:12, fontWeight:600, color:T.text }}>
                    {exportStatus==="exporting"?"Exporterar…":exportStatus==="done"?"Exporterat ✓":"Exportera PNG"}
                  </div>
                  <div style={{ fontSize:10, color:T.muted }}>Spara ritning som bild</div>
                </span>
              </button>
              {/* Exportera Excel */}
              <button onClick={()=>{ exportExcel(); setShowProjMenu(false); }} className="lux-btn"
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 16px",
                  border:"none", background:"transparent", cursor:"pointer",
                  textAlign:"left", borderBottom:"1px solid rgba(0,0,0,0.05)" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${T.accentBlue}08`}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{ fontSize:16, width:22, textAlign:"center" }}>📊</span>
                <span>
                  <div style={{ fontSize:12, fontWeight:600, color:T.text }}>Exportera Excel</div>
                  <div style={{ fontSize:10, color:T.muted }}>Mängdförteckning som .xlsx</div>
                </span>
              </button>
              {/* Importera */}
              <button onClick={()=>{ setShowImportModal(true); setShowProjMenu(false); }} className="lux-btn"
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 16px",
                  border:"none", background:"transparent", cursor:"pointer", textAlign:"left" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${T.accentBlue}08`}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{ fontSize:16, width:22, textAlign:"center" }}>📥</span>
                <span>
                  <div style={{ fontSize:12, fontWeight:600, color:T.text }}>Importera XY</div>
                  <div style={{ fontSize:10, color:T.muted }}>Klistra in koordinater</div>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* ── INSTÄLLNINGAR (Varumärke) ─────────────────────────── */}
        <div style={{ display:"flex", alignItems:"center", padding:"0 8px", height:"100%", borderRight:"1px solid rgba(0,0,0,0.07)", position:"relative", flexShrink:0 }}>
          <button className="lux-btn" title="Varumärkesinställningar" onClick={()=>setShowBrandPanel(!showBrandPanel)}
            style={{ width:30, height:30, borderRadius:8, border:"1px solid rgba(0,0,0,0.09)",
              background: showBrandPanel ? `${T.accentBlue}12` : T.metalBtn,
              color:T.textSub, fontSize:15, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"inset 0 1px 2px rgba(0,0,0,0.05)" }}>⚙</button>
          {showBrandPanel && (
            <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, zIndex:200,
              background:"rgba(255,255,255,0.98)", borderRadius:14, border:"1px solid rgba(0,0,0,0.1)",
              boxShadow:"0 12px 48px rgba(0,0,0,0.16)", padding:18, minWidth:260,
              backdropFilter:"blur(16px)", animation:"fadeIn 0.14s ease" }}
              onClick={e=>e.stopPropagation()}>
              <div style={{ fontSize:12, fontWeight:700, color:T.text, marginBottom:14 }}>Varumärke</div>
              <div style={{ marginBottom:12 }}>
                <label style={{ display:"block", fontSize:11, fontWeight:600, color:T.muted, marginBottom:5 }}>App-namn</label>
                <input type="text" value={brand.appName||""} onChange={e=>setBrand({...brand,appName:e.target.value})}
                  onKeyDown={e=>e.stopPropagation()}
                  placeholder="Lämna tomt för standard" style={{ ...inputStyle, fontSize:12 }} />
              </div>
              <div style={{ display:"flex", gap:12 }}>
                <div style={{ flex:1 }}>
                  <label style={{ display:"block", fontSize:11, fontWeight:600, color:T.muted, marginBottom:5 }}>Primärfärg</label>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <input type="color" value={brand.primaryColor} onChange={e=>setBrand({...brand,primaryColor:e.target.value})}
                      style={{ width:42, height:34, borderRadius:7, border:"1px solid rgba(0,0,0,0.1)", cursor:"pointer", padding:2 }} />
                    <span style={{ fontSize:10, color:T.muted, fontFamily:"monospace" }}>{brand.primaryColor}</span>
                  </div>
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ display:"block", fontSize:11, fontWeight:600, color:T.muted, marginBottom:5 }}>Accentfärg</label>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <input type="color" value={brand.accentColor} onChange={e=>setBrand({...brand,accentColor:e.target.value})}
                      style={{ width:42, height:34, borderRadius:7, border:"1px solid rgba(0,0,0,0.1)", cursor:"pointer", padding:2 }} />
                    <span style={{ fontSize:10, color:T.muted, fontFamily:"monospace" }}>{brand.accentColor}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── HJÄLP ─────────────────────────────────────────────── */}
        <div style={{ display:"flex", alignItems:"center", padding:"0 8px", height:"100%", flexShrink:0 }}>
          <button className="lux-btn" title="Hjälp & Guide" onClick={()=>setShowHelp(true)}
            style={{ width:30, height:30, borderRadius:"50%",
              border:"1px solid rgba(0,0,0,0.1)", background:T.metalBtn,
              color:T.textSub, fontSize:13, fontWeight:700, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"inset 0 1px 2px rgba(0,0,0,0.05)" }}>?</button>
        </div>

        {/* ── GENERERA OFFERT (CTA) ─────────────────────────────── */}
        <div style={{ padding:"0 14px 0 8px", flexShrink:0, marginLeft:"auto" }}>
          <button onClick={printOffer} className="lux-btn" style={{
            padding:"8px 18px", height:34,
            background:`linear-gradient(135deg,${T.bg} 0%,#232B3E 100%)`,
            border:"1px solid rgba(255,255,255,0.06)",
            borderRadius:10, color:"#fff", fontSize:12, fontWeight:700,
            cursor:"pointer", letterSpacing:"0.02em", whiteSpace:"nowrap",
            boxShadow:"0 2px 12px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)",
            fontFamily:"Inter,sans-serif", display:"flex", alignItems:"center", gap:7,
          }}>
            <span>Generera offert</span>
            <span style={{ fontSize:14, opacity:0.8 }}>→</span>
          </button>
        </div>

      </header>

      {/* ══ BODY ═══════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

        {/* ── LEFT PANEL ─────────────────────────────────────────── */}
        <aside style={{
          width:272, flexShrink:0, overflow:"hidden",
          display:"flex", flexDirection:"column",
          background:"rgba(255,255,255,0.85)",
          backdropFilter:"blur(24px)",
          borderRight:"1px solid rgba(0,0,0,0.08)",
          boxShadow:"2px 0 16px rgba(0,0,0,0.05)",
        }}>

          {/* Tab bar */}
          <div style={{ padding:"10px 12px 0", flexShrink:0 }}>
            <div style={{ display:"flex",
              background:"rgba(0,0,0,0.05)",
              borderRadius:12, border:"1px solid rgba(0,0,0,0.07)",
              padding:3, gap:2,
              boxShadow:"inset 0 1px 3px rgba(0,0,0,0.06)" }}>
              {[["tools","Verktyg"],["layers","Lager"],["materials","Material"],["summary","Kalkyl"]].map(([id,lbl])=>(
                <button key={id} onClick={()=>setPanel(id)} style={{
                  flex:1, padding:"6px 0", border:"none",
                  borderRadius:9,
                  background: panel===id
                    ? "linear-gradient(160deg,#FFFFFF 0%,#F0F2F6 100%)"
                    : "transparent",
                  color: panel===id ? T.text : T.muted,
                  fontSize:10.5, fontWeight: panel===id ? 700 : 400,
                  letterSpacing:"0.02em", cursor:"pointer",
                  transition:"all 0.15s", fontFamily:"Inter,sans-serif",
                  boxShadow: panel===id
                    ? "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,1)"
                    : "none",
                }}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Scrollable content */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 14px" }}>

            {/* ─── VERKTYG ─────────────────────────────────────── */}
            {panel==="tools" && <div style={{ animation:"fadeIn 0.18s ease" }}>

              {/* Mode indicator */}
              <div style={{ padding:"12px 14px", borderRadius:13,
                background:"linear-gradient(160deg,#FFFFFF,#F7F8FB)",
                border:"1px solid rgba(0,0,0,0.08)",
                boxShadow:"0 2px 12px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,1)",
                marginBottom:14 }}>
                <div style={{ fontSize:9, color:T.muted, marginBottom:5,
                  letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:700 }}>Aktivt läge</div>
                <div style={{ fontSize:13.5, fontWeight:600, letterSpacing:"-0.01em",
                  color: mode==="draw"?T.accentBlue : mode==="cal"?T.yellow : T.green }}>
                  {mode==="draw"    && drawType==="area" ? "▦  Ritar yta (m²)" :
                   mode==="draw"    && drawType==="rect" ? "⬜  Ritar rektangel (m²)" :
                   mode==="draw"    && drawType==="line" ? "╱  Ritar sträcka (m)" :
                   mode==="select"  ? "↖  Välj & redigera" :
                   mode==="measure" ? "📐  Mätlinjal" :
                   mode==="note"    ? "📝  Anteckningar" :
                   "⚖  Kalibrering"}
                </div>
                {mode==="cal" && (
                  <div style={{ marginTop:5, fontSize:11, color:T.yellow }}>
                    {calPts.length===0?"① Klicka punkt A":"② Klicka punkt B — ange meter"}
                  </div>
                )}
                {mode==="draw" && drawType==="area" && curPts.length>0 && (
                  <div style={{ marginTop:5, fontSize:11, color:T.accentBlue }}>
                    {curPts.length} punkt{curPts.length!==1?"er":""} — Enter eller klicka start
                  </div>
                )}
                {mode==="draw" && drawType==="rect" && curPts.length>0 && (
                  <div style={{ marginTop:5, fontSize:11, color:T.accentBlue }}>
                    Hörn A satt — klicka hörn B
                  </div>
                )}
                {mode==="draw" && drawType==="line" && curPts.length>0 && (
                  <div style={{ marginTop:5, fontSize:11, color:T.accentBlue }}>
                    Startpunkt satt — klicka för att avsluta
                  </div>
                )}
                {mode==="measure" && (
                  <div style={{ marginTop:5, fontSize:11, color:"#0369A1" }}>
                    {measurePts.length===0?"① Klicka startpunkt":"② Klicka slutpunkt"}
                    {measurements.length>0 && <span style={{ color:T.muted }}> · {measurements.length} mätning{measurements.length!==1?"ar":""}</span>}
                  </div>
                )}
                {mode==="note" && (
                  <div style={{ marginTop:5, fontSize:11, color:"#92400E" }}>
                    {editingNoteId ? "Skriv text, Enter = spara" : "Klicka på ritningen för att placera notat"}
                  </div>
                )}
              </div>

              <PanelLabel icon="◈">Aktivt material</PanelLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                {materials.map(m=>{
                  const active = selMatId===m.id;
                  return (
                    <label key={m.id} className="lux-card" style={{
                      display:"flex", alignItems:"center", gap:9, padding:"8px 11px",
                      borderRadius:10, cursor:"pointer",
                      border: active ? `1px solid ${m.color}55` : "1px solid rgba(0,0,0,0.07)",
                      background: active
                        ? `linear-gradient(135deg,${m.color}10,${m.color}06)`
                        : "linear-gradient(160deg,#FFFFFF,#F7F8FB)",
                      boxShadow: active
                        ? `0 0 0 1px ${m.color}22, 0 2px 8px rgba(0,0,0,0.06)`
                        : "0 1px 3px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,1)",
                    }}>
                      <input type="radio" name="mat" checked={active} onChange={()=>setSelMatId(m.id)}
                        style={{ accentColor:m.color, width:13, height:13, flexShrink:0 }} />
                      <div style={{
                        width:9, height:9,
                        borderRadius: m.geo==="line" ? "3px" : "50%",
                        background: `linear-gradient(135deg, ${m.color}, ${m.color}AA)`,
                        flexShrink:0,
                        boxShadow: active ? `0 0 6px ${m.color}88` : `0 1px 2px ${m.color}66`,
                      }} />
                      <span style={{ flex:1, fontSize:12, color: active ? T.text : T.textSub,
                        fontWeight: active ? 600 : 400 }}>{m.label}</span>
                      <span style={{ fontSize:9.5, color:T.dim,
                        fontFamily:"'SF Mono','Fira Code',monospace" }}>
                        {m.geo==="area"?"m²":"m"}
                      </span>
                    </label>
                  );
                })}
              </div>

              {objects.length>0 && (
                <div style={{ marginTop:16 }}>
                  <PanelLabel icon="▦">Objekt <Badge>{objects.length}</Badge></PanelLabel>
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    {objects.map(o=>{
                      const qty = o.geo==="area"?shoelaceArea(o.pts)/(ppm*ppm):dist(o.start,o.end)/ppm;
                      const sel = selectedId===o.id;
                      return (
                        <div key={o.id} className="lux-card"
                          onClick={()=>setSelectedId(o.id===selectedId?null:o.id)} style={{
                          display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                          borderRadius:9, cursor:"pointer",
                          border: sel ? `1px solid ${o.color}44` : "1px solid rgba(0,0,0,0.07)",
                          background: sel
                            ? `linear-gradient(135deg,${o.color}0E,${o.color}06)`
                            : "linear-gradient(160deg,#FFFFFF,#F8F9FC)",
                          boxShadow:"0 1px 3px rgba(0,0,0,0.05)",
                        }}>
                          <div style={{ width:6, height:6,
                            borderRadius:o.geo==="line"?"2px":"50%",
                            background:o.color, flexShrink:0 }} />
                          <span style={{ flex:1, fontSize:11.5, color: sel ? T.text : T.textSub,
                            fontWeight: sel ? 500 : 400 }}>{o.label}</span>
                          <span style={{ fontSize:11, fontFamily:"'SF Mono','Fira Code',monospace",
                            color:T.text, fontWeight:600 }}>
                            {fmtN(qty,1)}<span style={{ fontSize:9, color:T.dim, marginLeft:2 }}>{o.unit}</span>
                          </span>
                          <button onClick={e=>{e.stopPropagation();setObjects(p=>p.filter(x=>x.id!==o.id));if(selectedId===o.id)setSelectedId(null);}}
                            style={{ border:"none", background:"none", color:T.red, cursor:"pointer",
                              fontSize:14, lineHeight:1, padding:"0 2px", opacity:0.35,
                              transition:"opacity 0.1s" }}
                            onMouseEnter={e=>e.currentTarget.style.opacity="1"}
                            onMouseLeave={e=>e.currentTarget.style.opacity="0.35"}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button className="lux-btn"
                    onClick={()=>{ if(window.confirm("Ta bort alla objekt?")){ setObjects([]); setSelectedId(null); }}}
                    style={{ marginTop:8, width:"100%", padding:"6px", borderRadius:9,
                      border:"1px solid rgba(196,40,28,0.2)", background:"rgba(196,40,28,0.04)",
                      color:T.red, fontSize:11, cursor:"pointer", fontFamily:"Inter,sans-serif" }}>
                    Rensa alla
                  </button>
                </div>
              )}
            </div>}

            {/* ─── MATERIAL ───────────────────────────────────── */}
            {panel==="materials" && <div style={{ animation:"fadeIn 0.18s ease" }}>
              <PanelLabel icon="◈">Material &amp; Á-priser</PanelLabel>
              {editingMat ? (
                <MatEditor mat={editingMat}
                  onSave={m=>{
                    if(m.id==="new"){const n={...m,id:`m-${Date.now()}`};setMaterials(p=>[...p,n]);}
                    else setMaterials(p=>p.map(x=>x.id===m.id?m:x));
                    setEditingMat(null);
                  }}
                  onCancel={()=>setEditingMat(null)}
                />
              ) : <>
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {materials.map(m=>(
                    <div key={m.id} className="lux-card" style={{
                      display:"flex", alignItems:"center", gap:9, padding:"10px 12px",
                      borderRadius:11,
                      border:"1px solid rgba(0,0,0,0.07)",
                      borderLeft:`3px solid ${m.color}`,
                      background:"linear-gradient(160deg,#FFFFFF,#F7F8FB)",
                      boxShadow:"0 1px 4px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,1)",
                    }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12.5, color:T.text, fontWeight:500 }}>{m.label}</div>
                        <div style={{ fontSize:10, color:T.muted,
                          fontFamily:"'SF Mono','Fira Code',monospace", marginTop:2 }}>
                          {fmtSEK(m.price)} / {m.unit} · {m.geo==="area"?"yta":"linje"}
                        </div>
                      </div>
                      <button className="lux-btn" onClick={()=>setEditingMat(m)}
                        style={{ border:"none", background:"none", color:T.muted,
                          cursor:"pointer", fontSize:13, opacity:0.6 }}>✎</button>
                      <button className="lux-btn"
                        onClick={()=>{ if(materials.length>1) setMaterials(p=>p.filter(x=>x.id!==m.id)); }}
                        style={{ border:"none", background:"none", color:T.red,
                          cursor:"pointer", fontSize:15, opacity:0.35 }}>×</button>
                    </div>
                  ))}
                </div>
                <button className="lux-btn"
                  onClick={()=>setEditingMat({id:"new",label:"",unit:"m²",price:0,color:T.accentBlue,geo:"area"})}
                  style={{ marginTop:10, width:"100%", padding:"9px", borderRadius:10,
                    border:"1px dashed rgba(59,111,212,0.3)",
                    background:"rgba(59,111,212,0.04)",
                    color:T.accentBlue, fontSize:12, cursor:"pointer",
                    fontFamily:"Inter,sans-serif", fontWeight:500 }}>
                  + Lägg till material
                </button>
              </>}
            </div>}

            {/* ─── LAGER ───────────────────────────────────────── */}
            {panel==="layers" && <div style={{ animation:"fadeIn 0.18s ease" }}>
              <PanelLabel icon="◈">Aktiva lager</PanelLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                {layers.map(layer=>{
                  const isActive = activeLayerId===layer.id;
                  const layerObjectCount = objects.filter(o=>o.layerId===layer.id).length;
                  const isEditing = editLayerName===layer.id;
                  return (
                    <div key={layer.id}>
                      <div className="lux-card" onClick={()=>setActiveLayerId(layer.id)} style={{
                        display:"flex", alignItems:"center", gap:9, padding:"10px 12px",
                        borderRadius:10, cursor:"pointer",
                        border: isActive ? `1px solid ${layer.color}55` : "1px solid rgba(0,0,0,0.07)",
                        background: isActive
                          ? `linear-gradient(135deg,${layer.color}10,${layer.color}06)`
                          : "linear-gradient(160deg,#FFFFFF,#F7F8FB)",
                        boxShadow: isActive
                          ? `0 0 0 1px ${layer.color}22, 0 2px 8px rgba(0,0,0,0.06)`
                          : "0 1px 3px rgba(0,0,0,0.05)",
                      }}>
                        <button onClick={(e)=>{e.stopPropagation();setLayers(l=>l.map(x=>x.id===layer.id?{...x,visible:!x.visible}:x));}}
                          style={{border:"none",background:"none",cursor:"pointer",fontSize:14,padding:0,color:T.muted}}>
                          {layer.visible?"👁":"👁‍🗨"}
                        </button>
                        <div style={{width:12,height:12,borderRadius:6,background:layer.color,flexShrink:0}} />
                        {isEditing ? (
                          <input type="text" value={layer.name} onChange={(e)=>setLayers(l=>l.map(x=>x.id===layer.id?{...x,name:e.target.value}:x))}
                            onBlur={()=>setEditLayerName(null)} onKeyDown={(e)=>{if(e.key==="Enter")setEditLayerName(null);e.stopPropagation();}}
                            autoFocus style={{flex:1,border:"1px solid "+layer.color,borderRadius:6,padding:"4px 6px",fontSize:11,fontFamily:"Inter,sans-serif"}}
                          />
                        ) : (
                          <span onClick={()=>setEditLayerName(layer.id)} style={{flex:1,fontSize:12,color:isActive?T.text:T.textSub,fontWeight:isActive?600:400,cursor:"pointer"}}>
                            {layer.name}
                          </span>
                        )}
                        {isActive && <Badge>Aktivt</Badge>}
                        {layers.length>1 && (
                          <button onClick={(e)=>{e.stopPropagation();setLayers(l=>l.filter(x=>x.id!==layer.id));if(activeLayerId===layer.id)setActiveLayerId(layers[0].id);}}
                            style={{border:"none",background:"none",color:T.red,cursor:"pointer",fontSize:14,opacity:0.4}}>×</button>
                        )}
                      </div>
                      {layerObjectCount>0 && (
                        <div style={{fontSize:10,color:T.muted,padding:"4px 12px 0"}}>
                          {layerObjectCount} objekt{layerObjectCount!==1?"":""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button className="lux-btn"
                onClick={()=>{const newId="ly-"+Date.now();setLayers(p=>[...p,{id:newId,name:"Nytt lager",color:"#"+Math.floor(Math.random()*16777215).toString(16).padStart(6,"0"),visible:true}]);setActiveLayerId(newId);}}
                style={{marginTop:10,width:"100%",padding:"9px",borderRadius:10,border:"1px dashed rgba(59,111,212,0.3)",background:"rgba(59,111,212,0.04)",color:T.accentBlue,fontSize:11.5,fontWeight:600,cursor:"pointer",fontFamily:"Inter,sans-serif"}}>
                + Nytt lager
              </button>
            </div>}

            {/* ─── KALKYL ──────────────────────────────────────── */}
            {panel==="summary" && <div style={{ animation:"fadeIn 0.18s ease" }}>
              <PanelLabel icon="◉">Mängdsammanställning</PanelLabel>

              {rows.length===0 ? (
                <div style={{ fontSize:12, color:T.dim, padding:"28px 0",
                  textAlign:"center", lineHeight:2 }}>
                  Rita ytor och linjer<br/>— resultaten visas här.
                </div>
              ) : <>
                <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:14 }}>
                  {rows.map((r,i)=>(
                    <div key={i} style={{ padding:"10px 13px", borderRadius:11,
                      border:"1px solid rgba(0,0,0,0.07)",
                      borderLeft:`3px solid ${r.color}`,
                      background:"linear-gradient(160deg,#FFFFFF,#F7F8FB)",
                      boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
                      <div style={{ display:"flex", justifyContent:"space-between",
                        alignItems:"center", marginBottom:3 }}>
                        <span style={{ fontSize:12.5, fontWeight:600, color:T.text }}>{r.label}</span>
                        <span style={{ fontSize:13, fontWeight:700,
                          fontFamily:"'SF Mono','Fira Code',monospace", color:T.text }}>
                          {fmtSEK(r.total)}
                        </span>
                      </div>
                      <div style={{ fontSize:10, color:T.muted,
                        fontFamily:"'SF Mono','Fira Code',monospace" }}>
                        {fmtN(r.qty,2)} {r.unit} × {fmtSEK(r.price)}/{r.unit}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div style={{ padding:"14px 16px", borderRadius:12,
                  background:T.metalGrad,
                  border:"1px solid rgba(0,0,0,0.1)",
                  boxShadow:"0 2px 12px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)" }}>
                  <StatRow label="Exkl. moms" value={fmtSEK(grandTotal)} mono />
                  <StatRow label="Moms 25 %" value={fmtSEK(grandTotal*0.25)} mono />
                  <div style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"baseline", paddingTop:12 }}>
                    <span style={{ fontSize:9.5, color:T.muted, fontWeight:700,
                      letterSpacing:"0.1em", textTransform:"uppercase" }}>Totalt inkl. moms</span>
                    <span style={{ fontSize:19, fontWeight:800, color:T.text,
                      fontFamily:"'SF Mono','Fira Code',monospace" }}>
                      {fmtSEK(grandTotal*1.25)}
                    </span>
                  </div>
                </div>

                {/* Offert-status */}
                <div style={{ marginTop:14 }}>
                  <PanelLabel icon="◉">Offert-status</PanelLabel>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {[
                      { id:"draft",       label:"Utkast",           color:"#8A909E" },
                      { id:"sent",        label:"Skickad",          color:"#3B6FD4" },
                      { id:"negotiating", label:"Under förhandling", color:"#B07D10" },
                      { id:"accepted",    label:"Accepterad ✓",     color:"#0A7C54" },
                      { id:"rejected",    label:"Avvisad",          color:"#C4281C" },
                    ].map(status => (
                      <button key={status.id}
                        onClick={()=>setOfferStatus(status.id)}
                        style={{ padding:"6px 12px", borderRadius:20, fontSize:11, fontWeight:600,
                          border: offerStatus===status.id ? `2px solid ${status.color}` : "1px solid rgba(0,0,0,0.1)",
                          background: offerStatus===status.id ? status.color+"20" : "transparent",
                          color: status.color, cursor:"pointer", transition:"all 0.15s",
                          fontFamily:"Inter,sans-serif" }}>
                        {status.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Extra rader */}
                <div style={{ marginTop:14 }}>
                  <PanelLabel icon="＋">Extra poster</PanelLabel>
                  {extraRows.map((row,i)=>(
                    <div key={row.id} style={{ display:"flex", gap:4, marginBottom:5 }}>
                      <input className="lux-input" value={row.label}
                        onChange={e=>setExtraRows(p=>p.map((r,j)=>j===i?{...r,label:e.target.value}:r))}
                        placeholder="Beskrivning" style={{ ...inputStyle, flex:1 }} />
                      <input className="lux-input" type="number" value={row.amount}
                        onChange={e=>setExtraRows(p=>p.map((r,j)=>j===i?{...r,amount:e.target.value}:r))}
                        placeholder="kr"
                        style={{ ...inputStyle, width:70, fontFamily:"'SF Mono','Fira Code',monospace" }} />
                      <button onClick={()=>setExtraRows(p=>p.filter((_,j)=>j!==i))}
                        style={{ border:"none", background:"none", color:T.red, cursor:"pointer",
                          fontSize:15, opacity:0.4, padding:"0 4px", transition:"opacity 0.1s" }}
                        onMouseEnter={e=>e.currentTarget.style.opacity="0.9"}
                        onMouseLeave={e=>e.currentTarget.style.opacity="0.4"}>×</button>
                    </div>
                  ))}
                  <button className="lux-btn"
                    onClick={()=>setExtraRows(p=>[...p,{id:Date.now(),label:"",amount:""}])}
                    style={{ width:"100%", padding:"7px", borderRadius:9, marginTop:2,
                      border:"1px dashed rgba(59,111,212,0.3)", background:"rgba(59,111,212,0.04)",
                      color:T.accentBlue, fontSize:11, cursor:"pointer",
                      fontFamily:"Inter,sans-serif", fontWeight:500 }}>
                    + Lägg till rad
                  </button>
                </div>

                {/* Offert-anteckningar */}
                <div style={{ marginTop:14 }}>
                  <PanelLabel icon="📝">Anteckningar på offerten</PanelLabel>
                  <textarea
                    value={offerNotes}
                    onChange={e=>setOfferNotes(e.target.value)}
                    onKeyDown={e=>e.stopPropagation()}
                    placeholder="Betalningsvillkor, garantier, undantag, kontaktperson…"
                    rows={4}
                    style={{ ...inputStyle, resize:"vertical", lineHeight:1.6,
                      fontSize:12, fontFamily:"Inter,sans-serif", width:"100%" }}
                  />
                </div>

                {/* CTA */}
                <button className="lux-btn" onClick={printOffer} style={{
                  marginTop:14, width:"100%", padding:"12px",
                  borderRadius:11,
                  background:T.metalDark,
                  border:"1px solid rgba(255,255,255,0.06)",
                  color:"#FFFFFF", fontSize:13, fontWeight:700, cursor:"pointer",
                  letterSpacing:"0.02em", fontFamily:"Inter,sans-serif",
                  boxShadow:"0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
                }}>
                  Generera offert →
                </button>
              </>}

              {/* Massabalans */}
              <div style={{ marginTop:18 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <PanelLabel icon="⛏">Massabalans (schakt/fyll)</PanelLabel>
                  <button onClick={()=>setShowMassPanel(v=>!v)}
                    style={{ border:"none", background:"none", color:T.muted, cursor:"pointer",
                      fontSize:11, padding:"0 2px",
                      transform: showMassPanel ? "rotate(180deg)" : "none",
                      transition:"transform 0.2s" }}>▼</button>
                </div>
                {showMassPanel && (()=>{
                  const areaM2 = totalArea;
                  const depth  = parseFloat(massDepth) || 0;
                  const cutVol = areaM2 * depth;
                  const fillVol = parseFloat(massFillVol) || 0;
                  const balance = cutVol - fillVol;
                  return (
                    <div style={{ display:"flex", flexDirection:"column", gap:8, animation:"fadeIn 0.18s ease" }}>
                      <div style={{ display:"flex", gap:8 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:9.5, color:T.muted, marginBottom:4,
                            textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Schaktdjup (m)</div>
                          <input type="number" min="0" step="0.1" value={massDepth}
                            onChange={e=>setMassDepth(e.target.value)}
                            onKeyDown={e=>e.stopPropagation()}
                            placeholder="0.00" style={{ ...inputStyle, fontFamily:"'SF Mono','Fira Code',monospace" }} />
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:9.5, color:T.muted, marginBottom:4,
                            textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Fyllnad (m³)</div>
                          <input type="number" min="0" step="0.1" value={massFillVol}
                            onChange={e=>setMassFillVol(e.target.value)}
                            onKeyDown={e=>e.stopPropagation()}
                            placeholder="0.00" style={{ ...inputStyle, fontFamily:"'SF Mono','Fira Code',monospace" }} />
                        </div>
                      </div>
                      <div style={{ background:"rgba(0,0,0,0.03)", borderRadius:10,
                        border:"1px solid rgba(0,0,0,0.07)", padding:"10px 12px",
                        display:"flex", flexDirection:"column", gap:5 }}>
                        {[
                          ["Uppmätt yta", `${fmtN(areaM2,1)} m²`],
                          ["Schaktvolym", `${fmtN(cutVol,1)} m³`],
                          ["Fyllnad", `${fmtN(fillVol,1)} m³`],
                        ].map(([lbl,val])=>(
                          <div key={lbl} style={{ display:"flex", justifyContent:"space-between",
                            fontSize:11, color:T.textSub }}>
                            <span>{lbl}</span>
                            <span style={{ fontFamily:"'SF Mono','Fira Code',monospace", fontWeight:600 }}>{val}</span>
                          </div>
                        ))}
                        <div style={{ height:1, background:"rgba(0,0,0,0.08)", margin:"3px 0" }} />
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:700,
                          color: balance > 0 ? T.red : balance < 0 ? T.green : T.text }}>
                          <span>Balans {balance>0?"(överskott)":balance<0?"(underskott)":""}</span>
                          <span style={{ fontFamily:"'SF Mono','Fira Code',monospace" }}>
                            {balance>0?"+":""}{fmtN(balance,1)} m³
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize:10, color:T.muted, lineHeight:1.5 }}>
                        Rött = överskott (borttransport). Grönt = underskott (köp fyllnad).
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Kunduppgifter */}
              <div style={{ marginTop:18 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <PanelLabel icon="👤">Kund / Beställare</PanelLabel>
                  <button onClick={()=>setShowCustomerForm(v=>!v)}
                    style={{ border:"none", background:"none", color:T.muted, cursor:"pointer",
                      fontSize:11, padding:"0 2px",
                      transform: showCustomerForm ? "rotate(180deg)" : "none",
                      transition:"transform 0.2s" }}>▼</button>
                </div>
                {showCustomerForm && (
                  <div style={{ display:"flex", flexDirection:"column", gap:7, animation:"fadeIn 0.18s ease" }}>
                    <input className="lux-input" value={customerName}
                      onChange={e=>setCustomerName(e.target.value)}
                      onKeyDown={e=>e.stopPropagation()}
                      placeholder="Kundnamn / Företag" style={inputStyle} />
                    <textarea className="lux-input" value={customerAddress}
                      onChange={e=>setCustomerAddress(e.target.value)}
                      onKeyDown={e=>e.stopPropagation()}
                      placeholder="Adress (gatuadress, postnr, ort)" rows={2}
                      style={{ ...inputStyle, resize:"vertical", lineHeight:1.5 }} />
                    <input className="lux-input" value={customerOrgNr}
                      onChange={e=>setCustomerOrgNr(e.target.value)}
                      onKeyDown={e=>e.stopPropagation()}
                      placeholder="Org.nr (xxxxxx-xxxx)" style={inputStyle} />
                  </div>
                )}
              </div>

              {/* Företagsinformation */}
              <div style={{ marginTop:18 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <PanelLabel icon="🏢">Företag på offerten</PanelLabel>
                  <button onClick={()=>setShowCompanyForm(v=>!v)}
                    style={{ border:"none", background:"none", color:T.muted, cursor:"pointer",
                      fontSize:11, padding:"0 2px",
                      transform: showCompanyForm ? "rotate(180deg)" : "none",
                      transition:"transform 0.2s" }}>▼</button>
                </div>

                {showCompanyForm && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8,
                    animation:"fadeIn 0.18s ease" }}>
                    <div>
                      <div style={{ fontSize:9.5, color:T.muted, marginBottom:4,
                        textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Logga</div>
                      {companyLogo && (
                        <div style={{ marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
                          <img src={companyLogo} style={{ maxHeight:36, maxWidth:110,
                            objectFit:"contain", borderRadius:7,
                            border:"1px solid rgba(0,0,0,0.08)",
                            boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }} alt="logga" />
                          <button onClick={()=>setCompanyLogo(null)}
                            style={{ border:"none", background:"none", color:T.red,
                              cursor:"pointer", fontSize:14, opacity:0.5 }}>×</button>
                        </div>
                      )}
                      <label style={{ display:"block", padding:"8px 12px", borderRadius:9,
                        border:"1px dashed rgba(0,0,0,0.15)",
                        background:"rgba(255,255,255,0.6)",
                        color:T.muted, fontSize:11, cursor:"pointer", textAlign:"center",
                        transition:"all 0.15s", fontFamily:"Inter,sans-serif" }}
                        onMouseEnter={e=>{ e.currentTarget.style.borderColor="rgba(0,0,0,0.25)"; e.currentTarget.style.background="rgba(255,255,255,0.9)"; }}
                        onMouseLeave={e=>{ e.currentTarget.style.borderColor="rgba(0,0,0,0.15)"; e.currentTarget.style.background="rgba(255,255,255,0.6)"; }}>
                        {companyLogo ? "Byt logga" : "↑ Välj logga…"}
                        <input type="file" accept="image/*" style={{ display:"none" }}
                          onChange={e=>{
                            const file=e.target.files?.[0]; if(!file) return;
                            const reader=new FileReader();
                            reader.onload=ev=>setCompanyLogo(ev.target.result);
                            reader.readAsDataURL(file);
                          }} />
                      </label>
                    </div>

                    <div>
                      <div style={{ fontSize:9.5, color:T.muted, marginBottom:4,
                        textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Företagsnamn</div>
                      <input className="lux-input" value={companyName}
                        onChange={e=>setCompanyName(e.target.value)}
                        onKeyDown={e=>e.stopPropagation()}
                        placeholder="T.ex. Markbygg AB" style={inputStyle} />
                    </div>

                    <div>
                      <div style={{ fontSize:9.5, color:T.muted, marginBottom:4,
                        textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Kontaktinfo</div>
                      <textarea className="lux-input" value={companyInfo}
                        onChange={e=>setCompanyInfo(e.target.value)}
                        onKeyDown={e=>e.stopPropagation()}
                        placeholder={"Storgatan 1\n123 45 Stockholm\nOrg.nr: 556000-0000"}
                        rows={3} style={{ ...inputStyle, resize:"vertical" }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Projektmallar */}
              <div style={{ marginTop:18 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <PanelLabel icon="📋">Projektmallar</PanelLabel>
                  <button onClick={()=>setShowTemplatePanel(v=>!v)}
                    style={{ border:"none", background:"none", color:T.muted, cursor:"pointer",
                      fontSize:11, padding:"0 2px",
                      transform: showTemplatePanel ? "rotate(180deg)" : "none",
                      transition:"transform 0.2s" }}>▼</button>
                </div>
                {showTemplatePanel && (
                  <div style={{ display:"flex", flexDirection:"column", gap:7, animation:"fadeIn 0.18s ease" }}>
                    {/* Spara nuvarande material som mall */}
                    <div style={{ display:"flex", gap:5 }}>
                      <input value={newTplName} onChange={e=>setNewTplName(e.target.value)}
                        onKeyDown={e=>{ e.stopPropagation(); if(e.key==="Enter") saveTemplate(newTplName); }}
                        placeholder="Mallnamn (t.ex. Asfalt-projekt)"
                        style={{ ...inputStyle, flex:1, fontSize:11 }} />
                      <button className="lux-btn" onClick={()=>saveTemplate(newTplName)}
                        disabled={!newTplName.trim()}
                        style={{ padding:"6px 10px", borderRadius:8, border:`1px solid ${T.accentBlue}44`,
                          background: newTplName.trim() ? `${T.accentBlue}12` : "transparent",
                          color: newTplName.trim() ? T.accentBlue : T.dim,
                          fontSize:11, fontWeight:600, cursor: newTplName.trim() ? "pointer" : "not-allowed",
                          fontFamily:"Inter,sans-serif", whiteSpace:"nowrap" }}>
                        Spara mall
                      </button>
                    </div>
                    {templates.length===0
                      ? <div style={{ fontSize:11, color:T.dim, textAlign:"center", padding:"8px 0" }}>
                          Inga mallar sparade ännu
                        </div>
                      : templates.map(tpl=>(
                        <div key={tpl.id} style={{ display:"flex", alignItems:"center", gap:6,
                          padding:"8px 10px", borderRadius:9,
                          background:"rgba(0,0,0,0.03)", border:"1px solid rgba(0,0,0,0.07)" }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{tpl.name}</div>
                            <div style={{ fontSize:10, color:T.muted }}>
                              {tpl.materials.length} material · {new Date(tpl.created).toLocaleDateString("sv-SE")}
                            </div>
                          </div>
                          <button className="lux-btn" onClick={()=>loadTemplate(tpl)}
                            style={{ padding:"4px 9px", borderRadius:7, border:`1px solid ${T.accentBlue}33`,
                              background:`${T.accentBlue}10`, color:T.accentBlue,
                              fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"Inter,sans-serif" }}>
                            Ladda
                          </button>
                          <button onClick={()=>deleteTemplate(tpl.id)}
                            style={{ border:"none", background:"none", color:T.red, cursor:"pointer",
                              fontSize:15, opacity:0.4, padding:"0 2px", transition:"opacity 0.1s" }}
                            onMouseEnter={e=>e.currentTarget.style.opacity="0.9"}
                            onMouseLeave={e=>e.currentTarget.style.opacity="0.4"}>×</button>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>

              {/* Mätningar */}
              {measurements.length>0 && (
                <div style={{ marginTop:18 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <PanelLabel icon="📐">Mätningar</PanelLabel>
                    <button onClick={()=>setMeasurements([])}
                      style={{ border:"none", background:"none", color:T.red, cursor:"pointer", fontSize:10 }}>
                      Rensa alla
                    </button>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    {measurements.map((m,i)=>{
                      const isSlopeOpen = showSlopeFor===m.id;
                      const inputs = slopeInputs[m.id] || {a:"", b:""};
                      const a = parseFloat(inputs.a);
                      const b = parseFloat(inputs.b);
                      const hasSlope = !isNaN(a) && !isNaN(b);
                      const slope = hasSlope ? (b-a)/m.distM*100 : null;
                      return (
                        <div key={m.id}>
                          <div style={{
                            display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
                            borderRadius:8, background:"linear-gradient(160deg,#EFF9FF,#E0F3FB)",
                            border:"1px solid #BAE6FD",
                            fontFamily:"'SF Mono','Fira Code',monospace" }}>
                            <span style={{ fontSize:10, color:"#0369A1", fontWeight:700, flex:1 }}>
                              #{i+1}  {fmtN(m.distM,2)} m
                            </span>
                            <button onClick={()=>setShowSlopeFor(isSlopeOpen?null:m.id)}
                              style={{ border:"none", background:"none", color:"#0EA5E9", cursor:"pointer", fontSize:11, fontWeight:600 }}>
                              %
                            </button>
                            <button onClick={()=>setMeasurements(p=>p.filter(x=>x.id!==m.id))}
                              style={{ border:"none", background:"none", color:T.red, cursor:"pointer", fontSize:13 }}>×</button>
                          </div>
                          {isSlopeOpen && (
                            <div style={{ padding:"8px 10px", background:"rgba(14,167,201,0.06)", borderRadius:6, marginTop:4, display:"flex", flexDirection:"column", gap:6 }}>
                              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                                <label style={{ fontSize:10, color:T.muted, flex:"0 0 auto" }}>Höjd A (m):</label>
                                <input type="number" value={inputs.a} onChange={(e)=>setSlopeInputs(p=>({...p,[m.id]:{...inputs,a:e.target.value}}))}
                                  onKeyDown={(e)=>e.stopPropagation()}
                                  style={{ flex:1, ...inputStyle, fontSize:11 }} />
                              </div>
                              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                                <label style={{ fontSize:10, color:T.muted, flex:"0 0 auto" }}>Höjd B (m):</label>
                                <input type="number" value={inputs.b} onChange={(e)=>setSlopeInputs(p=>({...p,[m.id]:{...inputs,b:e.target.value}}))}
                                  onKeyDown={(e)=>e.stopPropagation()}
                                  style={{ flex:1, ...inputStyle, fontSize:11 }} />
                              </div>
                              {hasSlope && (
                                <div style={{ fontSize:11, color:"#1F2937", fontWeight:600, padding:6, borderRadius:5, background:"rgba(255,255,255,0.8)" }}>
                                  Lutning: {fmtN(Math.abs(slope),2)} % {slope>0.5?"▲ stigning":slope<-0.5?"▼ fall":"→ plan"}
                                  <div style={{ fontSize:10, color: slope>2?"#C4281C":slope<-2?"#C4281C":"#0A7C54", marginTop:3 }}>
                                    {slope>2?"Brant stigning":slope<-2?"Brant fall":"Bra dränering"}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Anteckningar */}
              {notes.length>0 && (
                <div style={{ marginTop:18 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <PanelLabel icon="📝">Anteckningar</PanelLabel>
                    <button onClick={()=>setNotes([])}
                      style={{ border:"none", background:"none", color:T.red, cursor:"pointer", fontSize:10 }}>
                      Rensa alla
                    </button>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    {notes.map((n,i)=>(
                      <div key={n.id} style={{
                        display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
                        borderRadius:8, background:"linear-gradient(160deg,#FFFBEB,#FEF3C7)",
                        border:"1px solid #FDE68A" }}>
                        <span style={{ fontSize:11, color:"#78350F", flex:1, fontFamily:"Inter,sans-serif",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {n.text||<em style={{ color:T.muted }}>tomt</em>}
                        </span>
                        <button onClick={()=>{ setEditingNoteId(n.id); setMode("note"); }}
                          style={{ border:"none", background:"none", color:"#0EA5E9", cursor:"pointer", fontSize:12 }}>✎</button>
                        <button onClick={()=>setNotes(p=>p.filter(x=>x.id!==n.id))}
                          style={{ border:"none", background:"none", color:T.red, cursor:"pointer", fontSize:13 }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop:18 }}>
                <PanelLabel icon="◈">Inställningar</PanelLabel>
                <StatRow label="Skala" value={fmtN(ppm,1)} unit="px/m" mono />
                <StatRow label="Objekt" value={objects.length} />
                <StatRow label="Total uppmätt yta" value={fmtN(totalArea,1)} unit="m²" mono />
              </div>

              {/* Webhook / ERP-integration */}
              <div style={{ marginTop:18 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <PanelLabel icon="📤">Exportera till ERP</PanelLabel>
                  <button onClick={()=>setShowWebhookPanel(!showWebhookPanel)}
                    style={{ border:"none", background:"none", color:T.muted, cursor:"pointer",
                      fontSize:11, padding:"0 2px",
                      transform: showWebhookPanel ? "rotate(180deg)" : "none",
                      transition:"transform 0.2s" }}>▼</button>
                </div>
                {showWebhookPanel && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8,
                    animation:"fadeIn 0.18s ease", marginTop:8 }}>
                    <input type="text" value={webhookUrl}
                      onChange={e=>setWebhookUrl(e.target.value)}
                      onKeyDown={e=>e.stopPropagation()}
                      placeholder="https://api.example.com/webhook"
                      style={{ ...inputStyle, fontSize:11 }} />
                    <button onClick={async ()=>{
                      if (!webhookUrl) return;
                      setWebhookStatus("sending");
                      try {
                        const payload = {
                          project: projName,
                          date: new Date().toISOString(),
                          rows: rows.map(r => ({ material:r.label, qty:r.qty, unit:r.unit, price:r.price, total:r.total })),
                          extraRows,
                          grandTotal: grandTotal + extraRows.reduce((s,r)=>s+Number(r.amount||0), 0),
                          totalArea,
                          ppm,
                        };
                        const res = await fetch(webhookUrl, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(payload),
                        });
                        setWebhookStatus(res.ok ? "ok" : "error");
                        setTimeout(() => setWebhookStatus(null), 3000);
                      } catch {
                        setWebhookStatus("error");
                        setTimeout(() => setWebhookStatus(null), 3000);
                      }
                    }}
                      style={{ padding:"8px 14px", borderRadius:9, border:"none",
                        background: webhookStatus==="ok" ? T.green : webhookStatus==="error" ? T.red : T.metalBtn,
                        color: webhookStatus ? "#fff" : T.textSub,
                        fontSize:11, fontWeight:600, cursor:"pointer",
                        fontFamily:"Inter,sans-serif", transition:"all 0.2s" }}>
                      {webhookStatus==="sending" ? "⏳ Skickar..." : webhookStatus==="ok" ? "✓ Skickat!" : webhookStatus==="error" ? "⚠ Fel" : "Skicka"}
                    </button>
                  </div>
                )}
              </div>
            </div>}

          </div>

          {/* ── MINI OFFERT-PREVIEW (alltid synlig i botten) ─────── */}
          {grandTotal > 0 && (
            <div style={{
              flexShrink:0, borderTop:"1px solid rgba(0,0,0,0.08)",
              background:"linear-gradient(160deg,#F0F4FF,#E8EEF8)",
              padding:"10px 14px",
              boxShadow:"0 -2px 10px rgba(59,111,212,0.08)",
            }}>
              <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.12em", color:T.muted,
                textTransform:"uppercase", marginBottom:6, fontFamily:"Inter,sans-serif" }}>
                Live offert-summering
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:8 }}>
                {rows.slice(0,3).map((r,i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center", fontSize:10.5, fontFamily:"Inter,sans-serif" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:6, height:6, borderRadius:2, background:r.color, flexShrink:0 }} />
                      <span style={{ color:T.textSub, maxWidth:110,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.label}</span>
                    </div>
                    <span style={{ fontWeight:600, color:T.text,
                      fontFamily:"'SF Mono','Fira Code',monospace", fontSize:10 }}>
                      {fmtSEK(r.total)}
                    </span>
                  </div>
                ))}
                {rows.length > 3 && (
                  <div style={{ fontSize:10, color:T.muted, textAlign:"center",
                    fontFamily:"Inter,sans-serif" }}>
                    +{rows.length-3} fler poster
                  </div>
                )}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between",
                alignItems:"center", padding:"8px 10px",
                background:"rgba(255,255,255,0.75)", borderRadius:10,
                border:"1px solid rgba(59,111,212,0.15)",
                boxShadow:"0 1px 4px rgba(59,111,212,0.1)" }}>
                <span style={{ fontSize:10, fontWeight:700, color:T.muted,
                  textTransform:"uppercase", letterSpacing:"0.1em",
                  fontFamily:"Inter,sans-serif" }}>Totalt inkl. moms</span>
                <span style={{ fontSize:16, fontWeight:800, color:T.accentBlue,
                  fontFamily:"'SF Mono','Fira Code',monospace" }}>
                  {fmtSEK(grandTotal*1.25)}
                </span>
              </div>
              <button onClick={printOffer}
                style={{ marginTop:8, width:"100%", padding:"8px 0", borderRadius:9,
                  background:`linear-gradient(135deg,${T.accentBlue},#2655B8)`,
                  color:"#fff", border:"none", fontSize:11.5, fontWeight:700, cursor:"pointer",
                  fontFamily:"Inter,sans-serif", letterSpacing:"0.02em",
                  boxShadow:`0 3px 12px ${T.accentBlue}44` }}>
                Förhandsgranska offert →
              </button>
            </div>
          )}

        </aside>

        {/* ── CANVAS ──────────────────────────────────────────────── */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden",
          background:"linear-gradient(160deg,#E8EAF0 0%,#DEE1E8 100%)" }}>
          <div ref={viewportRef} style={{ flex:1, position:"relative", overflow:"hidden", cursor }}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}>

            {autoScaleDetected && (
              <div style={{ position:"absolute", top:12, left:"50%", transform:"translateX(-50%)",
                zIndex:30, background:"rgba(10,124,84,0.95)", color:"#fff",
                padding:"8px 18px", borderRadius:20, fontSize:12, fontWeight:600,
                boxShadow:"0 4px 16px rgba(0,0,0,0.2)", display:"flex", gap:10, alignItems:"center",
                fontFamily:"Inter,sans-serif" }}>
                ✓ {autoScaleDetected}
                <button onClick={()=>setAutoScaleDetected(null)}
                  style={{ border:"none", background:"rgba(255,255,255,0.2)", borderRadius:10,
                    color:"#fff", cursor:"pointer", padding:"1px 7px", fontSize:11 }}>×</button>
              </div>
            )}

            {/* ── Sidnavigation (multi-sida PDF) ─────────────────────── */}
            {pdfStatus==="ready" && pdfTotalPages > 1 && (
              <div style={{ position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
                zIndex:30, background:"rgba(20,24,36,0.88)", backdropFilter:"blur(12px)",
                color:"#fff", padding:"6px 6px", borderRadius:14, fontSize:12,
                boxShadow:"0 4px 20px rgba(0,0,0,0.35)", display:"flex", gap:4,
                alignItems:"center", fontFamily:"Inter,sans-serif", whiteSpace:"nowrap" }}>
                <button onClick={()=>setPdfCurrentPage(p=>Math.max(1,p-1))} disabled={pdfCurrentPage===1}
                  style={{ width:30, height:30, borderRadius:9, border:"none",
                    background: pdfCurrentPage===1 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.18)",
                    color:"#fff", cursor: pdfCurrentPage===1 ? "not-allowed" : "pointer",
                    fontSize:15, display:"flex", alignItems:"center", justifyContent:"center",
                    opacity: pdfCurrentPage===1 ? 0.4 : 1 }}>‹</button>
                <span style={{ padding:"0 10px", fontSize:12, fontWeight:600, minWidth:80, textAlign:"center" }}>
                  Sida {pdfCurrentPage} / {pdfTotalPages}
                </span>
                <button onClick={()=>setPdfCurrentPage(p=>Math.min(pdfTotalPages,p+1))} disabled={pdfCurrentPage===pdfTotalPages}
                  style={{ width:30, height:30, borderRadius:9, border:"none",
                    background: pdfCurrentPage===pdfTotalPages ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.18)",
                    color:"#fff", cursor: pdfCurrentPage===pdfTotalPages ? "not-allowed" : "pointer",
                    fontSize:15, display:"flex", alignItems:"center", justifyContent:"center",
                    opacity: pdfCurrentPage===pdfTotalPages ? 0.4 : 1 }}>›</button>
              </div>
            )}

            {/* ── Kalibreringsbanner ─────────────────────────────────── */}
            {pdfStatus==="ready" && ppm<=1 && (
              <div style={{ position:"absolute", top:16, left:"50%", transform:"translateX(-50%)",
                zIndex:30, background:"rgba(59,111,212,0.96)", color:"#fff",
                padding:"10px 22px", borderRadius:20, fontSize:12, fontWeight:600,
                boxShadow:"0 4px 20px rgba(59,111,212,0.45)", display:"flex", gap:12,
                alignItems:"center", fontFamily:"Inter,sans-serif",
                animation:"fadeIn 0.3s ease", whiteSpace:"nowrap" }}>
                <span style={{ fontSize:16 }}>📐</span>
                Ritningen är laddad — kalibrera skalan för att börja mäta
                <button
                  onClick={()=>{ setMode("cal"); setCalPts([]); }}
                  style={{ border:"none", background:"rgba(255,255,255,0.25)", borderRadius:10,
                    color:"#fff", cursor:"pointer", padding:"4px 12px", fontSize:11,
                    fontWeight:700, fontFamily:"Inter,sans-serif" }}>
                  Kalibrera nu →
                </button>
              </div>
            )}

            {pdfStatus!=="ready" && (
              <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                alignItems:"center", justifyContent:"center", gap:16, zIndex:5 }}>
                {pdfStatus==="loading" && (
                  <>
                    <div style={{ width:36, height:36,
                      border:"2px solid rgba(0,0,0,0.08)",
                      borderTop:`2px solid ${T.accentBlue}`,
                      borderRadius:"50%", animation:"spin 0.9s linear infinite" }} />
                    <span style={{ fontSize:13, color:T.muted }}>Laddar ritning…</span>
                  </>
                )}
                {pdfStatus==="error" && <span style={{ color:T.red, fontSize:13 }}>Fel vid inläsning av PDF</span>}
              </div>
            )}

            <div style={{ position:"absolute", transformOrigin:"0 0",
              transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>

              <canvas ref={canvasRef} style={{ display:"block",
                boxShadow:"0 0 0 1px rgba(0,0,0,0.08), 0 8px 48px rgba(0,0,0,0.18)" }} />

              <svg onClick={handleSVGClick} onDoubleClick={handleSVGDblClick}
                onContextMenu={e=>{ e.preventDefault(); setCtxMenu(null); }}
                style={{ position:"absolute", inset:0, width:canvasSize.width, height:canvasSize.height,
                  overflow:"visible", touchAction:"none" }}>

                {objects.map(o=>{
                  // Skip if layer is hidden
                  if (layers.find(l=>l.id===o.layerId)?.visible === false) return null;

                  const sel = selectedId===o.id;
                  let qty;
                  if(o.geo==="area"||o.geo==="hole") qty=shoelaceArea(o.pts)/(ppm*ppm);
                  else if(o.geo==="polyline") qty=o.pts.reduce((s,p,i)=>i===0?0:s+dist(o.pts[i-1],p),0)/ppm;
                  else qty=dist(o.start,o.end)/ppm;

                  if (o.geo==="area" || o.geo==="hole") {
                    const isHole = o.geo==="hole";
                    const pts = o.pts.map(p=>`${p.x},${p.y}`).join(" ");
                    const c   = centroid(o.pts);
                    const holeColor = "#888";
                    const fillColor = isHole ? "rgba(0,0,0,0.12)" : o.color+"28";
                    const strokeColor = isHole ? holeColor : o.color;
                    return (
                      <g key={o.id}>
                        <polygon points={pts}
                          fill={fillColor} stroke={strokeColor}
                          strokeWidth={sel?2.5:1.5}
                          strokeDasharray={isHole ? "5,3" : "none"}
                          style={{ cursor:"pointer",
                            filter: sel ? `drop-shadow(0 0 5px ${strokeColor}55)` : "none" }}
                          onClick={e=>{e.stopPropagation();setSelectedId(o.id===selectedId?null:o.id);}}
                          onContextMenu={e=>{e.preventDefault();e.stopPropagation();setSelectedId(o.id);setCtxMenu({x:e.clientX,y:e.clientY,objectId:o.id});}} />
                        {showLabels && (
                          <g>
                            <rect x={c.x-26} y={c.y-8} width={isHole?52:44} height={15} rx={3}
                              fill={isHole?"rgba(0,0,0,0.65)":"rgba(255,255,255,0.88)"}
                              stroke={strokeColor+"44"} strokeWidth={0.5} />
                            <text x={c.x} y={c.y+3} textAnchor="middle"
                              style={{ fontSize:8, fontFamily:"'SF Mono','Fira Code',monospace",
                                fontWeight:700, fill: isHole ? "#fff" : o.color, pointerEvents:"none" }}>
                              {isHole?"⊘ ":""}{fmtN(qty,1)} m²
                            </text>
                          </g>
                        )}
                        {sel && o.pts.map((p,i)=>(
                          <circle key={i} cx={p.x} cy={p.y} r={5}
                            fill={strokeColor} stroke="white" strokeWidth={1.5}
                            style={{ cursor:"grab", filter:`drop-shadow(0 1px 3px rgba(0,0,0,0.3))` }}
                            onMouseDown={e=>{e.stopPropagation();setDragging({id:o.id,idx:i});}} />
                        ))}
                      </g>
                    );
                  }

                  if (o.geo==="polyline") {
                    const midIdx = Math.floor(o.pts.length/2)-1;
                    const labelPt = midIdx>=0 ? midPt(o.pts[midIdx], o.pts[midIdx+1]) : o.pts[0];
                    return (
                      <g key={o.id}>
                        <polyline points={o.pts.map(p=>`${p.x},${p.y}`).join(" ")}
                          fill="none" stroke={o.color} strokeWidth={sel?2.5:1.8} strokeLinecap="round" strokeLinejoin="round"
                          style={{ cursor:"pointer",
                            filter: sel ? `drop-shadow(0 0 5px ${o.color}55)` : "none" }}
                          onClick={e=>{e.stopPropagation();setSelectedId(o.id===selectedId?null:o.id);}}
                          onContextMenu={e=>{e.preventDefault();e.stopPropagation();setSelectedId(o.id);setCtxMenu({x:e.clientX,y:e.clientY,objectId:o.id});}} />
                        {showLabels && (
                          <g>
                            <rect x={labelPt.x-26} y={labelPt.y-9} width={52} height={16} rx={3}
                              fill="rgba(255,255,255,0.88)" stroke={o.color+"44"} strokeWidth={0.5} />
                            <text x={labelPt.x} y={labelPt.y+3} textAnchor="middle"
                              style={{ fontSize:9, fontFamily:"'SF Mono','Fira Code',monospace",
                                fontWeight:700, fill:o.color, pointerEvents:"none" }}>
                              {fmtN(qty,1)} m
                            </text>
                          </g>
                        )}
                        {sel && o.pts.map((p,i) => (
                          <circle key={i} cx={p.x} cy={p.y} r={5}
                            fill={o.color} stroke="white" strokeWidth={1.5}
                            style={{ cursor:"grab", filter:"drop-shadow(0 1px 3px rgba(0,0,0,0.3))" }}
                            onMouseDown={e=>{e.stopPropagation();setDragging({id:o.id,idx:i});}} />
                        ))}
                      </g>
                    );
                  }

                  const mp = midPt(o.start, o.end);
                  return (
                    <g key={o.id}>
                      <line x1={o.start.x} y1={o.start.y} x2={o.end.x} y2={o.end.y}
                        stroke={o.color} strokeWidth={sel?2.5:1.8} strokeLinecap="round"
                        style={{ cursor:"pointer",
                          filter: sel ? `drop-shadow(0 0 4px ${o.color}55)` : "none" }}
                        onClick={e=>{e.stopPropagation();setSelectedId(o.id===selectedId?null:o.id);}}
                        onContextMenu={e=>{e.preventDefault();e.stopPropagation();setSelectedId(o.id);setCtxMenu({x:e.clientX,y:e.clientY,objectId:o.id});}} />
                      {showLabels && (
                        <g>
                          <rect x={mp.x-22} y={mp.y-9} width={44} height={16} rx={3}
                            fill="rgba(255,255,255,0.88)" stroke={o.color+"44"} strokeWidth={0.5} />
                          <text x={mp.x} y={mp.y+3} textAnchor="middle"
                            style={{ fontSize:9, fontFamily:"'SF Mono','Fira Code',monospace",
                              fontWeight:700, fill:o.color, pointerEvents:"none" }}>
                            {fmtN(qty,1)} m
                          </text>
                        </g>
                      )}
                      {sel && [["start",o.start],["end",o.end]].map(([role,p])=>(
                        <circle key={role} cx={p.x} cy={p.y} r={5}
                          fill={o.color} stroke="white" strokeWidth={1.5}
                          style={{ cursor:"grab", filter:"drop-shadow(0 1px 3px rgba(0,0,0,0.3))" }}
                          onMouseDown={e=>{e.stopPropagation();setDragging({id:o.id,role});}} />
                      ))}
                    </g>
                  );
                })}

                {preview && drawType==="area" && preview.length>=2 && (() => {
                  const lastPt   = preview[preview.length-2];
                  const cursorPt = preview[preview.length-1];
                  const segM     = ppm > 0 ? dist(lastPt, cursorPt) / ppm : 0;
                  const mp       = midPt(lastPt, cursorPt);
                  const lblW     = 52;
                  return (
                    <>
                      <polyline points={preview.map(p=>`${p.x},${p.y}`).join(" ")}
                        fill="none" stroke={mat.color} strokeWidth={1.5}
                        strokeDasharray="6 4" opacity={0.55} />
                      {ppm > 0 && segM > 0.01 && (
                        <text x={mp.x} y={mp.y-4} textAnchor="middle"
                          style={{ fontSize:9, fontFamily:"'SF Mono','Fira Code',monospace",
                            fontWeight:700, fill:mat.color, pointerEvents:"none",
                            paintOrder:"stroke", stroke:"rgba(255,255,255,0.85)", strokeWidth:3, strokeLinejoin:"round" }}>
                          {fmtN(segM,2)} m
                        </text>
                      )}
                    </>
                  );
                })()}
                {drawType==="rect" && curPts.length===1 && mousePos && (() => {
                  const cornerA = curPts[0];
                  const cornerB = mousePos;
                  const x = Math.min(cornerA.x, cornerB.x);
                  const y = Math.min(cornerA.y, cornerB.y);
                  const width = Math.abs(cornerB.x - cornerA.x);
                  const height = Math.abs(cornerB.y - cornerA.y);
                  return (
                    <rect x={x} y={y} width={width} height={height}
                      fill="none" stroke={mat.color} strokeWidth={1.5}
                      strokeDasharray="6 4" opacity={0.55} />
                  );
                })()}
                {preview && drawType==="line" && (() => {
                  const liveM = ppm > 0 ? dist(preview[0], preview[1]) / ppm : 0;
                  const mp    = midPt(preview[0], preview[1]);
                  const lblW  = 60;
                  return (
                    <>
                      <line x1={preview[0].x} y1={preview[0].y} x2={preview[1].x} y2={preview[1].y}
                        stroke={mat.color} strokeWidth={1.8} strokeDasharray="6 4" opacity={0.55} />
                      {ppm > 0 && liveM > 0.01 && (
                        <text x={mp.x} y={mp.y-6} textAnchor="middle"
                          style={{ fontSize:10, fontFamily:"'SF Mono','Fira Code',monospace",
                            fontWeight:800, fill:mat.color, pointerEvents:"none",
                            paintOrder:"stroke", stroke:"rgba(255,255,255,0.85)", strokeWidth:3, strokeLinejoin:"round" }}>
                          {fmtN(liveM,2)} m
                        </text>
                      )}
                    </>
                  );
                })()}
                {drawType==="polyline" && curPts.length>0 && mousePos && (() => {
                  const allPts = [...curPts, mousePos];
                  const totalM = allPts.reduce((s,p,i)=>i===0?0:s+dist(allPts[i-1],p),0)/ppm;
                  const lastPt = curPts[curPts.length-1];
                  return (
                    <>
                      <polyline points={allPts.map(p=>`${p.x},${p.y}`).join(" ")}
                        fill="none" stroke={mat.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                        strokeDasharray="6 4" opacity={0.55} />
                      {ppm > 0 && totalM > 0.01 && (
                        <text x={mousePos.x+12} y={mousePos.y-8} textAnchor="start"
                          style={{ fontSize:10, fontFamily:"'SF Mono','Fira Code',monospace",
                            fontWeight:800, fill:mat.color, pointerEvents:"none",
                            paintOrder:"stroke", stroke:"rgba(255,255,255,0.85)", strokeWidth:3, strokeLinejoin:"round" }}>
                          {fmtN(totalM,2)} m
                        </text>
                      )}
                    </>
                  );
                })()}

                {curPts.map((p,i)=>(
                  <circle key={i} cx={p.x} cy={p.y}
                    r={i===0?(snapToStart?8:5):3.5}
                    fill={i===0?(snapToStart?mat.color:"transparent"):mat.color}
                    stroke={mat.color} strokeWidth={1.5}
                    style={{ filter: i===0&&snapToStart ? `drop-shadow(0 0 4px ${mat.color})` : "none" }} />
                ))}

                {calPts.map((p,i)=>(
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r={9} fill={T.yellow+"18"} stroke={T.yellow} strokeWidth={1.5} />
                    <line x1={p.x-6} y1={p.y} x2={p.x+6} y2={p.y} stroke={T.yellow} strokeWidth={1.5} />
                    <line x1={p.x} y1={p.y-6} x2={p.x} y2={p.y+6} stroke={T.yellow} strokeWidth={1.5} />
                    <text x={p.x+12} y={p.y+4} style={{ fontSize:11,
                      fontFamily:"'SF Mono','Fira Code',monospace",
                      fill:T.yellow, fontWeight:700 }}>P{i+1}</text>
                  </g>
                ))}
                {calPts.length===1 && mousePos && (() => {
                  const px = dist(calPts[0], mousePos);
                  const mp = midPt(calPts[0], mousePos);
                  return (
                    <>
                      <line x1={calPts[0].x} y1={calPts[0].y} x2={mousePos.x} y2={mousePos.y}
                        stroke={T.yellow} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.7} />
                      <g>
                        <rect x={mp.x-32} y={mp.y-10} width={64} height={18} rx={4}
                          fill="rgba(255,255,255,0.96)" stroke={T.yellow} strokeWidth={1} />
                        <text x={mp.x} y={mp.y+3} textAnchor="middle"
                          style={{ fontSize:10, fontFamily:"'SF Mono','Fira Code',monospace",
                            fontWeight:800, fill:T.yellow, pointerEvents:"none" }}>
                          {Math.round(px)} px
                        </text>
                      </g>
                    </>
                  );
                })()}
                {calPts.length===2 && (
                  <line x1={calPts[0].x} y1={calPts[0].y} x2={calPts[1].x} y2={calPts[1].y}
                    stroke={T.yellow} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.7} />
                )}

                {/* ── Sparade mätningar ─────────────────────────────────── */}
                {measurements.map(m=>{
                  const mp  = midPt(m.a, m.b);
                  const sel = selMeasureId===m.id;
                  const lblW = 68;
                  return (
                    <g key={m.id} style={{ cursor:"pointer" }}
                      onClick={e=>{ e.stopPropagation(); setSelMeasureId(m.id===selMeasureId?null:m.id); }}>
                      {/* Linje med pilar */}
                      <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y}
                        stroke="#0EA5E9" strokeWidth={sel?2:1.5}
                        strokeDasharray={sel?"none":"4 3"}
                        opacity={sel?1:0.75} />
                      <circle cx={m.a.x} cy={m.a.y} r={sel?5:3.5}
                        fill="#0EA5E9" stroke="white" strokeWidth={1.5} />
                      <circle cx={m.b.x} cy={m.b.y} r={sel?5:3.5}
                        fill="#0EA5E9" stroke="white" strokeWidth={1.5} />
                      {/* Etikett */}
                      <rect x={mp.x-lblW/2} y={mp.y-11} width={lblW} height={20} rx={5}
                        fill={sel?"#0EA5E9":"rgba(255,255,255,0.96)"}
                        stroke="#0EA5E9" strokeWidth={sel?0:1} />
                      <text x={mp.x} y={mp.y+4} textAnchor="middle"
                        style={{ fontSize:10, fontFamily:"'SF Mono','Fira Code',monospace",
                          fontWeight:800, fill:sel?"#fff":"#0369A1", pointerEvents:"none" }}>
                        {fmtN(m.distM,2)} m
                      </text>
                      {sel && (
                        <text x={mp.x+lblW/2+8} y={mp.y+4}
                          style={{ fontSize:11, fill:"#EF4444", cursor:"pointer", fontWeight:700 }}
                          onClick={e=>{ e.stopPropagation(); setMeasurements(p=>p.filter(x=>x.id!==m.id)); setSelMeasureId(null); }}>×</text>
                      )}
                    </g>
                  );
                })}

                {/* ── Live mätlinjal preview ────────────────────────────── */}
                {mode==="measure" && measurePts.length===1 && mousePos && ppm>0 && (() => {
                  const liveM = dist(measurePts[0], mousePos) / ppm;
                  const mp    = midPt(measurePts[0], mousePos);
                  const lblW  = 68;
                  return (
                    <>
                      <line x1={measurePts[0].x} y1={measurePts[0].y} x2={mousePos.x} y2={mousePos.y}
                        stroke="#0EA5E9" strokeWidth={1.8} strokeDasharray="6 4" opacity={0.8} />
                      <circle cx={measurePts[0].x} cy={measurePts[0].y} r={5}
                        fill="#0EA5E9" stroke="white" strokeWidth={1.5} />
                      <rect x={mp.x-lblW/2} y={mp.y-11} width={lblW} height={20} rx={5}
                        fill="rgba(255,255,255,0.97)" stroke="#0EA5E9" strokeWidth={1.5} />
                      <text x={mp.x} y={mp.y+4} textAnchor="middle"
                        style={{ fontSize:10, fontFamily:"'SF Mono','Fira Code',monospace",
                          fontWeight:800, fill:"#0369A1", pointerEvents:"none" }}>
                        {fmtN(liveM,2)} m
                      </text>
                    </>
                  );
                })()}

                {/* ── Anteckningar ─────────────────────────────────────── */}
                {notes.map(n=>{
                  const sel     = selNoteId===n.id;
                  const editing = editingNoteId===n.id;
                  const txt     = n.text||"";
                  const charW   = 7.5;
                  const lblW    = Math.max(80, txt.length*charW+24);
                  const lblH    = 28;
                  return (
                    <g key={n.id} data-note={n.id}
                      onClick={e=>{ if(!editing){ e.stopPropagation(); setSelNoteId(n.id===selNoteId?null:n.id); setEditingNoteId(null); } }}>
                      {/* Pin */}
                      <circle cx={n.x} cy={n.y} r={sel?7:5}
                        fill="#F59E0B" stroke="white" strokeWidth={1.5}
                        style={{ cursor:"pointer",
                          filter: sel ? "drop-shadow(0 0 5px #F59E0BAA)" : "none" }} />
                      {/* Bubbla */}
                      {(txt||editing) && (
                        <>
                          <rect x={n.x+10} y={n.y-lblH/2} width={lblW} height={lblH} rx={7}
                            fill={sel?"#FEF3C7":"rgba(255,255,255,0.97)"}
                            stroke="#F59E0B" strokeWidth={sel?1.5:1} />
                          {!editing && (
                            <text x={n.x+22} y={n.y+5}
                              style={{ fontSize:11, fontFamily:"Inter,sans-serif",
                                fontWeight:500, fill:"#78350F", pointerEvents:"none" }}>
                              {txt.length>30?txt.slice(0,28)+"…":txt}
                            </text>
                          )}
                        </>
                      )}
                      {sel && !editing && (
                        <>
                          <text x={n.x+10+lblW+4} y={n.y+4}
                            style={{ fontSize:11, fill:"#0EA5E9", cursor:"pointer", fontWeight:700 }}
                            onClick={e=>{ e.stopPropagation(); setEditingNoteId(n.id); setSelNoteId(null); }}>✎</text>
                          <text x={n.x+10+lblW+18} y={n.y+4}
                            style={{ fontSize:11, fill:"#EF4444", cursor:"pointer", fontWeight:700 }}
                            onClick={e=>{ e.stopPropagation(); setNotes(p=>p.filter(x=>x.id!==n.id)); setSelNoteId(null); }}>×</text>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* ── Ny anteckning-punkt live ──────────────────────────── */}
                {mode==="note" && mousePos && !editingNoteId && (
                  <circle cx={mousePos.x} cy={mousePos.y} r={5}
                    fill="#F59E0B88" stroke="#F59E0B" strokeWidth={1.5}
                    strokeDasharray="3 2" style={{ pointerEvents:"none" }} />
                )}

                {/* ── Foton ───────────────────────────────────────────────── */}
                {photos.map(ph => (
                  <g key={ph.id} style={{ cursor:"pointer" }}
                    onClick={e => { e.stopPropagation(); setShowPhotoViewer(ph); }}>
                    <circle cx={ph.x} cy={ph.y} r={selectedPhotoId===ph.id?9:7}
                      fill="#6366F1" stroke="white" strokeWidth={2}
                      style={{ filter:"drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }} />
                    <text x={ph.x} y={ph.y+4} textAnchor="middle"
                      style={{ fontSize:8, pointerEvents:"none", fill:"white", fontWeight:700 }}>📷</text>
                  </g>
                ))}
              </svg>

              {/* ── Photo viewer modal ────────────────────────────────── */}
              {showPhotoViewer && (
                <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)",
                  zIndex:60, display:"flex", alignItems:"center", justifyContent:"center",
                  backdropFilter:"blur(4px)" }}
                  onClick={()=>setShowPhotoViewer(null)}>
                  <div style={{ position:"relative", maxWidth:"90%", maxHeight:"90vh",
                    background:"white", borderRadius:16,
                    boxShadow:"0 20px 60px rgba(0,0,0,0.3)",
                    overflow:"hidden" }}
                    onClick={e=>e.stopPropagation()}>
                    <img src={showPhotoViewer.dataUrl}
                      style={{ width:"100%", height:"100%", objectFit:"contain",
                        maxHeight:"80vh" }} />
                    <div style={{ padding:"12px 16px", background:"#F8FAFC",
                      borderTop:"1px solid #E2E8F0", display:"flex",
                      justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12, color:T.text, fontWeight:500 }}>
                        {showPhotoViewer.caption || "Foto"}
                      </span>
                      <button onClick={()=>setShowPhotoViewer(null)}
                        style={{ background:"none", border:"none", fontSize:20,
                          cursor:"pointer", color:T.muted, padding:"0 8px" }}>×</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Antecknings-input overlay ─────────────────── */}
              {editingNoteId && (() => {
                const n = notes.find(x=>x.id===editingNoteId);
                if (!n) return null;
                const sx = pan.x + n.x * zoom + 14 * zoom;
                const sy = pan.y + n.y * zoom - 14 * zoom;
                return (
                  <div style={{ position:"absolute", left:sx, top:sy, zIndex:50 }}
                    onMouseDown={e=>e.stopPropagation()}>
                    <input autoFocus
                      value={n.text}
                      onChange={ev=>setNotes(p=>p.map(x=>x.id===n.id?{...x,text:ev.target.value}:x))}
                      onKeyDown={e=>{
                        e.stopPropagation();
                        if(e.key==="Enter"||e.key==="Escape"){
                          if(!n.text.trim()) setNotes(p=>p.filter(x=>x.id!==n.id));
                          setEditingNoteId(null);
                        }
                      }}
                      onBlur={()=>{ if(!n.text.trim()) setNotes(p=>p.filter(x=>x.id!==n.id)); setEditingNoteId(null); }}
                      placeholder="Skriv anteckning…"
                      style={{ padding:"5px 10px", fontSize:11, fontFamily:"Inter,sans-serif",
                        border:"2px solid #F59E0B", borderRadius:7, outline:"none",
                        background:"#FFFBEB", color:"#78350F", fontWeight:500,
                        boxShadow:"0 4px 16px rgba(0,0,0,0.15)",
                        minWidth:180, transform:`scale(${1/zoom})`, transformOrigin:"0 0" }} />
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── STATUS BAR ───────────────────────────────────── */}
          <div style={{
            height:28, flexShrink:0,
            background:"rgba(255,255,255,0.75)",
            backdropFilter:"blur(12px)",
            borderTop:"1px solid rgba(0,0,0,0.07)",
            display:"flex", alignItems:"center", padding:"0 18px", gap:0,
            fontSize:10.5, color:T.muted,
            fontFamily:"'SF Mono','Fira Code',monospace",
            boxShadow:"0 -1px 0 rgba(255,255,255,0.8)",
          }}>
            <span style={{ minWidth:190 }}>
              {mousePos ? `X: ${fmtN(mousePos.x,1)}  Y: ${fmtN(mousePos.y,1)} px` : "X: —  Y: —"}
            </span>
            {preview && ppm > 0 && (() => {
              let liveLabel = null;
              if (drawType==="line" && preview.length===2) {
                const m = dist(preview[0], preview[1]) / ppm;
                liveLabel = `${fmtN(m,2)} m`;
              } else if (drawType==="area" && preview.length>=2) {
                const last = preview[preview.length-2];
                const cur  = preview[preview.length-1];
                const segM = dist(last, cur) / ppm;
                liveLabel = `↗ ${fmtN(segM,2)} m`;
              }
              return liveLabel ? (
                <>
                  <span style={{ marginRight:14, color:"rgba(0,0,0,0.15)" }}>│</span>
                  <span style={{ color:mat.color, fontWeight:700 }}>📏 {liveLabel}</span>
                </>
              ) : null;
            })()}
            <span style={{ marginRight:14, color:"rgba(0,0,0,0.15)" }}>│</span>
            <span style={{ marginRight:14 }}>Skala <span style={{ color:T.textSub }}>{fmtN(ppm,1)} px/m</span></span>
            <span style={{ marginRight:14, color:"rgba(0,0,0,0.15)" }}>│</span>
            <span style={{ marginRight:14 }}>Zoom <span style={{ color:T.textSub }}>{zoomPct}%</span></span>
            <span style={{ marginRight:14, color:"rgba(0,0,0,0.15)" }}>│</span>
            <span style={{ marginRight:14 }}>{objects.length} objekt</span>
            {grandTotal>0 && <>
              <span style={{ marginRight:14, color:"rgba(0,0,0,0.15)" }}>│</span>
              <span style={{ color:T.text, fontWeight:700 }}>{fmtSEK(grandTotal*1.25)}</span>
            </>}
            <span style={{ flex:1 }} />
            {/* Kontextkänslig guidehint */}
            <span style={{
              fontSize:10.5, color: (ppm<=1&&pdfStatus==="ready") ? "#C4280C" : T.accentBlue,
              fontFamily:"Inter,sans-serif", fontWeight: (ppm<=1&&pdfStatus==="ready") ? 700 : 500,
              letterSpacing:0, marginRight:6,
            }}>
              {statusHint}
            </span>
          </div>
        </div>
      </div>

      {/* ══ HÖGERKLICK KONTEXTMENY ════════════════════════════════════ */}
      {ctxMenu && (() => {
        const obj = objects.find(o=>o.id===ctxMenu.objectId);
        if (!obj) return null;
        const close = () => setCtxMenu(null);
        const menuItems = [
          {
            icon: "🎨", label: "Ändra material", action: () => {
              setSelectedId(obj.id);
              setPanel("materials");
              close();
            }
          },
          {
            icon: "📋", label: "Duplicera", action: () => {
              pushHistory();
              const offset = 20;
              const dup = { ...obj, id:`o-${Date.now()}` };
              if (dup.geo==="area"||dup.geo==="polyline") dup.pts = dup.pts.map(p=>({x:p.x+offset,y:p.y+offset}));
              else { dup.start={x:dup.start.x+offset,y:dup.start.y+offset}; dup.end={x:dup.end.x+offset,y:dup.end.y+offset}; }
              setObjects(prev=>[...prev,dup]);
              setSelectedId(dup.id);
              close();
            }
          },
          { divider: true },
          {
            icon: "🗑", label: "Ta bort", danger: true, action: () => {
              pushHistory();
              setObjects(prev=>prev.filter(o=>o.id!==obj.id));
              if (selectedId===obj.id) setSelectedId(null);
              close();
            }
          },
        ];
        return (
          <>
            {/* Bakgrundsyta för att stänga menyn */}
            <div style={{ position:"fixed", inset:0, zIndex:400 }} onClick={close} />
            <div style={{
              position:"fixed", left:ctxMenu.x, top:ctxMenu.y, zIndex:401,
              background:"rgba(255,255,255,0.97)", borderRadius:12,
              boxShadow:"0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
              border:"1px solid rgba(0,0,0,0.08)",
              backdropFilter:"blur(12px)", minWidth:180,
              fontFamily:"Inter,sans-serif", overflow:"hidden",
              animation:"fadeIn 0.12s ease",
            }}>
              {/* Objektinfo-header */}
              <div style={{ padding:"8px 14px 6px", borderBottom:"1px solid rgba(0,0,0,0.07)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:10, height:10, borderRadius:3, background:obj.color, flexShrink:0 }} />
                  <span style={{ fontSize:11, fontWeight:700, color:T.text }}>{obj.label}</span>
                </div>
              </div>
              {menuItems.map((item,i) => item.divider ? (
                <div key={i} style={{ height:1, background:"rgba(0,0,0,0.06)", margin:"2px 0" }} />
              ) : (
                <button key={i} onClick={item.action} style={{
                  display:"flex", alignItems:"center", gap:10, width:"100%",
                  padding:"9px 14px", border:"none", background:"transparent",
                  cursor:"pointer", fontSize:12, fontWeight:500,
                  color: item.danger ? "#C4280C" : T.text,
                  textAlign:"left", fontFamily:"Inter,sans-serif",
                }}
                  onMouseEnter={e=>e.currentTarget.style.background=item.danger?"rgba(196,40,28,0.07)":"rgba(59,111,212,0.07)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{ fontSize:14 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {/* ══ ONBOARDING MODAL ══════════════════════════════════════════ */}
      {showOnboarding && (() => {
        const steps = [
          {
            icon: "📄",
            title: "Ladda upp din ritning",
            desc: "Dra och släpp en PDF-ritning i arbetsytan, eller klicka i mitten för att välja en fil. Programmet stödjer alla vanliga bygglovsritningar och situationsplaner.",
            tip: "Tips: Ritningar i A1 och A3-format fungerar bäst.",
          },
          {
            icon: "📏",
            title: "Kalibrera skalan",
            desc: "Klicka på knappen Kalibrera i verktygsfältet. Klicka sedan på två punkter på ritningen med ett känt avstånd — t.ex. ett mått som är utskrivet — och ange det verkliga avståndet i meter.",
            tip: "Tips: Välj ett långt mått för bättre noggrannhet.",
          },
          {
            icon: "✏️",
            title: "Rita och mät",
            desc: "Välj Rita och klicka punkt för punkt för att markera ytor (m²) eller sträckor (m). Programmet räknar ut areor och längder automatiskt och skapar en offert direkt.",
            tip: "Tips: Dubbelklicka eller tryck Enter för att stänga en yta.",
          },
        ];
        const step = steps[onboardStep];
        const isLast = onboardStep === steps.length - 1;
        const close = () => {
          try { localStorage.setItem("mw_onboarded","1"); } catch {}
          setShowOnboarding(false);
        };
        return (
          <div style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(15,20,35,0.72)",
            backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center",
            fontFamily:"Inter,sans-serif" }}>
            <div style={{ background:"#fff", borderRadius:24, width:480, maxWidth:"92vw",
              boxShadow:"0 32px 100px rgba(0,0,0,0.35)", overflow:"hidden" }}>
              {/* Header gradient */}
              <div style={{ background:`linear-gradient(135deg,${T.bg} 0%,${T.accentBlue} 100%)`,
                padding:"32px 32px 24px", textAlign:"center" }}>
                <div style={{ fontSize:52, marginBottom:12, filter:"drop-shadow(0 4px 12px rgba(0,0,0,0.3))" }}>
                  {step.icon}
                </div>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:"rgba(255,255,255,0.6)",
                  textTransform:"uppercase", marginBottom:8 }}>
                  Steg {onboardStep+1} av {steps.length}
                </div>
                <h2 style={{ fontSize:22, fontWeight:800, color:"#fff", margin:0 }}>
                  {step.title}
                </h2>
              </div>
              {/* Stegindikator */}
              <div style={{ display:"flex", justifyContent:"center", gap:8, padding:"16px 0 0",
                background:"#fff" }}>
                {steps.map((_,i)=>(
                  <div key={i} style={{ width: i===onboardStep?28:8, height:8, borderRadius:4,
                    background: i===onboardStep ? T.accentBlue : i<onboardStep ? T.green : "#E2E8F0",
                    transition:"all 0.3s ease" }} />
                ))}
              </div>
              {/* Body */}
              <div style={{ padding:"20px 32px 28px" }}>
                <p style={{ fontSize:14, color:T.text, lineHeight:1.65, margin:"0 0 14px" }}>
                  {step.desc}
                </p>
                <div style={{ background:`${T.accentBlue}11`, border:`1px solid ${T.accentBlue}33`,
                  borderRadius:10, padding:"10px 14px",
                  fontSize:12, color:T.accentBlue, fontWeight:500 }}>
                  💡 {step.tip}
                </div>
                {/* Knappar */}
                <div style={{ display:"flex", gap:10, marginTop:20 }}>
                  <button onClick={close}
                    style={{ flex:1, padding:"10px 0", borderRadius:10, border:"1px solid #E2E8F0",
                      background:"#F8FAFC", color:T.muted, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    Hoppa över
                  </button>
                  {!isLast ? (
                    <button onClick={()=>setOnboardStep(s=>s+1)}
                      style={{ flex:2, padding:"10px 0", borderRadius:10, border:"none",
                        background:T.accentBlue, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                      Nästa steg →
                    </button>
                  ) : (
                    <button onClick={close}
                      style={{ flex:2, padding:"10px 0", borderRadius:10, border:"none",
                        background:`linear-gradient(135deg,${T.accentBlue},${T.green})`,
                        color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                      ✓ Kom igång!
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══ IMPORT MODAL ═══════════════════════════════════════════════ */}
      {showImportModal && (
        <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.45)",
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:480, maxWidth:"90vw",
            boxShadow:"0 24px 80px rgba(0,0,0,0.25)" }}>
            <h2 style={{ fontSize:18, fontWeight:700, color:T.text, marginBottom:12 }}>Importera koordinater</h2>
            <p style={{ fontSize:12, color:T.muted, marginBottom:16, lineHeight:1.5 }}>
              Klistra in koordinater (en punkt per rad) i formatet: X,Y eller E N. Koordinaterna anses vara i meter och skalas med aktuell ppm-inställning.
            </p>
            <textarea value={importText} onChange={(e)=>{setImportText(e.target.value);setImportError("");}}
              onKeyDown={(e)=>e.stopPropagation()}
              placeholder="1.5,2.3&#10;2.1,3.5&#10;3.0,2.8"
              style={{ width:"100%", height:120, padding:10, borderRadius:9,
                border:"1px solid rgba(0,0,0,0.1)", fontFamily:"'SF Mono','Fira Code',monospace",
                fontSize:11, resize:"vertical", marginBottom:10 }} />
            {importError && (
              <div style={{ color:T.red, fontSize:11, marginBottom:12, padding:8, borderRadius:6,
                background:"rgba(196,40,28,0.08)", border:"1px solid rgba(196,40,28,0.2)" }}>
                {importError}
              </div>
            )}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>{setShowImportModal(false);setImportText("");setImportError("");}}
                style={{ flex:1, padding:10, borderRadius:9, border:"1px solid rgba(0,0,0,0.1)",
                  background:T.metalBtn, color:T.textSub, fontSize:12, fontWeight:600, cursor:"pointer",
                  fontFamily:"Inter,sans-serif" }}>
                Avbryt
              </button>
              <button onClick={()=>{
                const lines = importText.trim().split("\n").filter(l=>l.trim());
                const pts = [];
                for(const line of lines) {
                  const parts = line.trim().split(/[,\s]+/).map(p=>parseFloat(p)).filter(p=>!isNaN(p));
                  if(parts.length>=2) pts.push({x:parts[0],y:parts[1]});
                }
                if(pts.length<3) {
                  setImportError("Minst 3 punkter krävs");
                  return;
                }
                const minX = Math.min(...pts.map(p=>p.x));
                const maxX = Math.max(...pts.map(p=>p.x));
                const minY = Math.min(...pts.map(p=>p.y));
                const maxY = Math.max(...pts.map(p=>p.y));
                const cxM = (minX+maxX)/2;
                const cyM = (minY+maxY)/2;
                const canvasPts = pts.map(p=>({
                  x: (p.x-cxM)*ppm+canvasSize.width/2,
                  y: -(p.y-cyM)*ppm+canvasSize.height/2,
                }));
                const mat = materials.find(m=>m.id===selMatId)||materials[0];
                setObjects(prev=>[...prev,{
                  id:`o-${Date.now()}`, geo:"area", pts:canvasPts,
                  matId:mat.id, label:mat.label, color:mat.color, unit:mat.unit, price:mat.price,
                  layerId: activeLayerId,
                }]);
                setShowImportModal(false);
                setImportText("");
                setImportError("");
              }}
                style={{ flex:1, padding:10, borderRadius:9, border:"none",
                  background:T.metalDark, color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer",
                  fontFamily:"Inter,sans-serif", boxShadow:"0 2px 8px rgba(0,0,0,0.2)" }}>
                Lägg till polygon
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ HJÄLP / GUIDE MODAL ══════════════════════════════════════════════ */}
      {showHelp && (
        <div style={{ position:"fixed", inset:0, zIndex:300,
          background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={()=>setShowHelp(false)}>
          <div style={{ background:"#F5F6FA", borderRadius:20, width:780, maxWidth:"95vw",
            maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column",
            boxShadow:"0 32px 96px rgba(0,0,0,0.28)" }}
            onClick={e=>e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding:"22px 28px 0", background:"#fff",
              borderBottom:"1px solid rgba(0,0,0,0.07)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <h2 style={{ fontSize:20, fontWeight:800, color:"#111318", margin:0, letterSpacing:"-0.02em" }}>
                    📖 Hjälp & Guide
                  </h2>
                  <div style={{ fontSize:12, color:"#8A909E", marginTop:3 }}>
                    Komplett guide till alla verktyg och funktioner
                  </div>
                </div>
                <button onClick={()=>setShowHelp(false)}
                  style={{ border:"none", background:"rgba(0,0,0,0.06)", borderRadius:"50%",
                    width:32, height:32, fontSize:18, cursor:"pointer", color:"#6B7280",
                    display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
              </div>
              {/* Tab bar */}
              <div style={{ display:"flex", gap:2 }}>
                {[["verktyg","🛠 Verktyg"],["arbetsflode","📋 Arbetsflöde"],["kortkommandon","⌨ Kortkommandon"]].map(([id,lbl])=>(
                  <button key={id} onClick={()=>setHelpTab(id)}
                    style={{ padding:"8px 18px", border:"none", borderRadius:"8px 8px 0 0",
                      background: helpTab===id ? "#F5F6FA" : "transparent",
                      color: helpTab===id ? "#111318" : "#8A909E",
                      fontSize:12, fontWeight: helpTab===id ? 700 : 400, cursor:"pointer",
                      fontFamily:"Inter,sans-serif", borderBottom: helpTab===id ? "none" : "none" }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div style={{ overflowY:"auto", padding:"24px 28px", flex:1 }}>

              {/* ── VERKTYG ── */}
              {helpTab==="verktyg" && (() => {
                const Section = ({title, children}) => (
                  <div style={{ marginBottom:28 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:"#8A909E", letterSpacing:"0.12em",
                      textTransform:"uppercase", marginBottom:12, paddingBottom:6,
                      borderBottom:"1px solid rgba(0,0,0,0.07)" }}>{title}</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>{children}</div>
                  </div>
                );
                const Tool = ({icon, name, shortcut, desc, tip}) => (
                  <div style={{ display:"flex", gap:14, padding:"12px 14px", borderRadius:12,
                    background:"#fff", border:"1px solid rgba(0,0,0,0.07)",
                    boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                    <div style={{ fontSize:24, width:36, textAlign:"center", flexShrink:0, lineHeight:"36px" }}>{icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:13, fontWeight:700, color:"#111318" }}>{name}</span>
                        {shortcut && <span style={{ fontSize:10, padding:"2px 7px", borderRadius:5,
                          background:"#F1F3F7", color:"#6B7280", fontFamily:"monospace", fontWeight:600 }}>
                          {shortcut}</span>}
                      </div>
                      <div style={{ fontSize:12, color:"#4B5563", lineHeight:1.6 }}>{desc}</div>
                      {tip && <div style={{ fontSize:11, color:"#0369A1", marginTop:5,
                        padding:"4px 10px", borderRadius:6, background:"#EFF9FF",
                        border:"1px solid #BAE6FD" }}>💡 {tip}</div>}
                    </div>
                  </div>
                );
                return (
                  <>
                    <Section title="Ritverktyg — lägg till objekt på ritningen">
                      <Tool icon="▦" name="Rita yta (m²)" shortcut="V"
                        desc="Klicka punkt för punkt för att rita en polygon. Stäng ytan genom att klicka på startpunkten, trycka Enter, eller dubbelklicka. Ytan beräknas automatiskt i m²."
                        tip="Välj rätt material i vänsterpanelen innan du börjar rita — färg och pris kopplas automatiskt." />
                      <Tool icon="╱" name="Rita sträcka (m)" shortcut="V → pil"
                        desc="Klicka startpunkt, sedan slutpunkt. Skapar en linje med längd i meter. Använd för kantsten, ledningar och staket."
                        tip="Byt till sträckläget via pilen ▾ bredvid Rita-knappen i verktygsfältet." />
                      <Tool icon="⬜" name="Rita rektangel" shortcut="V → pil"
                        desc="Klicka ett hörn, sedan det diagonalt motsatta hörnet. Skapar en perfekt rektangel på två klick. Idealt för parkeringsplatser, förråd och raka ytor."
                        tip="Snabbare än att klicka 4 punkter manuellt — sparar tid på rektangulära ytor." />
                      <Tool icon="〜" name="Rita polyline" shortcut="V → pil"
                        desc="Rita en flerdelad linje med hur många segment som helst. Klicka varje knutpunkt, tryck Enter eller dubbelklicka för att avsluta. Totallängden summeras."
                        tip="Perfekt för VA-ledningar, elschakt och andra krökta sträckor med flera segment." />
                    </Section>

                    <Section title="Markeringsverktyg">
                      <Tool icon="↖" name="Välj & redigera" shortcut="S"
                        desc="Klicka på ett objekt för att markera det. Dra i de blå punkterna för att flytta enskilda hörn. Tryck Delete för att ta bort markerat objekt."
                        tip="Markera ett objekt och håll sedan kvar musen på en punktmarkering för att dra hörnet till exakt position." />
                    </Section>

                    <Section title="Mätning & kalibrering">
                      <Tool icon="📐" name="Mätlinjal" shortcut="M"
                        desc="Klicka punkt A, sedan punkt B. En blå mätlinje visas med exakt avstånd i meter. Påverkar inte kalkylen — används för snabba kontrollmätningar."
                        tip="Sparade mätningar listas i vänsterpanelen. Expandera med % för att beräkna lutning." />
                      <Tool icon="⚖" name="Kalibrering" shortcut="C"
                        desc="Mäter en känd sträcka på ritningen för att ställa in skalan (px/m). Klicka punkt A, klicka punkt B, ange sedan det verkliga avståndet i meter. Automatisk skaldetektering sker också när PDF laddas in."
                        tip="Kalibrering är det viktigaste steget — kontrollera alltid att ppm stämmer mot skalstämpeln på ritningen." />
                    </Section>

                    <Section title="Anteckningar & media">
                      <Tool icon="📝" name="Anteckning" shortcut="N"
                        desc="Klicka var som helst på ritningen för att placera en gul anteckningspin. Skriv texten direkt och tryck Enter för att spara. Klicka på pinnen för att redigera eller ta bort."
                        tip="Använd för att markera svårtillgängliga partier, befintliga ledningar eller speciella instruktioner." />
                      <Tool icon="📷" name="Foto" shortcut="P"
                        desc="Klicka på ritningen för att koppla ett platsfoto till en koordinat. Välj bildfil i filhanteraren. Klicka på kamerasymbol för att visa bilden i fullskärm."
                        tip="Bifoga foton på svåra terrängförhållanden eller befintliga konstruktioner — syns i delad länk till kund." />
                    </Section>

                    <Section title="Visa & navigera">
                      <Tool icon="◎" name="Etiketter" shortcut=""
                        desc="Togglar visning av mått-etiketter (m² och m) direkt på ritningen. Stäng av för en renare bild vid presentation." />
                      <Tool icon="⊡" name="Centrera" shortcut=""
                        desc="Passar in ritningen i synfältet med optimal zoom. Snabbåterställning om du zoomat bort dig." />
                      <Tool icon="−/+" name="Zoom" shortcut="Ctrl + scroll"
                        desc="Zooma in och ut med knapparna eller håll Ctrl och scrolla med mushjulet. Håll Space och dra för att panorera ritningen." />
                    </Section>

                    <Section title="Projekt & export">
                      <Tool icon="☁" name="Spara till molnet" shortcut=""
                        desc="Sparar hela projektet — ritning, kalkyl, lager, anteckningar och foton — till servern. Projektet är åtkomligt från vilken enhet som helst." />
                      <Tool icon="🔗" name="Dela länk" shortcut=""
                        desc="Kopierar en unik URL för projektet till urklipp. Skicka länken till kunden — de kan öppna och se ritningen direkt i webbläsaren utan att installera något." />
                      <Tool icon="🖼" name="Exportera PNG" shortcut=""
                        desc="Sparar en bild av ritningen med alla uppmätta ytor, sträckor, mätlinjer och anteckningar inritade. Bra som bilaga till offerten." />
                      <Tool icon="📂" name="Historik" shortcut=""
                        desc="Visar alla projekt sparade i molnet med datum, antal objekt och lager. Öppna ett gammalt projekt med ett klick." />
                    </Section>

                    <Section title="Lager">
                      <Tool icon="🗂" name="Lager" shortcut=""
                        desc="Organisera objekt i lager — t.ex. 'Markarbeten', 'Kantsten & VA', 'El'. Varje lager kan döljas eller visas. Aktivt lager bestämmer var nya objekt hamnar."
                        tip="Skapa ett lager per disciplin eller etapp för att hålla kalkylen organiserad i komplexa projekt." />
                    </Section>
                  </>
                );
              })()}

              {/* ── ARBETSFLÖDE ── */}
              {helpTab==="arbetsflode" && (() => {
                const Step = ({n, title, desc, sub}) => (
                  <div style={{ display:"flex", gap:16, padding:"16px 18px", borderRadius:14,
                    background:"#fff", border:"1px solid rgba(0,0,0,0.07)",
                    boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                    <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0,
                      background:"linear-gradient(160deg,#2C3344,#1A2030)",
                      color:"#fff", fontSize:15, fontWeight:800,
                      display:"flex", alignItems:"center", justifyContent:"center" }}>{n}</div>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:"#111318", marginBottom:4 }}>{title}</div>
                      <div style={{ fontSize:12, color:"#4B5563", lineHeight:1.7 }}>{desc}</div>
                      {sub && <div style={{ fontSize:11, color:"#0369A1", marginTop:6,
                        padding:"5px 10px", borderRadius:7, background:"#EFF9FF",
                        border:"1px solid #BAE6FD", lineHeight:1.6 }}>{sub}</div>}
                    </div>
                  </div>
                );
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    <Step n="1" title="Ladda in ritning"
                      desc="Öppna appen och ritningens PDF laddas automatiskt. Vänta tills ritningen visas i canvas-ytan. Om skaldetektering lyckas sätts skalan automatiskt."
                      sub="💡 Kontrollera alltid att skalan (px/m) i statusfältet stämmer mot skalstämpeln på ritningen." />
                    <Step n="2" title="Kalibrera skala (vid behov)"
                      desc="Tryck på ⚖ Skala i verktygsfältet. Klicka en känd sträcka på ritningen — t.ex. längs en linje märkt '10 m'. Ange det verkliga måttet i meter i dialogrutan."
                      sub="💡 Mät alltid mot en referenslinje som är tydligt angiven på ritningen, inte mot skalan i hörnet." />
                    <Step n="3" title="Skapa lager (valfritt)"
                      desc="Gå till fliken Lager i vänsterpanelen. Lägg till ett lager per disciplin eller etapp — t.ex. 'Markarbeten', 'Kantsten', 'Etapp 2'. Välj aktivt lager innan du ritar." />
                    <Step n="4" title="Välj material"
                      desc="I Verktyg-panelen, välj rätt material för ytan du ska mäta — t.ex. 'Asfalt' för en parkeringsyta. Priset per enhet hämtas automatiskt."
                      sub="💡 Du kan redigera materialpris och enhet under fliken Material. Lägg till egna material för specifika projekt." />
                    <Step n="5" title="Rita ytor och sträckor"
                      desc="Välj Rita yta (▦) för m²-objekt — klicka punkt för punkt, avsluta med Enter. Välj Rita sträcka (╱) för m-objekt som kantsten. Rita rektangel (⬜) sparar tid vid rektangulära ytor." />
                    <Step n="6" title="Kontrollmät"
                      desc="Använd 📐 Mätlinjal för att verifiera specifika avstånd utan att de läggs in i kalkylen. Jämför mot kända mått på ritningen." />
                    <Step n="7" title="Granska kalkyl"
                      desc="Gå till fliken Kalkyl i vänsterpanelen. Kontrollera att mängder och priser stämmer. Lägg till egna rader för t.ex. resor, etablering och ritkostnader." />
                    <Step n="8" title="Sätt offert-status"
                      desc="Markera projektets status i Kalkyl-panelen: Utkast → Skickad → Accepterad / Avvisad. Statusen sparas med projektet." />
                    <Step n="9" title="Generera och dela offert"
                      desc="Tryck 'Generera offert →' för att öppna ett utskriftsvänligt PDF-dokument med alla poster, moms och ditt företags logga och kontaktinfo."
                      sub="💡 Spara projektet till molnet (☁) och kopiera delningslänken (🔗) — skicka länken till kunden istället för PDF om du vill ha en interaktiv presentation." />
                    <Step n="10" title="Spara och arkivera"
                      desc="Tryck ☁ Spara för att synka projektet till molnet. Det visas i 📂 Historik med datum och kan öppnas när som helst från vilken enhet som helst." />
                  </div>
                );
              })()}

              {/* ── KORTKOMMANDON ── */}
              {helpTab==="kortkommandon" && (() => {
                const KGroup = ({title, children}) => (
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:"#8A909E", letterSpacing:"0.12em",
                      textTransform:"uppercase", marginBottom:10,
                      paddingBottom:6, borderBottom:"1px solid rgba(0,0,0,0.07)" }}>{title}</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>{children}</div>
                  </div>
                );
                const K = ({keys, desc}) => (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"8px 12px", borderRadius:8,
                    background:"#fff", border:"1px solid rgba(0,0,0,0.07)" }}>
                    <span style={{ fontSize:12, color:"#374151" }}>{desc}</span>
                    <div style={{ display:"flex", gap:4 }}>
                      {keys.map((k,i)=>(
                        <kbd key={i} style={{ padding:"3px 8px", borderRadius:5,
                          background:"linear-gradient(160deg,#F1F3F7,#E8EBF0)",
                          border:"1px solid rgba(0,0,0,0.15)",
                          boxShadow:"0 1px 0 rgba(0,0,0,0.12)",
                          fontSize:11, fontFamily:"monospace", fontWeight:600, color:"#374151" }}>{k}</kbd>
                      ))}
                    </div>
                  </div>
                );
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>
                    <div>
                      <KGroup title="Verktygsväljare">
                        <K keys={["V"]} desc="Rita-läge" />
                        <K keys={["S"]} desc="Välj & redigera" />
                        <K keys={["M"]} desc="Mätlinjal" />
                        <K keys={["N"]} desc="Anteckning" />
                        <K keys={["P"]} desc="Foto" />
                        <K keys={["C"]} desc="Kalibrering" />
                      </KGroup>
                      <KGroup title="Ritning">
                        <K keys={["Enter"]} desc="Stäng polygon / avsluta polyline" />
                        <K keys={["Escape"]} desc="Avbryt pågående ritning" />
                        <K keys={["Delete"]} desc="Ta bort markerat objekt" />
                        <K keys={["Ctrl","Z"]} desc="Ångra senaste åtgärd" />
                      </KGroup>
                    </div>
                    <div>
                      <KGroup title="Navigering">
                        <K keys={["Space","+ dra"]} desc="Panorera ritningen" />
                        <K keys={["Ctrl","+ scroll"]} desc="Zoom in/ut" />
                        <K keys={["Scroll"]} desc="Panorera upp/ned" />
                      </KGroup>
                      <KGroup title="Övrigt">
                        <K keys={["Ctrl","S"]} desc="Spara projekt (ej inbyggt — använd ☁-knappen)" />
                        <K keys={["?"]} desc="Öppna denna hjälpguide" />
                      </KGroup>
                      <div style={{ marginTop:20, padding:"14px 16px", borderRadius:12,
                        background:"linear-gradient(135deg,#FFFBEB,#FEF3C7)",
                        border:"1px solid #FDE68A" }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#92400E", marginBottom:6 }}>
                          💡 Pro-tips för snabbare mängdning
                        </div>
                        <ul style={{ fontSize:11, color:"#78350F", lineHeight:2, margin:0, paddingLeft:16 }}>
                          <li>Zooma in nära på komplexa hörn för exaktare punktsättning</li>
                          <li>Använd rektangelverktyget för alla raka ytor — halverar klicken</li>
                          <li>Rita polyline för VA- och elledningar i ett drag</li>
                          <li>Skapa lager per etapp om projektet ska faktureras i delar</li>
                          <li>Exportera PNG som bilaga direkt i offert-mailet</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}

      {/* ══ PROJEKTHISTORIK MODAL ════════════════════════════════════════════ */}
      {showProjectHistory && (
        <div style={{ position:"fixed", inset:0, zIndex:200,
          background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={()=>setShowProjectHistory(false)}>
          <div style={{ background:"#fff", borderRadius:18, padding:28, width:540,
            maxWidth:"92vw", maxHeight:"80vh", overflow:"hidden", display:"flex", flexDirection:"column",
            boxShadow:"0 24px 80px rgba(0,0,0,0.25)" }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <h2 style={{ fontSize:18, fontWeight:700, color:"#111318", margin:0 }}>📂 Projekthistorik</h2>
              <button onClick={()=>setShowProjectHistory(false)}
                style={{ border:"none", background:"none", fontSize:22, cursor:"pointer", color:"#8A909E" }}>×</button>
            </div>

            {savedProjects.length===0 ? (
              <div style={{ textAlign:"center", padding:"40px 0", color:"#8A909E", fontSize:14 }}>
                Inga sparade projekt ännu.<br/>
                <span style={{ fontSize:12, marginTop:8, display:"block" }}>Tryck 💾 Spara i verktygsfältet för att spara ett projekt.</span>
              </div>
            ) : (
              <div style={{ overflowY:"auto", display:"flex", flexDirection:"column", gap:8 }}>
                {savedProjects.map(p=>{
                  const d = new Date(p.date);
                  const dateStr = d.toLocaleDateString("sv-SE",{day:"numeric",month:"long",year:"numeric"});
                  const timeStr = d.toLocaleTimeString("sv-SE",{hour:"2-digit",minute:"2-digit"});
                  const nObj    = (p.objects||[]).length;
                  const totalM2 = (p.objects||[]).filter(o=>o.geo==="area")
                    .reduce((s,o)=>s+shoelaceArea(o.pts)/((p.ppm||100)**2),0);
                  return (
                    <div key={p.id} style={{ display:"flex", gap:12, padding:"14px 16px",
                      borderRadius:12, background:"linear-gradient(160deg,#FAFBFF,#F3F4F8)",
                      border:"1px solid rgba(0,0,0,0.08)",
                      boxShadow:"0 2px 8px rgba(0,0,0,0.05)" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:14, fontWeight:700, color:"#111318", marginBottom:3 }}>{p.name}</div>
                        <div style={{ fontSize:11, color:"#8A909E", fontFamily:"Inter,sans-serif" }}>
                          {dateStr} kl. {timeStr} · {nObj} objekt · {fmtN(totalM2,1)} m²
                        </div>
                        {(p.layers||[]).length>0 && (
                          <div style={{ display:"flex", gap:4, marginTop:6, flexWrap:"wrap" }}>
                            {(p.layers||[]).map(l=>(
                              <span key={l.id} style={{ fontSize:9.5, padding:"2px 7px",
                                borderRadius:20, background:l.color+"22", color:l.color,
                                fontWeight:700, border:`1px solid ${l.color}44` }}>
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6, justifyContent:"center" }}>
                        <button onClick={()=>loadProject(p)}
                          style={{ padding:"6px 14px", borderRadius:8, border:"none",
                            background:"linear-gradient(160deg,#2C3344,#1A2030)",
                            color:"#fff", fontSize:11, fontWeight:600, cursor:"pointer",
                            fontFamily:"Inter,sans-serif" }}>
                          Öppna
                        </button>
                        <button onClick={()=>deleteProject(p.id)}
                          style={{ padding:"5px 14px", borderRadius:8,
                            border:"1px solid rgba(196,40,28,0.2)",
                            background:"rgba(196,40,28,0.06)",
                            color:"#C4281C", fontSize:11, cursor:"pointer",
                            fontFamily:"Inter,sans-serif" }}>
                          Ta bort
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop:16, paddingTop:14, borderTop:"1px solid rgba(0,0,0,0.07)",
              display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <span style={{ fontSize:11, color:"#8A909E" }}>
                ☁ {savedProjects.length} projekt i molnet
                {cloudProjectId && <span style={{ marginLeft:8, color:T.green, fontWeight:600 }}>· Aktivt projekt sparat</span>}
              </span>
              <div style={{ display:"flex", gap:8 }}>
                {cloudProjectId && (
                  <button onClick={copyShareLink}
                    style={{ padding:"8px 14px", borderRadius:9,
                      border:"1px solid rgba(59,111,212,0.3)",
                      background:"rgba(59,111,212,0.08)",
                      color:T.accentBlue, fontSize:12, cursor:"pointer",
                      fontFamily:"Inter,sans-serif" }}>
                    🔗 Kopiera delningslänk
                  </button>
                )}
                <button onClick={()=>saveProject()}
                  style={{ padding:"8px 18px", borderRadius:9, border:"none",
                    background:"linear-gradient(160deg,#2C3344,#1A2030)",
                    color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer",
                    fontFamily:"Inter,sans-serif" }}>
                  ☁ Spara nuvarande projekt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Material editor ──────────────────────────────────────────────────────────

function MatEditor({ mat, onSave, onCancel }) {
  const [form, setForm] = useState({...mat});
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const COLORS = ["#3B6FD4","#0A7C54","#B07D10","#C4281C","#6B5CE7","#64748B","#CA8A04","#0E7C58","#9B3030","#0E7AA0","#7C5CC7","#C45E1A"];
  const fieldStyle = {
    width:"100%", padding:"8px 11px", borderRadius:9,
    border:"1px solid rgba(0,0,0,0.1)", background:"rgba(255,255,255,0.8)",
    color:"#111318", fontSize:12, fontFamily:"Inter,sans-serif",
    outline:"none", boxShadow:"inset 0 1px 3px rgba(0,0,0,0.06)",
    transition:"border-color 0.15s, box-shadow 0.15s",
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10, padding:14,
      background:"linear-gradient(160deg,#FFFFFF,#F5F6FA)",
      borderRadius:13,
      border:"1px solid rgba(0,0,0,0.09)",
      boxShadow:"0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,1)",
      animation:"fadeIn 0.15s ease" }}>

      <div style={{ fontSize:9.5, fontWeight:700, color:"#8A909E",
        letterSpacing:"0.14em", textTransform:"uppercase" }}>
        {form.id==="new" ? "Nytt material" : "Redigera material"}
      </div>

      {[["Namn","label","text"],["Enhet","unit","text"],["Pris (kr/enhet)","price","number"]].map(([lbl,key,type])=>(
        <label key={key}>
          <div style={{ fontSize:9.5, color:"#8A909E", marginBottom:4,
            textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>{lbl}</div>
          <input className="lux-input" type={type} value={form[key]}
            onChange={e=>set(key,type==="number"?parseFloat(e.target.value)||0:e.target.value)}
            style={fieldStyle} />
        </label>
      ))}

      <label>
        <div style={{ fontSize:9.5, color:"#8A909E", marginBottom:4,
          textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Geometri</div>
        <select className="lux-input" value={form.geo} onChange={e=>set("geo",e.target.value)}
          style={{ ...fieldStyle, cursor:"pointer" }}>
          <option value="area">Yta (m²)</option>
          <option value="line">Linje (m)</option>
        </select>
      </label>

      <div>
        <div style={{ fontSize:9.5, color:"#8A909E", marginBottom:6,
          textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Färg</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {COLORS.map(c=>(
            <div key={c} onClick={()=>set("color",c)} style={{
              width:24, height:24, borderRadius:"50%",
              background:`linear-gradient(135deg, ${c}, ${c}BB)`,
              cursor:"pointer",
              outline: form.color===c ? "2px solid rgba(0,0,0,0.4)" : "2px solid transparent",
              outlineOffset:2,
              boxShadow: form.color===c ? `0 2px 8px ${c}66` : "0 1px 3px rgba(0,0,0,0.15)",
              transform: form.color===c ? "scale(1.18)" : "scale(1)",
              transition:"all 0.12s",
            }} />
          ))}
        </div>
      </div>

      <div style={{ display:"flex", gap:8, marginTop:4 }}>
        <button className="lux-btn" onClick={()=>onSave(form)} style={{
          flex:1, padding:"9px",
          background:"linear-gradient(160deg,#2C3344 0%,#1A2030 100%)",
          border:"1px solid rgba(255,255,255,0.06)",
          borderRadius:9, color:"#FFFFFF", fontSize:12, fontWeight:700, cursor:"pointer",
          fontFamily:"Inter,sans-serif",
          boxShadow:"0 2px 10px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}>Spara</button>
        <button className="lux-btn" onClick={onCancel} style={{
          flex:1, padding:"9px",
          background:"linear-gradient(160deg,#FFFFFF,#F0F2F6)",
          border:"1px solid rgba(0,0,0,0.1)",
          borderRadius:9, color:"#6B7280", fontSize:12, cursor:"pointer",
          fontFamily:"Inter,sans-serif",
          boxShadow:"0 1px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,1)",
        }}>Avbryt</button>
      </div>
    </div>
  );
}

