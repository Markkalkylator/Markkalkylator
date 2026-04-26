# AI-arkitektur för ritningsavläsning
## Systemdesign för kommersiell mängdning av mark- och anläggningsritningar

**Dokumenttyp:** Produktstrategi & teknisk arkitektur
**Datum:** 2026-04-03
**Konfidentialitet:** Intern

---

## 1. Executive Summary

Den korta sanningen: **ren LLM-vision räcker inte för precis mängdning av ritningar.** Generella vision-modeller (GPT-4V, Gemini, Claude Vision) kan klassificera material och läsa legend med rimlig träffsäkerhet, men kan inte extrahera geometrisk-precisa polygoner för mätning. De samplar ner bilder, hallucinerar kanter och har ingen förståelse för skalrelationer.

Det bästa kommersiella systemet för ert ändamål är en **hybrid i tre lager:**

1. **Vektorextraktion** – för PDF:er med CAD-ursprung (majoriteten av era ritningar)
2. **Rasteranalys + segmentering** – för skannade ritningar och det vektorn missar
3. **VLM-klassificering** – för att förstå VAD ett objekt är, inte var det är

Togal.AI, Autodesk Takeoff och liknande program är alla hybrider i denna anda. Ingen av dem förlitar sig på ett enda modellparadigm.

**Vad som ger värde snabbast:** Vektorextraktion ur PDF + enkel VLM-legend-läsning + human review. Det kan leverera 70–80% tidsbesparning för en stor andel ritningar redan i MVP.

**Vad som kräver tid:** Robust hatch-klassificering, träning på egna data, aktiv inlärning. Det är 12–24 månaders arbete att göra rätt.

---

## 2. Research och Benchmark-lärdomar

### 2.1 Vad vi VET om kommersiella program

**Togal.AI** (mest avancerade fritt dokumenterade systemet inom detta segment):
- Använder djupinlärning tränad specifikt på byggritningar (floor plans)
- Renderar PDF i hög upplösning (minst 300 DPI) och kör semantisk segmentering
- Separata modeller för rum/zoner vs. symboler vs. text
- Human-in-the-loop är en central del av produkten, inte en eftertanke
- Kräver eget märkt träningsdata per domän
- Stöder ännu inte markritningar med full precision (deras styrka är floor plans)

**Autodesk Takeoff** (del av Autodesk Construction Cloud):
- Använder ML för "automated count" och "automated area" på 2D ritningar
- Baseras delvis på Autodesk-internt tränad detektion + vektoranalys av AutoCAD-ursprung
- Kräver att ritningen är korrekt georefererad eller skalad
- Inte öppen om exakt arkitektur, men hanterar vektor + raster

**Bluebeam Revu**:
- Ingen verklig AI-detektion
- Utmärkt manuell verktygslåda med hatch-matching (visuell jämförelse av mönster)
- Referenspunkt: visar att semi-automatisering med visuell matchning ger stort värde utan fullständig AI

**PlanSwift / Trimble Estimating**:
- Baserat på mönsterigenkänning (template matching) + manuell avgränsning
- Relativt primitiv AI men välbeprövad i praktiken

**STACK / Procore Takeoff**:
- Klickbaserat med AI-stöd för liknande objekt ("paint bucket"-logik)
- Använder färg/tonanalys för att föreslå fyllning av intilliggande liknande ytor

### 2.2 Vad vi INFERERAR om hur de fungerar

- Alla seriösa system renderar ritningar till minst 300 DPI internt, oavsett om indata är vektor
- Legendigenkänning verkar vara det svagaste ledet i alla system – de flesta kräver manuell bekräftelse av kategorier
- Hatch-klassificering sker troligtvis som tile-baserad CNN-klassificering (50×50 eller 100×100 pixelpatchar)
- Konfidensscore används internt men visas sällan tydligt för användaren

### 2.3 Vad som är OSÄKERT

- Hur väl kommersiella system hanterar just **markritningar** (mark, vegetation, vattenhantering) kontra floor plans och byggritningar – detta är ett underutforskat segment
- Om något befintligt system hanterar **legend → hatch → area-kopplingen** helautomatiskt med hög träffsäkerhet för svenska ritningskonventioner
- Exakta träningsdata och modellarkitekturer är affärshemligheter

### 2.4 Akademisk forskning av relevans

