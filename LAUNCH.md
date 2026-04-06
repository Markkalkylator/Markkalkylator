# 🚀 Lanserings-guide — MarkKalkyl

## Vad som behöver göras (i ordning)

### 1. Installera beroenden
```bash
npm install @clerk/nextjs stripe @stripe/stripe-js
```

### 2. Skapa Clerk-konto (autentisering)
1. Gå till https://clerk.com och skapa ett gratiskonto
2. Skapa en ny app — välj "Email + Password" och gärna "Google"
3. Under **Customization → Text** — byt språk till Svenska om möjligt
4. Kopiera **Publishable Key** och **Secret Key**
5. Klistra in i `.env.local` (se `.env.local.example`)

### 3. Skapa Stripe-konto (betalning)
1. Gå till https://stripe.com/se och skapa konto
2. Under **Products** — skapa två produkter:
   - **MarkKalkyl Pro** → Recurring price → 399 kr/månad
   - **MarkKalkyl Team** → Recurring price → 999 kr/månad
3. Kopiera båda **Price ID**:na (börjar med `price_`)
4. Under **Developers → API keys** — kopiera **Secret key**
5. Under **Developers → Webhooks** → Add endpoint:
   - URL: `https://dindomän.se/api/stripe/webhook`
   - Events att lyssna på:
     - `checkout.session.completed`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
6. Kopiera **Webhook signing secret** (`whsec_...`)

### 4. Fyll i .env.local
```bash
cp .env.local.example .env.local
# Öppna .env.local och fyll i alla nycklar
```

### 5. Testa lokalt
```bash
npm run dev
# Besök http://localhost:3000
```

### 6. Driftsätt på Vercel (rekommenderat)
```bash
# Installera Vercel CLI om du inte har det
npm install -g vercel

# Deploya
vercel

# Lägg till env-variabler i Vercel-dashboarden
# Project Settings → Environment Variables → klistra in allt från .env.local
```

---

## Checklist före launch

- [ ] `.env.local` ifylld med riktiga nycklar
- [ ] Stripe-produkter skapade med korrekta priser
- [ ] Webhook konfigurerad och testad (`stripe listen --forward-to localhost:3000/api/stripe/webhook`)
- [ ] Testbetalning genomförd i Stripe testläge
- [ ] Domän köpt och konfigurerad (t.ex. markkalkylator.se)
- [ ] `NEXT_PUBLIC_BASE_URL` uppdaterad till riktig domän
- [ ] Driftsatt på Vercel

---

## Prisstrategi (rekommendation)

| Plan   | Pris      | Målgrupp                        |
|--------|-----------|----------------------------------|
| Gratis | 0 kr      | Testa, 3 projekt max             |
| Pro    | 399 kr/mån | Enskild entrepreneur, obegränsat |
| Team   | 999 kr/mån | Lag upp till 5 pers             |

**14 dagars gratis test** på Pro och Team — ingen kortuppgift krävs under trial.

---

## Hur du får första kunderna

1. **Ring direkt** — ta fram 10 mark & anläggning-företag i din stad och ring dem. Erbjud 30 dagars gratis test mot en 15-minuters demo.
2. **LinkedIn** — sök "kalkylator mark anläggning", "anläggningschef" och skicka personliga meddelanden.
3. **Byggföretagen** — kontakta branschorganisationen och fråga om deras nyhetsbrev.
4. **Google Ads** — målrikta "mängdberäkning mark", "kalkylprogram anläggning" — budgetera 100–200 kr/dag.
5. **Facebook-grupper** — det finns aktiva grupper för svenska hantverkare och entreprenörer.

---

## Teknisk arkitektur

```
/ (landningssida)
/verktyg (skyddat av Clerk — kräver inloggning)
/logga-in (Clerk SignIn-komponent)
/registrera (Clerk SignUp-komponent)
/checkout (Stripe Checkout-session)
/api/stripe/checkout (skapar Stripe-session)
/api/stripe/webhook (hanterar Stripe-events)
```
