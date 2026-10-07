import express from "express";
import cors from "cors";
import { buildPacket, sendToSocket } from "./protocol.js";
import { API_SECRET_KEY, getCorsOrigin } from "./config.js";

/**
 * Authentication middleware for HTTP routes
 */
const authMiddleware = (req, res, next) => {
  // Public health check route
  if (req.path === "/" || req.path === "/health") {
    return next();
  }

  // If no secret key is set, bypass auth
  if (!API_SECRET_KEY) {
    return next();
  }

  // Extract key from 'x-api-key' or 'Authorization: Bearer <token>'
  const clientKey =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "").trim();

  if (!clientKey || clientKey !== API_SECRET_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Missing or invalid API key. Provide via 'x-api-key' header or 'Authorization: Bearer <token>'",
    });
  }

  next();
};

/**
 * Starts Express HTTP REST API Server
 */
export const startHttpApi = ({ connectedDevices, port, host }) => {
  const app = express();

  // CORS Configuration
  app.use(
    cors({
      origin: getCorsOrigin(),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
      credentials: true,
    }),
  );

  app.use(express.json());

  // Apply API Key security middleware
  app.use(authMiddleware);

  // 1. Health check (Public)
  app.get(["/", "/health"], (req, res) => {
    res.json({
      status: "ok",
      onlineDevices: connectedDevices.size,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. List all connected devices (Protected)
  app.get("/api/devices", (req, res) => {
    const list = Array.from(connectedDevices.entries()).map(([id, info]) => ({
      deviceId: id,
      ip: info.ip,
      connectedAt: info.connectedAt,
      lastSeen: info.lastSeen,
    }));
    res.json({ success: true, count: list.length, devices: list });
  });

  // 3. Single device status (Protected)
  app.get("/api/device/:deviceId", (req, res) => {
    const { deviceId } = req.params;
    const info = connectedDevices.get(deviceId);
    if (!info || info.socket.destroyed) {
      return res.status(404).json({
        success: false,
        deviceId,
        isConnected: false,
        message: "Device is offline",
      });
    }
    res.json({
      success: true,
      deviceId,
      isConnected: true,
      ip: info.ip,
      connectedAt: info.connectedAt,
      lastSeen: info.lastSeen,
    });
  });

  // 4. Send command to device: POST /api/device/command (Protected)
  app.post(["/api/device/command", "/api/device/send"], (req, res) => {
    const { deviceId, command, raw, mfr = "3G" } = req.body || {};

    if (!deviceId) {
      return res.status(400).json({ success: false, error: "deviceId is required" });
    }

    const entry = connectedDevices.get(deviceId);
    if (!entry || entry.socket.destroyed) {
      return res.status(404).json({
        success: false,
        deviceId,
        error: `Device [${deviceId}] is offline or not connected`,
      });
    }

    // Build standard Beesure packet or use raw if provided
    let packetToSend = raw;
    if (!packetToSend && command) {
      packetToSend = buildPacket(mfr, deviceId, command);
    }

    if (!packetToSend) {
      return res.status(400).json({
        success: false,
        error: "Either 'command' (e.g. 'CR', 'RESET') or 'raw' packet is required",
      });
    }

    const sent = sendToSocket(entry.socket, packetToSend);
    if (sent) {
      res.json({
        success: true,
        deviceId,
        sentPacket: packetToSend,
        message: `Command sent successfully to device [${deviceId}]`,
      });
    } else {
      res.status(500).json({
        success: false,
        deviceId,
        error: "Failed to write command to socket (socket closed or unavailable)",
      });
    }
  });

  const server = app.listen(port, host, () => {
    console.log(`🌐 Express API running on http://${host}:${port} (Send commands & query devices here)`);
  });

  return server;
};
