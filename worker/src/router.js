// A tiny router: register routes like `router.get('/api/users/:id', handler)`.
// Handlers receive (ctx) where ctx = { request, env, exec, params, url }.

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    // Turn '/api/users/:id' into a regex with a named group for each :param.
    const pattern = new RegExp(
      '^' + path.replace(/\/:([a-zA-Z_]+)/g, '/(?<$1>[^/]+)') + '/?$'
    );
    this.routes.push({ method, pattern, handler });
    return this;
  }

  get(path, h) { return this.add('GET', path, h); }
  post(path, h) { return this.add('POST', path, h); }
  put(path, h) { return this.add('PUT', path, h); }
  patch(path, h) { return this.add('PATCH', path, h); }
  delete(path, h) { return this.add('DELETE', path, h); }

  /**
   * Find the handler for a request.
   * Returns { handler, params } or { methodNotAllowed: true } or null.
   */
  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method === method) {
        return { handler: route.handler, params: { ...(m.groups || {}) } };
      }
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
