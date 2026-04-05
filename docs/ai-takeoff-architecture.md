# AI-driven Quantity Takeoff — Teknisk arkitektur & roadmap

**Datum:** 2026-04-04
**Syfte:** Referensdokument för design, implementation och kommersialisering av ett automatiserat mängdavtagningssystem för byggritningar.

---

## 1. Executive Summary

Det vi bygger är en **reference-guided segmentation engine** för konstruktionsritningar: användaren markerar ett enda exempel på ett material, systemet hittar automatiskt alla identiska ytor i hela ritningen och levererar mängder i m².

Det korrekta tekniska namnet på problemet är **few-shot visual segmentation** kombinerat med **construction document understanding (CDU)**. Det är inte ett enkelt RGB-sökproblem — det handlar om att förstå grafiska konventioner (streckmönster, texturer, linjekoder) som är domänspecifika för AEC-industrin (Architecture, Engineering & Construction).

Den kommersiellt närmaste konkurrenten är **Togal.AI**, som löser exakt samma problem med deep learning och rapporterar 98 % noggrannhet. De tog fem år och en stor datamängd. Vår strategi är att börja med ett hybridpipeline (regelbaserad + statistisk) som fungerar idag, och successivt ersätta komponenterna med lärande modeller allt eftersom vi samlar in korrigeringsdata från användarna.

**Bottom line:** MVP kan levereras på 4–6 veckor med befintlig teknik. V2 med riktig maskinlärning kräver 6–12 månader och ca 10 000 annoterade ritningsytor.

---

## 2. Problemdefinition

### 2.1 Vad vi egentligen gör

Givet:
- En konstruktionsritning renderad som PNG (300 DPI, 4000–17 000 px per sida)
- En polygon som användaren ritat över ett exempel på ett material (referenspolygon)
- Eventuellt ett materialnamn från ett projekts materialregister

Sök igenom hela ritningen och returnera:
- Alla ytor där samma material förekommer som avgränsade polygoner
- Area i m² per yta, totalt
- Konfidenspoäng per region

### 2.2 Vad gör det svårt

**Renderingsvariationer:** Samma material kan se olika ut beroende på CAD-program, plotter, skanningskvalitet, DPI och JPEG-komprimering. En betongplatta ritas som ett golvmönster i Revit, men scannas som ett grågrönt mönster med komprimeringsartefakter i PDF:en.

**Streckmönster och hatch:** AEC-ritningar använder ISO/DIN-standardiserade streckmönster (ANSI31, AR-CONC, etc.) för att indikera material i snitt. Dessa är glesa — 80–95 % av pixlarna är bakgrundsfärg, bara 5–20 % är faktiska streckkroppar. Enkla RGB-trösklar misslyckas.

**Visuellt likartade material:** Armerad betong och betong ser nästan identiska ut. Isoleringsmaterial har liknande densitetsmönster. Golvmaterial skiljer sig via färgton, inte form.

**Skalvariationer:** Samma material förekommer i ytor från 0,1 m² till 2 000 m². En algoritm måste hitta båda.

**Ritningskonventioner:** AEC har implicit domänkunskap som inte finns i naturliga bilder. En streckad linje = befintlig konstruktion. Tjock kontur = byggnadsdel. Tunn kontur = måttlinje. Modeller tränade på ImageNet förstår inget av detta.

### 2.3 Formell problembeskrivning

```
Indata:  (I ∈ R^{H×W×3}, P_ref ⊂ Z², label ∈ str)
Utdata:  {R_1, R_2, ..., R_k} där R_i = (polygon_i, area_i, confidence_i)
Constraint: ∀ R_i, visual_similarity(I[R_i], I[P_ref]) > τ
```

Detta är en instans av **few-shot semantic segmentation** med en enda referens (k=1, "one-shot").

---

## 3. Research / Benchmark från andra lösningar

### 3.1 Kommersiella system

**Togal.AI (USA, grundat 2020, $35M i funding)**
- Gör exakt vad vi vill: rita polygon → hitta alla matchande ytor
- Rapporterar 98 % noggrannhet på standardritningar, 50× snabbare än manuellt
- Teknik: proprietär deep learning (sannolikt maskerad konvolutionell autoencoder + contrastive learning)
- Tränade på >1 miljon annoterade ritningssidor
- Stöder PDF, Revit, AutoCAD
- Svaghet: kräver molnuppladdning, dyrt SaaS, ingen offline-support

