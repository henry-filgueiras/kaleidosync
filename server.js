import compression from "compression";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { Readable } from "node:stream";

const port = Number(process.env.PORT || 2223);
const directory = "dist";
const apiUrl = new URL(process.env.VITE_API_BASE_URL || "http://localhost:3001");
const app = express();

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

app.use("/api", async (req, res) => {
  const targetUrl = new URL(req.originalUrl.replace(/^\/api/, "") || "/", apiUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
      const normalizedKey = key.toLowerCase();

      if (!value || normalizedKey === "host" || HOP_BY_HOP_HEADERS.has(normalizedKey)) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }

    const init = {
      method: req.method,
      headers,
      redirect: "manual",
      signal: controller.signal
    };

    if (!["GET", "HEAD"].includes(req.method)) {
      init.body = req;
      init.duplex = "half";
    }

    const response = await fetch(targetUrl, init);
    clearTimeout(timeout);

    res.status(response.status);

    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (!response.body || req.method === "HEAD") {
      res.end();
      return;
    }

    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    clearTimeout(timeout);

    const statusCode = error?.name === "AbortError" ? 504 : 502;
    const message = error instanceof Error ? error.message : "Unknown proxy error";

    res.status(statusCode).type("text/plain").send(`API proxy request failed for ${targetUrl.toString()}: ${message}`);
  }
});

app.use(express.static(directory));
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(process.cwd(), directory, "index.html"));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Serving static files from: ${directory}`);
  console.log(`API proxy enabled: /api/* -> ${apiUrl.toString()}`);
  console.log("HTTPS redirect: disabled");
});
