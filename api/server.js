#!/usr/bin/env node

import crypto from "node:crypto";
import express from "express";
import { config } from "dotenv";

config({ quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const app = express();
const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const spotifyClientId = process.env.SPOTIFY_CLIENT_ID || "";
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
const spotifyRedirectUri = process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:3001/api/spotify/callback";
const spotifyScopes =
  process.env.SPOTIFY_SCOPES || "user-read-currently-playing user-read-playback-state";
const allowedReturnHosts = new Set(
  (process.env.SPOTIFY_ALLOWED_RETURN_HOSTS || "127.0.0.1,localhost")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);

const stateStore = new Map();
const audioAnalysisCache = new Map();
const MAX_AUDIO_ANALYSIS_CACHE_SIZE = 100;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function getMissingSpotifyConfig() {
  return [
    ["SPOTIFY_CLIENT_ID", spotifyClientId],
    ["SPOTIFY_CLIENT_SECRET", spotifyClientSecret],
    ["SPOTIFY_REDIRECT_URI", spotifyRedirectUri]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function isSpotifyConfigured() {
  return getMissingSpotifyConfig().length === 0;
}

function pruneExpiredStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const [state, data] of stateStore.entries()) {
    if (data.createdAt < cutoff) stateStore.delete(state);
  }
}

function getSpotifyBaseHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`
  };
}

function getSpotifyTokenHeaders() {
  return {
    Authorization: `Basic ${Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };
}

function sanitizeReturnUrl(candidate) {
  if (!candidate || typeof candidate !== "string") return null;

  try {
    const url = new URL(candidate);

    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!allowedReturnHosts.has(url.hostname)) return null;

    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
    }

    return url.toString();
  } catch {
    return null;
  }
}

function buildReturnUrl(baseUrl, params) {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function getDefaultSpotifyReturnUrl() {
  return sanitizeReturnUrl(process.env.SPOTIFY_DEFAULT_RETURN_URL) || "http://127.0.0.1:5173/visualizer";
}

function setCachedAudioAnalysis(trackId, data) {
  if (!audioAnalysisCache.has(trackId) && audioAnalysisCache.size >= MAX_AUDIO_ANALYSIS_CACHE_SIZE) {
    const oldestTrackId = audioAnalysisCache.keys().next().value;
    if (oldestTrackId !== undefined) {
      audioAnalysisCache.delete(oldestTrackId);
    }
  }

  audioAnalysisCache.set(trackId, data);
}

async function exchangeAuthorizationCode(code) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: getSpotifyTokenHeaders(),
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: spotifyRedirectUri
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Spotify token exchange failed");
  }

  return data;
}

async function refreshSpotifyToken(refreshToken) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: getSpotifyTokenHeaders(),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Spotify token refresh failed");
  }

  return data;
}

async function getAudioAnalysis(trackId, accessToken) {
  const cached = audioAnalysisCache.get(trackId);

  if (cached) return cached;

  const response = await fetch(`https://api.spotify.com/v1/audio-analysis/${trackId}`, {
    headers: getSpotifyBaseHeaders(accessToken)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Spotify audio analysis request failed");
  }

  setCachedAudioAnalysis(trackId, data);

  return data;
}

function sendConfigError(res) {
  res.status(503).json({
    configured: false,
    missing: getMissingSpotifyConfig()
  });
}

const spotifyRouter = express.Router();

spotifyRouter.get("/health", (req, res) => {
  res.json({
    configured: isSpotifyConfigured(),
    missing: getMissingSpotifyConfig(),
    redirectUri: spotifyRedirectUri,
    scopes: spotifyScopes.split(/\s+/).filter(Boolean)
  });
});

spotifyRouter.get("/auth", (req, res) => {
  if (!isSpotifyConfigured()) {
    sendConfigError(res);
    return;
  }

  pruneExpiredStates();

  const returnUrl =
    sanitizeReturnUrl(req.query.returnUrl) ||
    getDefaultSpotifyReturnUrl();
  const state = crypto.randomUUID();

  stateStore.set(state, {
    createdAt: Date.now(),
    returnUrl
  });

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.search = new URLSearchParams({
    client_id: spotifyClientId,
    redirect_uri: spotifyRedirectUri,
    response_type: "code",
    scope: spotifyScopes,
    state
  }).toString();

  res.redirect(authUrl.toString());
});

spotifyRouter.get("/callback", async (req, res) => {
  const fallbackReturnUrl = getDefaultSpotifyReturnUrl();
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const spotifyError = typeof req.query.error === "string" ? req.query.error : "";
  const stateData = state ? stateStore.get(state) : null;
  const returnUrl = stateData?.returnUrl || fallbackReturnUrl;

  if (state) stateStore.delete(state);

  if (!state || !stateData) {
    res.redirect(buildReturnUrl(fallbackReturnUrl, { spotify_error: "invalid_state" }));
    return;
  }

  if (spotifyError) {
    res.redirect(buildReturnUrl(returnUrl, { spotify_error: spotifyError }));
    return;
  }

  if (!code) {
    res.redirect(buildReturnUrl(returnUrl, { spotify_error: "missing_authorization_code" }));
    return;
  }

  if (!isSpotifyConfigured()) {
    res.redirect(buildReturnUrl(returnUrl, { spotify_error: "spotify_not_configured" }));
    return;
  }

  try {
    const tokens = await exchangeAuthorizationCode(code);

    res.redirect(
      buildReturnUrl(returnUrl, {
        spotify: "connected",
        spotify_access_token: tokens.access_token,
        spotify_refresh_token: tokens.refresh_token
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "spotify_callback_failed";
    res.redirect(buildReturnUrl(returnUrl, { spotify_error: message }));
  }
});

spotifyRouter.post("/refresh", async (req, res) => {
  if (!isSpotifyConfigured()) {
    sendConfigError(res);
    return;
  }

  const refreshToken = req.body?.refreshToken;

  if (!refreshToken || typeof refreshToken !== "string") {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }

  try {
    const data = await refreshSpotifyToken(refreshToken);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Spotify refresh failed";
    res.status(502).json({ error: message });
  }
});

spotifyRouter.get("/now-playing", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    res.status(401).json({ error: "Missing Bearer token" });
    return;
  }

  try {
    const currentPlaybackResponse = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: getSpotifyBaseHeaders(accessToken)
    });

    if (currentPlaybackResponse.status === 204) {
      res.status(204).end();
      return;
    }

    if (currentPlaybackResponse.status === 401) {
      res.status(401).end();
      return;
    }

    const currentPlayback = await currentPlaybackResponse.json();

    if (!currentPlaybackResponse.ok) {
      const message = currentPlayback.error?.message || "Spotify current playback request failed";
      res.status(currentPlaybackResponse.status).json({ error: message });
      return;
    }

    if (!currentPlayback?.item?.id || currentPlayback.currently_playing_type !== "track") {
      res.status(204).end();
      return;
    }

    const audioAnalysis = await getAudioAnalysis(currentPlayback.item.id, accessToken);

    res.json({
      audioAnalysis,
      isPlaying: currentPlayback.is_playing,
      track: currentPlayback
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Spotify now playing request failed";
    res.status(502).json({ error: message });
  }
});

app.use("/api/spotify", spotifyRouter);
app.use("/spotify", spotifyRouter);

app.listen(port, () => {
  console.log(`Spotify API server listening on http://127.0.0.1:${port}`);
  console.log(`Spotify configured: ${isSpotifyConfigured() ? "yes" : "no"}`);
  if (!isSpotifyConfigured()) {
    console.log(`Missing config: ${getMissingSpotifyConfig().join(", ")}`);
  }
});