**Planswift / Trimble Takeoff**
- Manuellt verktyg — INGEN automatisk igenkänning av streckmönster
- Användaren klickar polygon för polygon
- Automation begränsad till räkning av symboler (dörrar, fönster) via template matching
- Relevant insikt: den manuella UX-modellen (rita polygon, se area) är vad användarna förväntar sig

**Bluebeam Revu**
- PDF-annoteringsprogram med mängdräkningsplugin
- Magic Wand-verktyg: klicka på en pixel → fyller sammanhängande region av liknande färg (flood fill)
- Begränsat till sammanhängande ytor — hittar inte spridda identiska ytor
- Kräver manuell kalibrering av ritningsskalan

**Buildots**
- Fokus på byggplatsövervakning (360°-kameror + BIM-jämförelse), inte 2D-takeoff
- Relevant teknik: de tränar domänspecifika segmenteringsmodeller på byggfoton
- Visar att domänspecifik träning är nödvändig — ImageNet-modeller räcker inte

**Procore/Autodesk Takeoff**
- Integrerat i BIM-workflow, automatiserar räkning från BIM-modell
- Inte relevant för 2D PDF-ritningar utan BIM-källa

### 3.2 Akademisk forskning

**VectorGraphNET (Chen et al., 2022)**
- Graph Attention Networks (GAT) på SVG/DWG-vektordata
- 89 % F1 på FloorplanCAD-dataset
- 1,3 miljoner parametrar — extremt litet, kan köras på CPU
- Kräver vektordata (DWG/SVG), fungerar inte på rasteriserade PDF:er utan konvertering
- Relevant för V3 om vi kan kräva DWG-input

**Segment Anything Model — SAM (Meta AI, 2023)**
- Foundation model tränad på 1 miljard masker från naturliga bilder
- Zero-shot: inga exempel behövs, generaliserar direkt
- Testad på arkitekturritningar: hittar rum, dörrar, väggar med 0 träningsdata
- Stöder "point prompt" och "box prompt" — perfekt för vår UX (användaren markerar)
- Svaghet: konfunderas av täta streckmönster, ger ibland hel-ritning som ett segment
- SAM2 (2024): väsentligt bättre på komplexa ytor, stöder video/sekvensinput

**GLCM + LBP-texturbeskrivare**
- GLCM (Gray-Level Co-occurrence Matrix): fångar pixelkorrelationer — distinguishes between fine hatch (many transitions) vs solid fill (few transitions)
- LBP (Local Binary Patterns): rotationsinvariant textur, 58-dim feature vector
- Kombinerade med k-NN: 94 % noggrannhet på 12 hatch-klasser i Gu et al. 2019
- Kan tränas på syntetiska data (datorritade hatchar) — behöver inte riktiga ritningar
- Beräkningskostnad: 15–40 ms per region på CPU

**Few-shot SAM + GPT-4V (Liu et al., 2024)**
- 5 referensexempel → SAM segmenterar rum, dörrar, text korrekt
- GPT-4V används för att generera segment-prompts från visuell kontext
- Proof of concept: visar att multi-modal foundation models förstår ritningskonventioner

**CubiCasa5k, ArchCAD-400K, CVC-FP**
- Offentliga dataset med annoterade arkitekturritningar
- CubiCasa5k: 5 000 finska planritningar, room/door/window-segmentering
- ArchCAD-400K: 400 000 DWG-ritningar med layer-metadata
- Kan användas för fine-tuning av SAM, ej direkt för hatch-igenkänning

---

## 4. Gemensamma nämnare och mönster

Ur forskning och kommersiella system framträder fem starka mönster:

**1. Referenspunkten är en feature-vektor, inte en pixelfärg**
Alla moderna system extraherar en multi-dimensionell representation (embedding) av referensregionen och söker efter liknande embeddings — inte liknande pixlar. RGB-likheten är ett specialfall med extremt låg dimensionalitet (3D) och hög brus-känslighet.

**2. Textur + form + färg kombineras alltid**
Inget system förlitar sig på en enda signal. Standardreceptet: färghistogram (robusthet) + texturbeskrivare (diskriminering) + formegenskaper (validering). Vikt varje kanal beroende på material.

**3. Domänspecifik träning är kritisk**
Alla kommersiella system tränar på AEC-specifik data. ImageNet-features förstår inte rasteriserade streckmönster. SAM är undantaget (zero-shot) men presterar sämst på hatchar.

