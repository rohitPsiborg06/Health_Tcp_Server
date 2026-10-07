import "dotenv/config";

// --------------------------------------------------------------------------
// Server Configurations & Limits
// --------------------------------------------------------------------------
export const TCP_PORT = Number(process.env.TCP_PORT) || 8000;
export const HTTP_PORT = Number(process.env.HTTP_PORT) || 8001;
export const HOST = process.env.HOST || "0.0.0.0";
export const INACTIVITY_TIMEOUT_MS = Number(process.env.INACTIVITY_TIMEOUT_MS) || 20 * 60 * 1000;
export const KEEPALIVE_MS = 30000; // 30s TCP keep-alive probe
export const MAX_BUFFER_SIZE = 128 * 1024; // 128 KB max buffer limit for noise protection
export const LOG_MAX_CHARS = 400; // Truncate long voice/image packet logging
export const LEN_LOWERCASE = process.env.LEN_LOWERCASE === "1";

// --------------------------------------------------------------------------
// Security & Auth Configurations
// --------------------------------------------------------------------------
export const API_SECRET_KEY = process.env.API_SECRET_KEY || "ehc_tcp_secret_key_2026";

/**
 * Parses CORS origins: supports "*" (all), single domain, or comma-separated list
 * e.g.: "http://localhost:3000,http://localhost:5173,https://myfrontend.com"
 */
export const getCorsOrigin = () => {
    const raw = process.env.CORS_ORIGIN || "*";
    if (!raw || raw.trim() === "*") return true;
    const list = raw.split(",").map((o) => o.trim()).filter(Boolean);
    return list.length === 1 ? list[0] : list;
};
