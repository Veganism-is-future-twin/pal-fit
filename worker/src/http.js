// HTTP helpers: JSON responses, consistent errors, CORS.

/**
 * Throw this anywhere in a route handler to return a clean JSON error:
 *   throw new ApiError(400, 'bad_request', 'Steps must be 0–100000');
 * The client always receives: { error: { code, message } }
 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Build a JSON response. */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Build a JSON error response in the standard shape. */
export function errorResponse(status, code, message) {
  return json({ error: { code, message } }, status);
}

/** Read and parse a JSON request body, or fail with a 400. */
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'bad_json', 'Request body must be valid JSON.');
  }
}

// ---------------------------------------------------------------------------
// CORS
// Only our own frontend (GitHub Pages) and localhost during development may
// call the API from a browser. Everything else gets no CORS headers, so the
// browser blocks it.
// ---------------------------------------------------------------------------
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  if (env.FRONTEND_ORIGIN && origin === env.FRONTEND_ORIGIN) return true;
  return LOCAL_ORIGIN.test(origin);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Return a copy of `response` with CORS headers added. */
export function withCors(response, request, env) {
  const extra = corsHeaders(request, env);
  if (Object.keys(extra).length === 0) return response;
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  return res;
}