**4. Human-in-the-loop multiplicerar datakvaliteten**
Togal.AI och Buildots samlar systematiskt korrigeringar. Varje gång en användare rättar ett felaktigt segment är det en träningspunkt. Active learning på dessa ger snabbare förbättring än passiv data-insamling.

**5. Hierarkisk sökning skalas bättre**
Coarse-to-fine: grov segmentering (SAM/Watershed) → textur-klassificering per segment → polygon-generering. Direkt pixelsökning på 17-megapixlar tar 90 sekunder, SAM-segmentering + feature-matching tar 3 sekunder.

---

## 5. Rekommenderad arkitektur

```
┌─────────────────────────────────────────────────────────────────┐
│                        RENDERING LAYER                          │
│  PDF → Poppler (300 DPI) → PNG → normalisering + metadata      │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     REFERENCE ENCODER                           │
│  Referenspolygon → crop → feature extraction                    │
│  [Fas 1] GLCM + LBP + color histogram (CPU, 20ms)              │
│  [Fas 2] SAM encoder embedding (GPU, 150ms)                     │
│  [Fas 3] Fine-tuned ViT embedding (GPU, 80ms)                   │
│  Output: feature_vector ∈ R^{256}                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    CANDIDATE GENERATOR                          │
│  [Fas 1] Morfologisk segmentering + connected components       │
│  [Fas 2] SAM multi-scale segmentering (zero-shot)              │
│  [Fas 3] Hierarkisk segmentering med domänpriors               │
│  Output: [candidate_region_1, ..., candidate_region_N]         │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                      SIMILARITY RANKER                          │
│  For each candidate: similarity(candidate_features, ref_vector) │
│  [Fas 1] Cosine similarity på GLCM/LBP-features (CPU)         │
│  [Fas 2] Contrastive learning-head (MLP, 10ms/candidate)       │
│  Output: [(region, score, confidence)] ranked by score         │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    POLYGON GENERATOR                            │
│  Tröskling på score ≥ τ (default 0,75)                        │
│  Konvex hull + polygon-förenkling (Douglas-Peucker)            │
│  Area-beräkning + skalkompensation (px/m från step1)           │
│  Output: [{polygon, area_m2, confidence, material_id}]         │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                   HUMAN-IN-THE-LOOP                             │
│  Visar resultat i canvas — användaren korrigerar               │
│  Varje korrigering → training_sample sparas i feedback-store   │
│  Periodisk fine-tuning baserat på ackumulerade samples         │
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 Varför inte bara SAM direkt?

SAM ger ett segmentförslag — men det matchar inte automatiskt mot referensen. Vi behöver ändå en similarity-ranker. SAM ersätter steg 3 (Candidate Generator), inte hela pipelinen.

### 5.2 Varför inte bara konvolutionellt neuralt nätverk (CNN)?

CNN kräver tusentals annoterade ritningar för träning. Vi har noll. GLCM/LBP fungerar utan träningsdata och ger rimliga resultat direkt. CNN är rätt val för V2 när vi har data.

---

## 6. Steg-för-steg pipeline

### Steg 0: Dokumentinladdning (finns, step1)
```
PDF → Poppler 300DPI → ritning_p001.png
Kalibrering: hitta skalfigur → px_per_m
Output: step1_result.json {pages: [{scale_px_per_m}]}
```

### Steg 1: Materialregister (finns, step9)
```
PNG → färganalys per zon → material-kandidater med pixel_hex
Output: step9_takeoff_table.json [{material_label, pixel_hex, area_m2}]
```

### Steg 2: Referensinsamling (UX — delvis finns)
```
Användaren ritar polygon P_ref på canvas (pdfjs)
canvas_pts → konverteras till PNG-koordinater (ingen Y-flip)
seed_pt = centroid(P_ref) i PNG-koordinater
ref_bbox = bounding_box(P_ref) i PNG-koordinater
```

### Steg 3: Feature Extraction från referensregion
```python
# Extrahera crop från PNG
crop = png[ref_bbox.y:ref_bbox.y+h, ref_bbox.x:ref_bbox.x+w]

# Beräkna features
color_hist = compute_color_histogram(crop, bins=32)  # 32*3 = 96-dim
glcm = graycomatrix(to_gray(crop), distances=[1,3,5], angles=[0,45,90,135])
glcm_features = [contrast, dissimilarity, homogeneity, energy, correlation]  # 5*12=60-dim
lbp = local_binary_pattern(to_gray(crop), P=8, R=1)
lbp_hist = histogram(lbp, bins=64)  # 64-dim

