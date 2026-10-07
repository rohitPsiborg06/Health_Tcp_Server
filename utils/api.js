import express from "express";
import cors from "cors";
import { buildPacket, sendToSocket } from "./protocol.js";

/**
 * Starts Express HTTP REST API Server
 */
export const startHttpApi = ({ connectedDevices, port, host }) => {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // 1. Health check
  app.get(["/", "/health"], (req, res) => {
    res.json({
      status: "ok",
      onlineDevices: connectedDevices.size,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. List all connected devices
  app.get("/api/devices", (req, res) => {
    const list = Array.from(connectedDevices.entries()).map(([id, info]) => ({
      deviceId: id,
      ip: info.ip,
      connectedAt: info.connectedAt,
      lastSeen: info.lastSeen,
    }));
    res.json({ success: true, count: list.length, devices: list });
  });

  // 3. Single device status
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

  // 4. Send command to device: POST /api/device/command
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
