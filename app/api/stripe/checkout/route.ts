import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@clerk/nextjs/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia",
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Ej inloggad" }, { status: 401 });
    }

    const priceId = process.env.STRIPE_PRICE_ID || "";
    if (!priceId) {
      return NextResponse.json({ error: "Inget pris konfigurerat" }, { status: 500 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/verktyg?prenumeration=aktiv`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout?avbruten=1`,
      metadata: { userId },
      payment_method_types: ["card"],
      locale: "sv",
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json({ error: "Internt fel" }, { status: 500 });
  }
}