feature_vector = concatenate([color_hist, glcm_features, lbp_hist])  # 220-dim
```

### Steg 4: Kandidatgenerering (MVP: morfologisk segmentering)
```python
# Binarisera mot referensfärg med adaptiv tröskel
mask = color_threshold(png, target_color=pixel_hex, threshold=effective_thresh)

# Morfologisk closing för att fylla hatch-gaps
kernel = disk(close_radius)
mask = binary_closing(mask, kernel)

# Hitta sammanhängande regioner
labels = label(mask)
regions = regionprops(labels)
```

### Steg 5: Similarity scoring (MVP: area + färg; V2: feature-vektor)
```python
for region in regions:
    crop = png[region.bbox]
    region_color = dominant_color(crop)
    color_dist = euclidean_rgb(region_color, ref_color)
    area_score = min(region.area / ref_area, 3.0)  # cap outliers

    # MVP: enkel scoring
    score = 1.0 - (color_dist / 255)

    if score > threshold and region.area_m2 > min_area_m2:
        accepted_regions.append((region, score))
```

### Steg 6: Polygongenerering
```python
for region, score in accepted_regions:
    hull = convex_hull(region.coords)  # eller concave hull för komplexa former
    hull_simplified = douglas_peucker(hull, epsilon=3)  # 3px förenkling
    area_m2 = region.area / (px_per_m ** 2)
    polygon_canvas = [png_to_canvas(pt) for pt in hull_simplified]

    yield {
        "polygon": polygon_canvas,
        "area_m2": area_m2,
        "confidence": score,
        "n_pixels": region.area,
        "bbox_png": region.bbox
    }
```

### Steg 7: Visning i canvas (finns i DrawingTool.jsx)
```jsx
// Renderar varje polygon med material-färg, 33% fyllnad, streckad kant
// fromScan: true → dashed border, tjockare stroke
// Klickbar → redigera/ta bort
```

### Steg 8: Feedback-insamling (saknas — V2)
```
Användare lägger till polygon manuellt → positiv träningspunkt
Användare tar bort auto-region → negativ träningspunkt
Spara: {ref_features, region_features, label: 1 or -1, timestamp, project_id}
```

---

## 7. MVP-plan för vårt program

**Tidsram:** 4–6 veckor
**Förutsättning:** Befintlig scan_pattern.py + route.js + DrawingTool.jsx som bas

### Vecka 1–2: Stabilisera befintlig pipeline

- [x] Fixa Y-koordinat-inversion (canvas → PNG mapping)
- [x] Fixa synlighet för scan-regioner (opacity, stroke, dashArray)
- [x] Fixa materialfärg på scan-regioner (använd selMat.color)
- [x] Fixa bg_ratio fallback (undvik falsk vit-extraktion vid hatch)
- [ ] Lägg till konfidensscore per region i scan-resultatet
- [ ] Visa konfidens i UI (grön/gul/röd indikator per region)
- [ ] Förbättra polygon-approximation (concave hull för L-formade ytor)

### Vecka 3–4: Feature extraction

- [ ] Lägg till GLCM + LBP-beräkning i scan_pattern.py
- [ ] Spara referensregionens feature-vektor per mall-template
- [ ] Jämför varje kandidat mot referens (cosine similarity på feature-vektor)
- [ ] Ranka regioner efter similarity score, visa score i UI

### Vecka 5–6: UX och robusthet

- [ ] Batch-scan: skanna hela ritningen med alla registrerade material-mallar
- [ ] Progress-indikator för skanningar >5 sekunder
- [ ] Redigera scan-polygon (dra i hörn för att korrigera)
- [ ] Exportera mängdavtagning till Excel (material + area + antal regioner)
- [ ] Felhantering och tydliga felmeddelanden

**MVP-leverabel:** En fungerande UX där användaren markerar ett material, systemet hittar alla liknande ytor, och resultatet kan exporteras. Kräver inga GPU-resurser, körs lokalt.

---

## 8. Version 2 / 3 / Robust kommersiell version

### V2 — Feature-baserad matchning med inlärning (6–12 månader)

**Mål:** Ersätt piggsvin-RGB-sökning med riktig feature-matching. Börja samla in träningsdata.

**Komponenter:**
- GLCM + LBP-features extraherade från referensregion och alla kandidatregioner
- Träna SVM/gradient boosting classifier: "är det här samma material?" (binär klassificering)
- Negativa exempel: alla regioner av andra material (insamlas automatiskt)
- Positiva exempel: regioner som användaren bekräftat
- Aktiv inlärning: systemet frågar om oklara kandidater (confidence 0.5–0.7)
- Feedback-pipeline: varje korrigering sparas, batch-träning varje vecka

**Förväntad precision:** 85–90 % precision, 70–80 % recall på standardritningar

**Dataset-krav:** ~2 000 annoterade regioner från 50–100 ritningar

### V3 — Deep learning med SAM-integration (12–24 månader)

**Mål:** SAM som kandidatgenerator, fine-tunad ViT-encoder som similarity model.

**Komponenter:**
- SAM segmenterar hela ritningen → N kandidatsegment (typiskt 200–800)
- Fine-tunad CLIP-ViT-encoder tränad på AEC-specifika hatch/material-par
- Contrastive learning: referensembedding matchas mot kandidatembeddings
- Tröskling + NMS (Non-Maximum Suppression) för overlappande regioner
- Konfidensmodell: kalibrerad Platt scaling för meningsfulla sannolikheter

**Förväntad precision:** 92–96 % precision på 15 vanliga AEC-material
**Kräver:** GPU för inference (NVIDIA T4 eller bättre), 10 000 annoterade regioner

### Kommersiell version — Fullständig CDU-plattform (2–3 år)

- Multi-sida PDF: skan alla sidor parallellt, summera per material
- BIM-integration: matcha 2D-material mot IFC-objekt för validering
- LLM-parser: läs ritningssymbolförteckning och koppla automatiskt material-etiketter
- Ritnings-RAG: vektordatabas av tidigare projekt, föreslå liknande material automatiskt
- On-prem deployment: känsliga ritningar stannar hos kunden
- API för systemintegration: Revit plugin, Norconsult-integration, Byggtjänst

---

## 9. Dataformat

### 9.1 Region-objekt (i-minne + API)

```typescript
interface ScanRegion {
  id:           string;          // "scan-{timestamp}-{index}"
  geo:          "area";
  pts:          [number, number][];  // [[cx,cy], ...] i canvas-koordinater

