// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PluginOption } from "vite";

function devDashboardMockRoutesPlugin(): PluginOption {
  const htmlPath = resolve(__dirname, "src/dev-mocks/coupler-dashboard-mocks.html");
  return {
    name: "dev-dashboard-mock-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestPath = (req.url ?? "").split("?")[0] ?? "";
        if (!requestPath.startsWith("/dev-mocks")) {
          next();
          return;
        }
        try {
          const html = await readFile(htmlPath, "utf8");
          const transformed = await server.transformIndexHtml(req.url ?? "/dev-mocks", html);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(transformed);
        } catch (error) {
          next(error as Error);
        }
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin(), devDashboardMockRoutesPlugin()],
  },
});
