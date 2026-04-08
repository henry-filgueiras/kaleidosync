import { createApp as createVueApp } from "vue";
import Tres from "@tresjs/core";
import { createPinia } from "pinia";
import { appInitializationPlugin } from "../node_modules/@wearesage/vue/src/plugins/index.ts";
import { createSageRouter, debugRouter, routes, useRouter } from "./sage-router-pages";
import * as generatedRoutes from "./routes.generated";
import App from "./App.vue";

async function initializeApp() {
  const pinia = createPinia();
  pinia.use(appInitializationPlugin);

  const router = await createSageRouter(generatedRoutes);
  const app = createVueApp(App);

  app.use(pinia);
  app.use(Tres);
  app.mount("#app");

  if (typeof window !== "undefined") {
    (window as any).__SAGE_ROUTER__ = {
      currentRoute: router.currentRoute,
      ...useRouter(),
      debug: debugRouter,
      routes,
    };
  }

  console.log("🔥 Sage Router initialized!");

  return { app, router, pinia };
}

initializeApp().catch(console.error);