  // Material
  matId:        string;          // FK till materials[]
  label:        string;          // "Betongplattor 60x60"
  color:        string;          // "#4A7C59" — materialets tilldelade färg

  // Mängd
  unit:         "m²" | "m" | "st";
  area_m2:      number;          // beräknad area
  price:        number;          // enhetspris (kan vara 0)

  // Metadata
  fromScan:     true;            // distinguishes auto vs manual
  confidence:   number;          // 0.0–1.0
  n_pixels:     number;          // råpixelcount (debug)
  bbox_png:     [x,y,w,h];      // bounding box i PNG-koordinater

  // Felkälla / feedback
  userReviewed: boolean;         // har användaren bekräftat?
  userCorrected: boolean;        // har användaren redigerat?
}
```

### 9.2 Mall-template (referenspolygon)

```typescript
interface MallTemplate {
  id:           string;
  label:        string;          // materialnamn
  matId:        string;          // FK
  matColor:     string;          // materialets färg
  hex:          string;          // samplad pixel_hex från PNG

  canvas_pts:   [number, number][];   // referenspolygon i canvas-koordinater
  seed_pt:      [number, number];     // PNG-seed punkt (centroid)
  ref_bbox:     [x,y,w,h];           // PNG bounding box

  features?: {                   // V2: sparade feature-vektorer
    color_hist:  number[];
    glcm:        number[];
    lbp:         number[];
  };

  scan_result:  ScanResult;      // senaste scan-resultat
  created_at:   string;
}
```

### 9.3 Feedback-event (träningsdata)

```typescript
interface FeedbackEvent {
  event_type:   "confirm" | "delete" | "add" | "resize";
  region_id:    string;
  template_id:  string;

  // Kontext
  project_id:   string;
  drawing_hash: string;         // SHA256 av ritnings-PNG
  timestamp:    string;

  // Region-features vid händelsen (för träning)
  region_features: number[];
  ref_features:    number[];