- **LayoutParser** (2021): Open-source ramverk för dokumentlayoutanalys – relevant för legend-detektion
- **DocBank / FUNSD datasets**: Layoutförståelse i dokument – användbar för att förstå strukturer
- **Raster-to-Vector** (Liu et al.): Konvertering av skannade CAD-ritningar till vektorer
- **SAM (Segment Anything Model, Meta 2023)**: Kan segmentera godtyckliga regioner om man ger rätt prompts – lovande för raster-analys
- **PaddleOCR**: Bäst-i-klass för teknisk dokumentOCR, inklusive roterad text
- **YOLO v8/v10**: Snabb objektdetektion, lämplig för symboligenkänning i ritningar

---

## 3. Rekommenderad Systemarkitektur

### STEG 1 – Input Preprocessing

**Syfte:** Förstå vad vi har att göra med och normalisera indata.

**Input:** PDF-fil (1 eller flera sidor)

**Output:**
- Dokumenttyp: `vector_pdf | raster_pdf | hybrid_pdf`
- Sida(or) renderade till PNG vid 300 DPI
- Metadata: sidstorlek, skalangivelse om hittad, sidnummer

**Rekommenderad teknik:**
- `pdfminer.six` eller `pypdf` för att analysera PDF-strukturen
- Avgör om sidan innehåller vektorgrafik (söker efter path/fill-objekt) eller bara rasterbilder
- `pdf2image` (Poppler) för rendering vid 300 DPI

**Varför:** Strategin för resten av pipelinen skiljer sig fundamentalt mellan vektor- och raster-PDF. Att blanda ihop dem är den vanligaste arkitekturmisstaget.

**Möjliga fel:**
- PDF kan vara skyddad/krypterad → behöver felhantering
- En PDF-sida kan innehålla BÅDE vektor (ramverk) och raster (inscannat underlag)
- Stor A0-ritning vid 300 DPI = potentiellt 30 000 × 42 000 pixlar → minnesbegränsningar

---

### STEG 2 – PDF/CAD Vektorextraktion

**Syfte:** Extrahera geometri direkt ur PDF utan vision – detta är den mest precisa metoden för CAD-exporterade ritningar.

**Input:** Vector-PDF

**Output:**
```json
{
  "paths": [
    {
      "id": "path_001",
      "type": "closed_polygon",
      "points": [[x1,y1], [x2,y2], ...],
      "fill_color": "#D4A853",
      "stroke_color": "#000000",
      "stroke_width": 0.5,
      "has_hatch": false,
      "area_px2": 14500.3,
      "bounding_box": [x, y, w, h]
    }
  ],
  "lines": [...],
  "text_objects": [...]
}
```

**Rekommenderad teknik:**
- `pdfminer.six` med LTFigure/LTRect/LTCurve-parsning
- Alternativt: `PyMuPDF (fitz)` – snabbare och enklare API
- `shapely` för polygonoperationer (union, intersection, area)

**Varför:** En korrekt CAD-exporterad PDF innehåller exakta koordinater för varje objekt. Vektorextraktion ger sub-millimeter precision utan att behöva segmenteringsmodeller. Det är grunden i alla seriösa system.

**Möjliga fel:**
- CAD-hatch är ibland exporterat som tusentals korta linjer, inte som ett ifyllt objekt – kräver linjeanalys
- Delade kanter (en linje som tillhör två ytor) är inte alltid dubbla i PDF
- Öppna polygoner (ej slutna banor) kräver geometrisk reparation
- Koordinatsystemet i PDF är "nedifyllda" (origo nere till vänster, y uppåt) – konvertera korrekt

---

### STEG 3 – Legenddetektion

**Syfte:** Hitta legendrutan i ritningen och extrahera materialdefinitioner.

**Input:** Renderad PNG (300 DPI) + vektorobjekt från steg 2

**Output:**
```json
{
  "legend_region": {"x": 2100, "y": 150, "w": 600, "h": 900},
  "legend_items": [
    {
      "id": "leg_01",
      "visual_patch_base64": "...",
      "fill_color": "#D4A853",
      "hatch_pattern": "diagonal_dense",
      "label_raw": "Betongplattor 60x60",
      "label_normalized": "betongplatta",
      "confidence": 0.91
    }
  ]
}
```

**Rekommenderad teknik:**
- **Regel 1:** Letar i nedre höger (75–100% x, 0–30% y) och höger kant av ritningen
- YOLO v8 fin-tränad på legends i byggritter för att detektera legendrutan
- Alternativt: Heuristisk sökning – hitta rektangelstruktur med upprepade visuella mönster + text bredvid
- VLM (Claude/GPT-4V) för att läsa legenden som helhet – bra på att förstå tabellstruktur
- PaddleOCR för textextraktion ur varje legendrad

