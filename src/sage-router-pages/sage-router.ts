import { computed, ref, type Ref } from "vue";

const rawBase = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
const routerBase = rawBase === "" ? "/" : rawBase;

function normalizePathname(pathname: string) {
  if (routerBase !== "/" && (pathname === routerBase || pathname.startsWith(`${routerBase}/`))) {
    const stripped = pathname.slice(routerBase.length);
    return stripped || "/";
  }

  return pathname || "/";
}

function withBasePath(pathname: string) {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;

  if (routerBase === "/") {
    return normalized;
  }

  return normalized === "/" ? `${routerBase}/` : `${routerBase}${normalized}`;
}

function updateRouteState(url: URL) {
  currentPath.value = normalizePathname(url.pathname);
  currentQuery.value = url.searchParams;
  currentHash.value = url.hash;
}

export interface SageRoute {
  path: string;
  component: () => Promise<any>;
  name?: string;
  meta: Record<string, any>;
  params: string[];
}

export interface SageRouteLocation {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  hash: string;
  meta: Record<string, any>;
  name?: string;
  matched: SageRoute | null;
}

export interface SageRouter {
  currentRoute: Ref<SageRouteLocation>;
  push: (path: string, query?: Record<string, string>) => void;
  replace: (path: string, query?: Record<string, string>) => void;
  back: () => void;
  forward: () => void;
  go: (delta: number) => void;
  cleanQuery: (keysToRemove: string | string[]) => void;
}

export let routes: SageRoute[] = [];
export let matchRoute = (_path: string): SageRoute | null => null;
export let extractParams = (_routePath: string, _actualPath: string): Record<string, string> => ({});

const currentPath = ref(normalizePathname(window.location.pathname));
const currentQuery = ref(new URLSearchParams(window.location.search));
const currentHash = ref(window.location.hash);

window.addEventListener("popstate", () => {
  currentPath.value = normalizePathname(window.location.pathname);
  currentQuery.value = new URLSearchParams(window.location.search);
  currentHash.value = window.location.hash;
});

const currentRoute = computed((): SageRouteLocation => {
  const path = currentPath.value;
  const matched = matchRoute(path);
  const params = matched ? extractParams(matched.path, path) : {};
  const query = Object.fromEntries(currentQuery.value.entries());
  const hash = currentHash.value;

  return {
    path,
    params,
    query,
    hash,
    meta: matched?.meta || {},
    name: matched?.name,
    matched,
  };
});

function navigate(path: string, query?: Record<string, string>, replaceState = false) {
  const url = new URL(path, window.location.origin);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  if (url.origin === window.location.origin) {
    url.pathname = withBasePath(normalizePathname(url.pathname));
  }

  const method = replaceState ? "replaceState" : "pushState";
  history[method]({}, "", url.toString());
  updateRouteState(url);
}

function push(path: string, query?: Record<string, string>) {
  navigate(path, query, false);
}

function replace(path: string, query?: Record<string, string>) {
  navigate(path, query, true);
}

function back() {
  history.back();
}

function forward() {
  history.forward();
}

function go(delta: number) {
  history.go(delta);
}

function cleanQuery(keysToRemove: string | string[]) {
  const keys = Array.isArray(keysToRemove) ? keysToRemove : [keysToRemove];
  const newQuery = new URLSearchParams(currentQuery.value);

  keys.forEach((key) => newQuery.delete(key));

  const url = new URL(withBasePath(currentPath.value), window.location.origin);
  url.search = newQuery.toString();

  history.replaceState({}, "", url.toString());
  currentQuery.value = newQuery;
}

export async function createSageRouter(routesModule?: {
  routes?: SageRoute[];
  matchRoute?: (path: string) => SageRoute | null;
  extractParams?: (routePath: string, actualPath: string) => Record<string, string>;
}): Promise<SageRouter> {
  if (routesModule) {
    routes = routesModule.routes || [];
    const sourceMatchRoute = routesModule.matchRoute || (() => null);
    const sourceExtractParams = routesModule.extractParams || (() => ({}));

    matchRoute = (path: string) => sourceMatchRoute(normalizePathname(path));
    extractParams = (routePath: string, actualPath: string) =>
      sourceExtractParams(normalizePathname(routePath), normalizePathname(actualPath));

    console.log("🔥 Sage Router: Loaded", routes.length, "routes with base", routerBase);
  } else {
    console.log("🔧 Sage Router: No generated routes found, using empty routes");
    routes = [];
    matchRoute = () => null;
    extractParams = () => ({});
  }

  if (typeof window !== "undefined") {
    (window as any).__SAGE_ROUTER__.routes = routes;
  }

  return {
    currentRoute,
    push,
    replace,
    back,
    forward,
    go,
    cleanQuery,
  };
}

export function useRoute(): Ref<SageRouteLocation> {
  return currentRoute;
}

export function useRouter(): Omit<SageRouter, "currentRoute"> {
  return {
    push,
    replace,
    back,
    forward,
    go,
    cleanQuery,
  };
}

export function debugRouter() {
  console.log("🔍 Sage Router Debug:");
  console.log("Current Route:", currentRoute.value);
  console.log("Available Routes:", routes);
  console.log("Path:", currentPath.value);
  console.log("Query:", Object.fromEntries(currentQuery.value));
  console.log("Hash:", currentHash.value);
  console.log("Base:", routerBase);
}

if (typeof window !== "undefined") {
  (window as any).__SAGE_ROUTER__ = {
    currentRoute,
    push,
    replace,
    back,
    forward,
    go,
    cleanQuery,
    debug: debugRouter,
    routes,
  };
}
