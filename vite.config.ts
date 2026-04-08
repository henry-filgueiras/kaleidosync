import { resolve as pathResolve } from "node:path";
import { defineConfig } from "vite";
import { createSageConfig } from "@wearesage/vue/vite";
import { config } from "dotenv";

config({ quiet: true });
config({ path: ".env.local", override: true, quiet: true });

function sagePagesRouterAdapter() {
  const routerIndex = pathResolve(__dirname, "src/sage-router-pages/index.ts");
  const routerModule = pathResolve(__dirname, "src/sage-router-pages/sage-router.ts");

  return {
    name: "sage-pages-router-adapter",
    enforce: "pre" as const,
    resolveId(id: string, importer?: string) {
      if (id === "@wearesage/vue/router" || id === "@wearesage/vue/src/router") {
        return routerIndex;
      }

      if (
        id === "@wearesage/vue/router/sage-router" ||
        id === "@wearesage/vue/src/router/sage-router" ||
        id === "@wearesage/vue/src/router/sage-router.ts"
      ) {
        return routerModule;
      }

      if (!importer?.includes("/node_modules/@wearesage/vue/src/")) {
        return null;
      }

      if (id === "./router" || id === "../router" || id === "../../router") {
        return routerIndex;
      }

      if (
        id === "./sage-router" ||
        id === "./router/sage-router" ||
        id === "../router/sage-router" ||
        id === "../../router/sage-router"
      ) {
        return routerModule;
      }

      return null;
    }
  };
}

// Pure magic - one function call!
export default defineConfig(async ({ command }) => {
  const baseConfig = await createSageConfig({
    router: true,
    apiProxy: {
      target: process.env.VITE_API_BASE_URL || "http://127.0.0.1:3001"
    }
  });

  const include = [
    ...(baseConfig.optimizeDeps?.include || []).filter(dep => dep !== "phone"),
    "dayjs",
    "dayjs/locale/en",
    "dayjs/esm/locale/en"
  ];

  return {
    ...baseConfig,
    base: command === "build" ? "/kaleidosync/" : "/",
    plugins: [sagePagesRouterAdapter(), ...(baseConfig.plugins || [])],
    define: {
      ...(baseConfig.define || {}),
      "import.meta.env.VITE_API": JSON.stringify(process.env.VITE_API ?? "")
    },
    optimizeDeps: {
      ...baseConfig.optimizeDeps,
      include: [...new Set(include)]
    }
  };
});