**Varför:** Legenden är semantikens källa. Utan korrekt legendtolkning kan systemet inte koppla hatch till material.

**Möjliga fel:**
- Ingen legend finns (fria ritningar) → användaren måste mappa manuellt
- Legenden är utanför A-bilagan / på ett separat blad
- Legendtext är på flera rader eller innehåller teknisk nomenklatur
- Visuell patch i legenden är för liten för tillförlitlig hatch-klassificering (< 30×30 px)

**OSÄKERT:** Hur väl en generell VLM hanterar komplexa svenska legendformat utan specialträning. Troligtvis 70–80% träffsäkerhet utan fine-tuning.

---

### STEG 4 – OCR och Textanalys

**Syfte:** Extrahera ALL text ur ritningen – etiketter, siffror, material­beteckningar, skalangivelse.

**Input:** Renderad PNG + vektortext från steg 2

**Output:**
```json
{
  "text_regions": [
    {
      "id": "txt_001",
      "text": "Asfalt 90mm",
      "bbox": [x, y, w, h],
      "confidence": 0.97,
      "rotation_deg": 0,
      "font_size_approx": 8,
      "type": "area_label | dimension | title | legend_entry | other"
    }
  ],
  "scale_bar": {"found": true, "px_per_meter": 42.3},
  "north_arrow": {"found": true, "angle_deg": 12}
}
```

**Rekommenderad teknik:**
- **PaddleOCR** (bäst för tekniska dokument, hanterar roterad text)
- Alternativt: Tesseract med anpassad layout-analys
- Skalangivelse: regex-sökning efter "1:XXX" mönster + textposition
- För vektortext: direkt utdrag via pdfminer (exakt position och font)

**Varför:** Text innehåller ofta direkt materialinformation ("Betongplatta typ B") och är den enklaste semantiska signalen. Felad text propagerar till alla senare steg.

**Möjliga fel:**
- Roterad text (kantsten längs kurvor) är svår för OCR
- Liten text i DWG-format (< 6pt) läses inte av alla OCR-modeller
- Överlappande text och grafik
- Skalangivelse inte alltid explicit ("Se A-ritning")

---

### STEG 5 – Hatch/Mönster-klassificering

**Syfte:** Klassificera varje yta/region baserat på dess visuella mönster och koppla till legend.

**Input:**
- Bildpatchar ur renderad PNG (en patch per detekterad region)
- Legenddefinitioner från steg 3

**Output:**
```json
{
  "region_id": "path_001",
  "hatch_embedding": [0.23, -0.87, 0.41, ...],
  "top_matches": [
    {"legend_id": "leg_02", "similarity": 0.94, "method": "embedding"},
    {"legend_id": "leg_05", "similarity": 0.71, "method": "embedding"}
  ],
  "fill_color_match": {"legend_id": "leg_02", "color_distance": 8.3},
  "final_classification": "leg_02",
  "confidence": 0.89
}
```

**Rekommenderad teknik:**
- **Embedding-baserad likhetssökning**: Kör bildpatchar och legendpatchar genom en CNN-encoder (EfficientNet-lite eller ResNet-18), jämför embedding-distans
- **Färgmatchning**: Enkel men effektiv – många CAD-ritningar använder konsekvent färgkodning
- **Template matching** (OpenCV): Fungerar för standardiserade ISO-hatch-mönster, inte för custom
- Kombinera: `confidence = 0.6 * embedding_similarity + 0.3 * color_match + 0.1 * spatial_context`

**Varför:** Hatch-klassificering är det tekniskt svåraste steget. Mönster som "fin diagonal" vs. "grov diagonal" kan vara olika material men ser lika ut i liten skala. Embedding-baserad matchning mot just legendens mönster (inte en generell hatch-databas) är den rätta ansatsen.

**Möjliga fel:**
- Hatch-täthet varierar med upplösning (zoom) → normaliseringsproblem
- Överlappande ytor med olika hatch
- Inga hatch alls – bara färg eller text
- Liknade hatch-mönster för olika material (t.ex. smågatsten vs. kullersten)

---

### STEG 6 – Rasteranalys och Segmentering (för icke-vektor)

**Syfte:** För skannade ritningar eller det vektorextraktion missar – hitta regioner via bildsegmentering.

**Input:** PNG (300 DPI) i zoner (max 2000×2000 px per zone för minneshantering)

