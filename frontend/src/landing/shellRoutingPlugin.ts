import type { Connect, Plugin } from "vite";

import { acceptsHtml, shellHtmlFor } from "./shellRouting";

/**
 * Rewrites page navigations to the right HTML entry ahead of Vite's own SPA fallback, which would
 * otherwise answer every non-file path with `index.html` (now the landing page).
 */
function rewriteToShell(): Connect.NextHandleFunction {
  return (req, _res, next) => {
    if ((req.method === "GET" || req.method === "HEAD") && acceptsHtml(req.headers.accept)) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const shell = shellHtmlFor(url.pathname);
      if (shell !== null) req.url = `/${shell}${url.search}`;
    }
    next();
  };
}

export function shellRoutingPlugin(): Plugin {
  return {
    name: "helio-shell-routing",
    configureServer(server) {
      server.middlewares.use(rewriteToShell());
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewriteToShell());
    },
  };
}
