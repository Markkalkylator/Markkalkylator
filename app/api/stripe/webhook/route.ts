import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia",
});

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get("stripe-signature") || "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Webhook-fel:", err);
    return NextResponse.json({ error: "Ogiltig signatur" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.CheckoutSession;
      const { userId, plan } = session.metadata || {};
      console.log(`✅ Ny prenumeration: userId=${userId} plan=${plan}`);
      // TODO: Uppdatera din databas: sätt user.plan = plan, user.subscriptionId = session.subscription
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;
      console.log(`❌ Prenumeration avslutad: userId=${userId}`);
      // TODO: Nedgradera till gratisplan i din databas
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`⚠️ Betalning misslyckades: ${invoice.customer_email}`);
      // TODO: Skicka påminnelsemail via Resend/Postmark
      break;
    }
  }

  return NextResponse.json({ received: true });
}