**Output:** Binära maskar per kandidatyyta

**Rekommenderad teknik:**
- **SAM 2 (Segment Anything Model 2, Meta 2024)**: State-of-the-art för general region proposal, fungerar med automatisk prompt-generation
- **Alternativ 1**: Watershed-algoritm + contour-finding (klassisk CV, snabb men kräver tuning)
- **Alternativ 2**: Fine-tunad U-Net tränad på markritningar
- **Post-processing**: `shapely` + Douglas-Peucker för polygon-förenkling

**Varför:** Skannade ritningar kräver vision-baserad segmentering. SAM 2 är för tillfället det bästa generella valet utan att behöva träna egna modeller.

**Möjliga fel:**
- Skannade ritningar har artefakter (viklinjer, smuts, låg kontrast)
- SAM kan slå ihop ytor som ska vara separata
- Polygoner från segmentering är aldrig CAD-precisa – alltid pixelprecision ±2–5 px

---

### STEG 7 – Kandidatgenerering och Merge

**Syfte:** Sammanfoga vektor- och raster-detektioner till ett konsistent kandidatset.

**Input:**
- Vektorpolygoner (steg 2)
- Raster-maskar (steg 6)
- Klassificeringar (steg 5)

**Output:**
```json
{
  "candidates": [
    {
      "id": "cand_001",
      "source": "vector | raster | merged",
      "geometry": {"type": "Polygon", "coordinates": [[...]]},
      "material_id": "leg_02",
      "material_label": "Betongplatta 60x60",
      "area_m2": 234.7,
      "length_m": null,
      "object_type": "area | line",
      "confidence": 0.87,
      "flags": ["overlaps_cand_002", "near_legend"]
    }
  ]
}
```

**Rekommenderad teknik:**
- IoU-baserad (Intersection over Union) deduplicering mellan vektor och raster
- Vektorpoly har prioritet om IoU > 0.7
- `shapely` för alla geometrioperationer
- Triangulated Irregular Network (TIN) för komplexa ytunioner

**Varför:** Man vill ha ett enda konsistent lager av kandidater att visa för användaren, inte separata vektor- och rasterlager.

**Möjliga fel:**
- Vektor och raster pekar på samma yta men med offset → behöver alignment
- Kandidater skapas av legend-regionen (false positive)

---

### STEG 8 – Geometrirefinement

**Syfte:** Förbättra polygonprecision, räta ut kurvor, hantera delade kanter.

**Input:** Kandidatpolygoner

**Output:** Förfinade polygoner

**Rekommenderad teknik:**
- **Douglas-Peucker simplifiering** (reducera antal noder utan att förlora form)
- **Snap-to-edge**: Snappa noder till detekterade linjer i ritningen
- **Topologivalidering**: Säkerställ inga självskärningar, inga hål

**Varför:** Råa segmenteringspolygoner har ofta "brus" i kanterna. Geometrirefinement är nödvändigt för professionella mätresultat.

**Möjliga fel:**
- Förenkling tar bort viktig geometri (t.ex. en smal korridor)
- Snap kan föra en nod till fel linje

---

### STEG 9 – Konfidensscore och Prioritering

**Syfte:** Rangordna kandidater efter trovärdighet för att styra human review.

**Input:** Alla kandidater med metadata

**Output:** Sorterad lista med explicita osäkerhetsmarkeringar

**Beräkning av konfidens:**
```
confidence_final =
  0.30 * hatch_similarity_score
  + 0.25 * color_match_score
  + 0.20 * text_proximity_score    (finns materialtext nära?)
  + 0.15 * geometry_quality_score  (är polygonen väldefinierad?)
  + 0.10 * legend_match_uniqueness (är matchningen entydig?)
```

**Flaggor som sänker konfidens:**
- `no_legend_match` → konfidenstak 0.40
- `ambiguous_hatch` (top-2 matcher < 0.15 i differens) → flaggas
- `near_border` (polygon tangerar ritningskant) → granskas extra
- `very_small_area` (< 1 m²) → troligtvis artefakt

**Varför:** Utan explicit osäkerhetshantering presenterar systemet gissningar som fakta. Det är farligare än att visa ingenting.

---

### STEG 10 – Human-in-the-Loop Granskning

(Se sektion 6 för detaljerat gränssnittsflöde)

**Syfte:** Låta användaren validera, rätta och komplettera AI:ens förslag.

**Input:** Sorterade kandidater

**Output:** Godkända, rättade eller borttagna kandidater + correction log

---

