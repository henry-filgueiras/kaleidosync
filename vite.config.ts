import { defineConfig } from "vite";
import { createSageConfig } from "@wearesage/vue/vite";
import { config } from "dotenv";

config({ quiet: true });
config({ path: ".env.local", override: true, quiet: true });

// Pure magic - one function call!
export default defineConfig(async () => {
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
