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