### STEG 11 – Inlärning från Rättelser

(Se sektion 6 för strategidetaljer)

**Syfte:** Förbättra systemet över tid baserat på användarens korrektioner.

**Input:** Correction log

**Output:** Uppdaterade konfidensparametrar, trimmade data för retraining

---

## 4. Byggplan för Programmet

### MVP (3–4 månader)
**Vad som byggs:**
- PDF-parser som avgör vektor vs. raster
- Vektorextraktion ur CAD-PDF (steg 2)
- VLM-baserad legendläsning (Claude API eller GPT-4V) – enkel prompt, ingen träning
- Grundläggande OCR för text och skala
- Presentera extraherade polygoner i gränssnittet med föreslagen kategori
- Human review-gränssnitt: bekräfta/ändra kategori per polygon
- Loggning av alla rättelser

**Vad som väntar:**
- Hatch-klassificering (ersätts av färg + VLM-klassificering i MVP)
- Rasteranalys
- Inlärning

**Värde:** För en stor andel moderna CAD-exporterade ritningar (estimerat 60–70% av arbetsflödet) ger detta 60–80% tidsbesparning direkt.

---

### Version 2 (6–9 månader från start)
**Vad som byggs:**
- Embedding-baserad hatch-klassificering mot legendpatchar (steg 5)
- SAM 2-integration för skannade ritningar
- Tile-baserad analys av stora ritningar (minnessäker)
- Bättre kandidatmerge (steg 7)
- Konfidensscore visas i gränssnittet
- Correction log används för att justera konfidensparametrar

**Värde:** Utökar täckning till skannade ritningar, förbättrar precision för hatch-rika ritningar.

---

### Version 3 (12–18 månader)
**Vad som byggs:**
- Fine-tunad klassificeringsmodell tränad på insamlade data (feedback + manuellt märkt data)
- Aktiv inlärning: systemet identifierar vilka exempel det behöver human label för
- Per-projekt kalibrering: systemet lär sig specifika konventioner per konsult/ritningshus
- Geometrirefinement med snap-to-edge
- Exportformat till mängdprogram (Excel, IFC, BCF)

**Värde:** Systemet börjar verkligen lära sig och förbättras. Täckning > 85% för välkända ritningstyper.

---

### Kommersiell Robust Version (24+ månader)
**Vad som byggs:**
- Fullt tränad domänspecifik modell för markritningar
- Automatisk hantering av ritningar utan legend
- Multipage-analys (koppla legend på A-blad till ritning på B-blad)
- Versionsjämförelse (hitta ändringar mellan revideringar)
- API för integration med CAD-program

**Krav:** Egna märkta data (minst 500–1 000 ritningar), ML-infrastruktur (GPU-träning, modellversioning)

---

## 5. Dataformat

### 5.1 Legend Item

```json
{
  "id": "leg_01",
  "project_id": "proj_abc",
  "drawing_id": "drw_001",
  "visual_patch_base64": "<base64-encoded PNG, 100x100px>",
  "fill_color_hex": "#D4A853",
  "stroke_color_hex": "#333333",
  "hatch_type": "diagonal_45deg | crosshatch | dots | solid | none",
  "hatch_density": "dense | medium | sparse",
  "hatch_embedding": [0.23, -0.87, 0.41],
  "label_raw": "Betongplattor 60x60 grå",
  "label_normalized": "betongplatta",
  "material_category": "hardscape | softscape | drainage | edging | other",
  "object_type": "area | line | symbol",
  "unit": "m2 | m | st",
  "source": "auto_extracted | user_confirmed | user_created",
  "confidence": 0.91,
  "created_at": "2026-04-03T10:00:00Z"
}
```

### 5.2 Detected Object

```json
{
  "id": "obj_001",
  "drawing_id": "drw_001",
  "legend_id": "leg_01",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[100.5, 200.3], [150.2, 200.3], [150.2, 280.1], [100.5, 280.1], [100.5, 200.3]]],
    "coordinate_system": "pdf_points",
    "scale_factor": 42.3
  },
  "area_m2": 14.72,
  "length_m": null,
  "object_type": "area",
  "material_label": "Betongplatta 60x60",
  "source": "vector_extraction | raster_segmentation | user_drawn",
  "confidence": {
    "total": 0.87,
    "hatch_match": 0.92,
    "color_match": 0.88,
    "text_proximity": 0.75,
    "geometry_quality": 0.95
  },
  "flags": [],
  "status": "candidate | confirmed | rejected | corrected",
  "created_at": "2026-04-03T10:00:00Z",
  "confirmed_at": null
}
```

