import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Supabase's standard domain rewrites HTML GET responses to text/plain.
// This function therefore redirects browser navigation to the static Vercel host.
// Supabase remains the API/database host; Vercel serves the actual web documents.
const SITE_ORIGIN = "https://server-onboarding-ochre.vercel.app";

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "content-type, apikey, authorization",
        "cache-control": "no-store",
      },
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "allow": "GET, HEAD, OPTIONS", "content-type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const view = url.searchParams.get("view");

  let destination = SITE_ORIGIN + "/";
  if (token) {
    // Keep the single-use guest token in the fragment so it is not sent in HTTP logs.
    destination = SITE_ORIGIN + "/guest.html#token=" + encodeURIComponent(token);
  } else if (view === "terms") {
    destination = SITE_ORIGIN + "/terms.html";
  } else if (view === "privacy") {
    destination = SITE_ORIGIN + "/privacy.html";
  } else if (view === "guest") {
    destination = SITE_ORIGIN + "/guest.html";
  }

  return new Response(null, {
    status: 302,
    headers: {
      "location": destination,
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
});
