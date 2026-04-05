import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Skyddade rutter — kräver inloggning
const isProtectedRoute = createRouteMatcher([
  "/verktyg(.*)",
  "/checkout(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Kör middleware på alla rutter utom statiska filer och Next.js-internals
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