### 5.3 Line Object

```json
{
  "id": "line_001",
  "drawing_id": "drw_001",
  "legend_id": "leg_07",
  "geometry": {
    "type": "LineString",
    "coordinates": [[x1,y1], [x2,y2], [x3,y3]],
    "coordinate_system": "pdf_points"
  },
  "length_m": 34.5,
  "object_type": "line",
  "material_label": "Kantsten granit 100x300",
  "line_style": "solid | dashed | dotted",
  "stroke_width_pt": 1.5,
  "source": "vector_extraction",
  "confidence": {"total": 0.82, "geometry_quality": 0.95},
  "status": "confirmed"
}
```

### 5.4 User Correction

```json
{
  "id": "corr_001",
  "session_id": "sess_xyz",
  "user_id": "usr_001",
  "project_id": "proj_abc",
  "drawing_id": "drw_001",
  "object_id": "obj_001",
  "correction_type": "category_change | geometry_edit | delete | add | split | merge",
  "before": {
    "legend_id": "leg_02",
    "material_label": "Asfalt",
    "geometry_wkt": "POLYGON(...)"
  },
  "after": {
    "legend_id": "leg_01",
    "material_label": "Betongplatta 60x60",
    "geometry_wkt": "POLYGON(...)"
  },
  "correction_confidence": 1.0,
  "user_comment": "Systemet missade att detta är betong, inte asfalt",
  "time_spent_sec": 8,
  "created_at": "2026-04-03T10:05:00Z"
}
```

### 5.5 Learning Log Entry

```json
{
  "id": "learn_001",
  "correction_id": "corr_001",
  "learning_type": "confidence_adjustment | retrain_candidate | false_positive | false_negative",
  "feature_context": {
    "hatch_embedding_before": [0.23, -0.87, 0.41],
    "hatch_embedding_after_lookup": [0.31, -0.79, 0.38],
    "correct_legend_id": "leg_01",
    "incorrect_legend_id": "leg_02",
    "similarity_gap": 0.08
  },
  "adjustment": {
    "type": "confidence_penalty",
    "target_pair": ["leg_01", "leg_02"],
    "delta": -0.12
  },
  "flagged_for_retraining": true,
  "retrain_batch_id": null,
  "created_at": "2026-04-03T10:05:01Z"
}
```

---

## 6. Human-in-the-Loop och Inlärning

### 6.1 Live AI-flöde i Gränssnittet

**Fas 1 – Legendläsning (3–8 sek)**
```
[Spinner] "Läser teckenförklaring..."
→ Legendrutan markeras med gul overlay
→ Extraherade kategorier visas i vänsterpanel med färg/mönster-preview
→ "Stämmer dessa kategorier?" [Bekräfta / Redigera]
```

**Fas 2 – Kategoribekräftelse**
```
Vänsterpanel visar:
  □ [◼ grå] Betongplatta 60x60        konfidensindikator: ●●●○○
  □ [/ / /] Asfalt 90mm               konfidensindikator: ●●●●○
  □ [≋≋≋] Gräsyta                     konfidensindikator: ●●●●●
  □ [― ―] Kantsten granit             konfidensindikator: ●●●○○
  + Lägg till kategori manuellt

Användaren kan:
  - Kryssa ur kategorier som ska ignoreras
  - Redigera materialnamn
  - Dra-och-släppa legend-patch om AI missade
```

**Fas 3 – Mängdning live på ritningen**
```
[Knapp] "Starta mängdning" →
  - AI processar sektion för sektion (progressbar)
  - Varje bekräftad kandidat visas direkt som färgad polygon overlay
  - Kandidater med låg konfidens visas med streckad kant
  - Höger-undre hörn: löpande total per material
```

**Fas 4 – Granskning och Rättning**
```
Klick på polygon:
  - Sidopanel visar: material, yta i m², konfidens, "Varför valde AI:n detta?"
  - Knappar: [Bekräfta] [Ändra kategori] [Redigera form] [Ta bort]

Filter-panel (för effektiv genomgång):
  [Visa bara osäkra (konf < 0.7)]
  [Visa en kategori i taget]
  [Sortera efter area]
```

**Fas 5 – Missa-kompenserare**
```
[Knapp] "Rita manuell yta" → Polygon-ritverktyg som idag
  - Välj kategori i dropdown
  - Rita polygon
  - Loggas som user_drawn + adderas till mängdlistan
```

