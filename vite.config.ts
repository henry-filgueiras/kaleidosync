import { resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vite";
import { createSageConfig } from "@wearesage/vue/vite";
import { config } from "dotenv";

config({ quiet: true });
config({ path: ".env.local", override: true, quiet: true });

async function loadSageRouterPlugin() {
  const moduleUrl = pathToFileURL(
    pathResolve(__dirname, "node_modules/@wearesage/vue/dist/router/vite-plugin-sage-router.js")
  ).href;
  const { sageRouter } = await import(moduleUrl);

  return sageRouter({
    pagesDir: "src/pages",
    outputFile: "src/routes.generated.ts",
  });
}

// Pure magic - one function call!
export default defineConfig(async ({ command }) => {
  const baseConfig = await createSageConfig({
    apiProxy: {
      target: process.env.VITE_API_BASE_URL || "http://127.0.0.1:3001"
    }
  });
  const routerPlugin = await loadSageRouterPlugin();

  const include = [
    ...(baseConfig.optimizeDeps?.include || []).filter(dep => dep !== "phone"),
    "dayjs",
    "dayjs/locale/en",
    "dayjs/esm/locale/en",
    "music-metadata",
    "socket.io-client",
    "engine.io-client",
    "socket.io-parser",
    "debug",
    "content-type",
    "media-typer",
    "ieee754"
  ];
  const needsInterop = [...(baseConfig.optimizeDeps?.needsInterop || []), "debug", "content-type", "media-typer", "ieee754"];

  return {
    ...baseConfig,
    base: command === "build" ? "/kaleidosync/" : "/",
    plugins: [routerPlugin, ...(baseConfig.plugins || [])],
    define: {
      ...(baseConfig.define || {}),
      "import.meta.env.VITE_API": JSON.stringify(process.env.VITE_API ?? "")
    },
    optimizeDeps: {
      ...baseConfig.optimizeDeps,
      include: [...new Set(include)],
      needsInterop: [...new Set(needsInterop)]
    }
  };
});
