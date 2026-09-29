// Read-only proxy in front of the Earthmover Flux EDR and tiles services.
// Holds ARRAYLAKE_KEY so the browser never sees it, restricts requests to the
// configured repo/groups/routes, and caches responses at the edge.

const ROUTES = {
  // group-relative paths the site is allowed to request, per service
  tiles: [/^tiles\/WebMercatorQuad\/\d+\/\d+\/\d+$/, /^tiles\/WebMercatorQuad\/tilejson\.json$/, /^tiles\/legend$/],
  edr: [/^edr\/?$/, /^edr\/position$/],
};

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return text("Method not allowed", 405, cors);

    const url = new URL(request.url);
    // /{service}/{group}/{rest...}
    const [, service, group, ...rest] = url.pathname.split("/");
    const subpath = rest.join("/");
    const groups = env.GROUPS.split(",").map((g) => g.trim());

    if (!(service in ROUTES) || !groups.includes(group) || !ROUTES[service].some((re) => re.test(subpath))) {
      return text("Not found", 404, cors);
    }

    const base = service === "tiles" ? env.TILES_BASE : env.EDR_BASE;
    const upstream = new URL(`${base}/${env.REPO}/${env.REF}/${group}/${subpath}`);
    upstream.search = url.search;

    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: "GET" });
    let response = await cache.match(cacheKey);

    if (!response) {
      const res = await fetch(upstream, { headers: { Authorization: `Bearer ${env.ARRAYLAKE_KEY}` } });
      response = new Response(res.body, res);
      response.headers.delete("set-cookie");
      response.headers.delete("access-control-allow-credentials");
      if (res.ok) {
        response.headers.set("Cache-Control", `public, max-age=${env.CACHE_SECONDS}`);
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      } else {
        response.headers.set("Cache-Control", "no-store");
      }
    }

    response = new Response(response.body, response);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};

function corsHeaders(request, env) {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  const origin = request.headers.get("Origin");
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function text(body, status, headers) {
  return new Response(body, { status, headers: { ...headers, "Content-Type": "text/plain" } });
}