### 6.2 Transparens – "Varför valde AI:n detta?"

Varje polygons inforuta ska visa:
- Hatch-matchning: `"Liknar legend 'Betongplatta' till 92%"`
- Färgmatchning: `"Färg stämmer med legend till 88%"`
- Textnärmhet: `"Texten 'Betongytor' är 8cm från centrum"`
- Flaggor: `"⚠ Gränsroten mot angränsande yta är oklar"`

### 6.3 Inlärningsstrategi

**Vad vi INTE ska göra: Online Learning**
Uppdatera modellvikter i realtid baserat på varje korrektion. Det skapar instabilitet och är omöjligt att debugga i produktion.

**Vad vi SKA göra (i tre lager):**

**Lager 1 – Konfidensanpassning (immediate, ingen retraining):**
- Varje korrektionspar `(felaktig_kategori → rätt_kategori)` justerar konfidensparameter lokalt
- `conf_penalty[leg_02 → leg_01] += 0.05` per korrektion
- Resulterar i att systemet blir mer försiktigt med just detta förväxlingspar
- Implementeras som en JSON-fil per projekt eller användare

**Lager 2 – Feedback Logging (dagligen/veckovis):**
- Alla korrektioner samlas i databasen
- Aggregeras per ritningshus, per materialtyp, per korrektionstyp
- Används för att identifiera systematiska fel (t.ex. "Asfalt" missklassificeras som "Grus" i 40% av fall → flaggas för retraining)

**Lager 3 – Supervised Retraining (månadsvis eller vid tillräckligt data):**
- Korrigerade polygoner (before + after) exporteras som träningsdata
- Fine-tuning av klassificeringsmodellen på insamlad data
- Modellversioning: `v1.2.3_20260601` – rollback möjlig
- Kräver: minst 200–500 korrigerade exempel per materialtyp för meningsfull förbättring

**Aktiv inlärning (V3+):**
- Systemet identifierar egna osäkra fall och ber specifikt om feedback
- `"Vi är osäkra på dessa 5 ytor – kan du granska dem?"` istället för att gissa

---

## 7. Risker och Fallgropar

### R1 – AI:n Gissar med Hög Konfidens

**Problem:** Systemet presenterar en felaktig klassificering med 0.90 i konfidens. Användaren litar på det. Mängdningen blir fel. Kostnadskonsekvenser i byggprojekt.

**Lösning:**
- Aldrig rapportera > 0.85 konfidens för en okänd kombinationstyp (ny ritningshus, ny material)
- Obligatorisk mänsklig granskning för alla ytor > 500 m² oavsett konfidens
- "Granskat av användare" måste vara ett explicit steg, inte ett opt-out

---

### R2 – Legendmisstolkning

**Problem:** AI:n identifierar en förklaring-ram som legend men tolkar felangivelser som kategorier. Eller legenden saknas och systemet hittar på kategorier.

**Lösning:**
- Alltid visa extraherad legend till användaren för bekräftelse INNAN mängdning startar
- Om ingen legend hittas: visa tydlig varning och be användaren definiera kategorier manuellt
- Legenden är GATE – ingen mängdning startar utan godkänd legend

---

### R3 – Förväxling av Liknande Hatch

**Problem:** "Fin diagonal" för asfalt ser nästan likadan ut som "fin diagonal" för packad grus i skalade ritningar. Systemet kan inte skilja dem åt utan lexikal hjälp.

**Lösning:**
- Kör alltid textanalys parallellt med hatch-analys (steg 4)
- Om hatch-matchning är ambiguös (top-2 differens < 0.15): degradera till manuell bekräftelse
- Spara embedding-konflikt i learning log → potentiellt träningsfall

---

### R4 – Ritningsvariationer Mellan Projekt

**Problem:** Varje konsult har egna konventioner. Prickig hatch betyder "gräs" hos konsult A och "grus" hos konsult B. En modell tränad på konsult A:s ritningar presterar dåligt på konsult B.

**Lösning:**
- Alltid matcha hatch mot PROJEKTETS legend, inte en global hatch-databas
- Per-projekt kalibrering: lagra korrektioner per project_id
- Erbjud möjlighet att "importera legendprofil" från ett tidigare projekt

---

### R5 – För Låg Upplösning i Analys

**Problem:** Ritning renderas vid 72 DPI (standard screen), hatch-detaljer försvinner, OCR missar liten text. Systemet fattar beslut baserat på otillräcklig information.