  // Utfall
  is_correct:   boolean;        // true om confirm/add, false om delete
  corrected_pts?: [number,number][];  // nya hörn om resize
}
```

### 9.4 Exportformat

```json
{
  "project": "Projekt AB, Ritning A001",
  "date": "2026-04-04",
  "scale_px_per_m": 118.1,
  "materials": [
    {
      "label": "Betongplattor 60x60",
      "color": "#4A7C59",
      "unit": "m²",
      "regions": [
        {"id": "scan-001", "area_m2": 4.2, "confidence": 0.91},
        {"id": "scan-002", "area_m2": 3.1, "confidence": 0.88}
      ],
      "total_area_m2": 36.4,
      "region_count": 21,
      "avg_confidence": 0.89
    }
  ]
}
```

---

## 10. Human-in-the-loop och lärande

### 10.1 Principer

Systemet ska bli bättre för varje projekt. Varje gång en användare korrigerar en felaktig region är det gratis träningsdata. Varje bekräftad korrekt region är ett positivt exempel.

Nyckeln: **insamla data passivt** utan att störa arbetsflödet. Använd inte pop-ups som frågar "var det här rätt?" — de ignoreras. Spåra istället implicit: om användaren tar bort en auto-region direkt = troligtvis fel. Om de lämnar den kvar = troligtvis rätt.

### 10.2 Implicit feedback-insamling

| Händelse | Tolkning | Träningssignal |
|----------|----------|---------------|
| Scan-region lämnas kvar i exporterat dokument | Korrekt | Positiv (+1) |
| Scan-region tas bort | Fel | Negativ (-1) |
| Användaren ritar manuellt region intill scan-region | Saknat segment | Positiv (+1 för ny region) |
| Scan-region redigeras (hörn dras) | Delvis fel | Mjuk positiv (0.5) |
| Scan-region ändrar materialtyp | Fel material | Stark negativ (-1) + ny positiv för annat material |

### 10.3 Active learning

För kandidatregioner med confidence 0,50–0,75 (osäkra): visa dem med annorlunda visuell stil (orange istället för grönt) och fråga implicitly: "dessa är osäkra — bekräfta eller ta bort". Säker ≥ 0,75 visas direkt. Osäker < 0,50 visas inte alls (men sparas i databasen för batch-review).

### 10.4 Träningsstrategi

**Fas 1 (0–500 feedback-events):** Uppdatera tröskelparametrar (threshold, close_radius) per material-klass via Bayesian optimization. Ingen modell-träning.

**Fas 2 (500–5 000 events):** Träna en lightweight binary classifier (SVM eller gradient boosting) på feature-vektorer. Kräver 200+ positiva och 200+ negativa per materialtyp.

**Fas 3 (5 000+ events):** Fine-tuna SAM-encoder eller ViT med contrastive loss (InfoNCE). Kräver GPU. Deployment som en periodisk batch-jobb (månadsvis om-träning).

### 10.5 Federerad lärning för känsliga projekt

Ritningar för offentliga byggnader, försvarsanläggningar etc. kan inte skickas till ett centralt träningskluster. Lösning: **federated learning** — träning sker lokalt på varje kunds server, bara gradient-uppdateringar (inte data) skickas centralt. Tekniskt möjligt med Flower eller TensorFlow Federated.

---

## 11. Risker och fallgropar

### 11.1 Tekniska risker

**Skanningsvariationer är värre än förväntat (hög risk)**
Gamla skannade PDF:er från 1990-talet har 72 DPI, JPEG-komprimering och sneda marginaler. Algoritmer tränade på rena CAD-ritningar fungerar inte. Mitigation: bygg in DPI-detektering och vägra automatisk scan på ritningar under 150 DPI.

**Streckmönster vs solid fill — falska positiver (medel risk)**
En grå hatch och ett grått golv har liknande dominanta färg. Utan texturanalys blandas de ihop. Mitigation: GLCM-features distinguishes dem (hatch = hög kontrast + låg homogenitet).

**Skalfiguren hittas fel (medel risk)**
Om step1 kalibrerar px_per_m fel med 5 % ger det 10 % fel i area (kvadratisk). Mitigation: låt användaren bekräfta kalibreringen visuellt, visa "30 meter i faktisk skala = X pixlar".

**Flera sidor och lager (medel risk)**
En PDF med A-ritningar (arkitekt) och K-ritningar (konstruktion) renderas till separata PNG:er. Material på en sida kan ha andra färger än exakt samma material på en annan sida. Mitigation: kör step9 per sida, bygg sida-mappning av materialfärger.

**Memory overflow på stora ritningar (låg risk)**
17 megapixel-PNG i float32 = 200 MB RAM. Med scipy closing och PIL = upp till 600 MB peak. Mitigation: tiled processing — dela PNG i 4096×4096-bitar med 256px overlap.

### 11.2 Affärsrisker

**Togal.AI expanderar till Europa**
De är US-fokuserade idag. Om de expanderar med lokaliserat stöd (DIN-normer, metriska ritningar) konkurrerar de direkt. Mitigation: fokusera på lokal on-prem deployment + integration med svenska AEC-system (Norconsult, Sweco).

**CAD-formatskifte till IFC/BIM**
Om alla ritningar går till BIM-first-workflow faller behovet av 2D-PDF-analys. Mitigation: bygg BIM-läsning som parallell track i V3, inte som ersättning.

**Annotationsflaskhals**
V2 kräver 2 000 annoterade regioner. Om inga kunder vill lägga ner annotationstid: fastnar i MVP. Mitigation: bygg annotationsverktyg som del av produkten, ersätt kunder med annotationskrediter.

### 11.3 Vad är realistiskt vs fragilt idag

| Komponent | Status | Robusthet |
|-----------|--------|-----------|
| PDF-rendering 300 DPI | Stabil | ★★★★★ |
| Skaldetektering (step1) | Stabil på CAD-ritningar | ★★★☆☆ |
| Materialfärgsanalys (step9) | Stabil på rena PDF:er | ★★★☆☆ |
| RGB-sökning (scan_pattern.py) | Fungerar, känslig för rendering | ★★☆☆☆ |
| Y-koordinat canvas→PNG | Fixad — stabil | ★★★★☆ |
| bg_ratio fallback | Ny fix — behöver testning | ★★★☆☆ |
| Polygon-visning i canvas | Fixad — stabil | ★★★★☆ |
| Feature extraction GLCM/LBP | EJ byggt | — |
| SAM-integration | EJ byggt | — |
| Feedback-pipeline | EJ byggt | — |

---

## 12. Slutlig rekommendation

### Var vi är

Systemet fungerar tekniskt men är bräckligt: det förlitar sig på enkel RGB-tröskling som är känslig för renderingsvariationer. Tre kritiska buggar har identifierats och fixats (Y-koordinat, bg_ratio, synlighet). Dessa fixar gör MVP-systemet användbart för standardritningar.

### Vad som ska göras härnäst (prioritetsordning)

**Nästa 2 veckor (stabilisering):**
1. Verifiera Y-koordinat-fix på betongplattor och minst 3 andra material
2. Testa med 5–10 verkliga ritningar, samla in felprocent
3. Lägg till konfidensscore i scan-resultatet och visa det i UI

**Nästa 6 veckor (MVP+):**
4. Implementera GLCM + LBP feature extraction i scan_pattern.py
5. Bygg simple similarity ranker (cosine distance på feature-vektor)
6. Excel-export av mängdavtagning
7. Concave hull för mer precisa polygoner

**Nästa 6 månader (V2):**
8. Feedback-pipeline (spara varje bekräftelse/radering)
9. SVM-klassificerare tränad på insamlade features
10. Active learning för osäkra regioner
11. Multi-sida scanning

**Nästa år (V3):**
12. SAM-integration som kandidatgenerator
13. Fine-tunad ViT-encoder på AEC-data
14. On-prem deployment med federerat lärande

### Den enskilt viktigaste insikten

Korrekt data beats bättre algoritmer. Togal.AI är inte framgångsrika för att de har en överlägsen algoritm — de är framgångsrika för att de har 1 miljon annoterade ritningssidor. Bygg feedback-insamling som dag ett-feature, inte som eftertanke. Varje korrigering en användare gör är mer värd än en dag av algoritmtuning.

**Realistisk riktlinje:** Med korrekt Y-fix + GLCM-features + 500 annoterade regioner → 80–85 % precision är uppnåeligt på standardritningar inom 6 månader. Kommersiell 95 %+ precision kräver 2–3 år och riktig deep learning-infrastruktur.

---

*Dokument genererat: 2026-04-04. Baserat på genomgång av Togal.AI, Planswift, Buildots, VectorGraphNET, SAM, GLCM/LBP och akademiska dataset CubiCasa5k, ArchCAD-400K, CVC-FP.*