**Lösning:**
- Minimum 300 DPI för hatch-analys
- 150 DPI räcker för grov segmentering
- For A0-ritningar: tile-baserad analys (max 3000×3000 px per tile) med 30% overlap
- Explicitera krav i UI: "Din ritning analyseras vid 300 DPI, detta kräver ca X sekunder"

---

### R6 – Polygoner Blir Instabila vid Redigering

**Problem:** När användaren redigerar en nod i en AI-genererad polygon kraschar grannytan. Delade kanter hanteras inte korrekt. Topologifel uppstår.

**Lösning:**
- Implementera topologimedveten geometrimotor (shapely + validering)
- Delade kanter lagras explicit i datamodellen
- Vid edit av en nod: alla polygoner som delar den noden uppdateras
- Snap-to-grid eller snap-to-edge som default (konfigurerbart)

---

### R7 – Text och Grafik Överlappar

**Problem:** En arealabel sitter mitt i en yta och OCR plockar upp den som en separat region. Eller hatchen under en text skapar visuellt brus som förvirrar klassificeraren.

**Lösning:**
- Text-maskning: identifiera alla textobjekt (steg 4), maskera dem INNAN hatch-klassificering
- Kör hatch-klassificering på textfria bildpatchar
- Textregioner tas bort från kandidatgenereringen

---

### R8 – Skalfel

**Problem:** Ritningen saknar korrekt skalangivelse eller den läses fel. Alla area-beräkningar blir systematiskt fel (t.ex. 10x för liten eller stor).

**Lösning:**
- Alltid visa beräknad skala för användarbekräftelse: `"Hittad skala: 1:500 – stämmer detta?"`
- Skalangivelse hittas via: OCR (texten "1:500"), skalfält i ritningsstämpel, mätlinje med känd längd
- Om ingen skala hittas: blockera mängdning och kräv manuell kalibrering (er nuvarande kalibreringsfunktion)
- Varna vid ovanliga skalor (t.ex. 1:3467 – troligtvis fel)

---

## 8. Slutlig Rekommendation

### Bygg i denna exakta ordning. Hoppa inte över steg.

**Steg 1 (bygg nu):** PDF-parser med vektor/raster-klassificering. Investera 2–3 veckor för att få vektorextraktion att fungera korrekt. Det ger er omedelbar nytta för CAD-PDF och är grunden till allt annat.

**Steg 2 (bygg näst):** Legendigenkänning via VLM (Claude API eller GPT-4V). Använd en välstrukturerad prompt som ber modellen extrahera legendraden som JSON. Visa alltid resultatet för användarbekräftelse. Kosta 1–2 veckor.

**Steg 3 (bygg sedan):** Presentera extraherade polygoner i er befintliga ritningsvy. Lägg till status-kolumner (confirmed/candidate/rejected) och en grundläggande review-vy. Human review är er viktigaste säkerhetsmekanism.

**Steg 4 (bygg när V1 är stabil):** Hatch-klassificering via embedding-matchning mot legendpatchar. Detta kräver mer experiment och felhantering, men är avgörande för ritningar med komplex hatch.

**Steg 5 (bygg med data):** Raster-segmentering via SAM 2 för skannade ritningar. Lägg till detta när ni har volym och tid att validera det.

**Steg 6 (bygg med feedback):** Inlärningslager 1 (konfidensanpassning) implementeras direkt. Lager 2 (feedback logging) implementeras från dag 1. Lager 3 (retraining) implementeras när ni har > 200 korrigerade exempel per materialtyp.

### Arkitekturvalet

**Rekommendation: CAD-vektoranalys + VLM-klassificering + embedding-hatch-matching**

Ren vision-modell: Nej. Precisionen räcker inte för kommersiell mängdning.
Ren OCR + vision: Nej som enda approach, men OCR är nödvändig komponent.
Ren CAD-vektoranalys: Räcker för 60–70% av ritningar, otillräcklig som enda metod.
**Hybrid:** Ja. Vektor som grund, vision för det som saknas, VLM för semantik.

### Det viktigaste du kan göra idag

Skaffa 20–30 representativa ritningar från verkliga projekt. Analysera dem manuellt:
- Hur många är vektor-PDF vs. raster?
- Hur är legenderna strukturerade?
- Vilka hatch-mönster används?
- Vilka materialtyper förekommer?

Den analysen kommer styra 80% av arkitekturbesluten för er specifika domän.

---

*Dokumentet ska uppdateras när teknisk implementation startar och när verkliga ritningar analyserats.*
