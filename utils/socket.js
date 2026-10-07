import { Server } from "socket.io";
import { buildPacket, sendToSocket } from "./protocol.js";
import { API_SECRET_KEY, CORS_ORIGIN } from "./config.js";

let ioInstance = null;

/**
 * Initializes the Socket.IO server attached to the HTTP server
 * Secured with CORS and API Key Handshake Authentication.
 */
export const initSocket = (httpServer, connectedDevices) => {
  const io = new Server(httpServer, {
    cors: {
      origin: CORS_ORIGIN,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  ioInstance = io;

  // Handshake Authentication Middleware
  io.use((socket, next) => {
    if (!API_SECRET_KEY) return next();

    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.["x-api-key"] ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "").trim();

    if (!token || token !== API_SECRET_KEY) {
      console.warn(`🔒 Unauthorized Socket.IO connection rejected from IP: ${socket.handshake.address}`);
      return next(new Error("Unauthorized: Invalid or missing API key in handshake"));
    }

    next();
  });

  io.on("connection", (socket) => {
    console.log(`⚡ Authenticated backend service connected to Realtime Stream: [${socket.id}]`);

    // Allow authenticated backend to send downlink commands via socket event
    socket.on("sendToDevice", ({ deviceId, command, raw, mfr = "3G" }, callback) => {
      const entry = connectedDevices?.get(deviceId);
      if (!entry || entry.socket.destroyed) {
        if (entry) connectedDevices.delete(deviceId);
        if (typeof callback === "function") {
          callback({ success: false, error: `Device [${deviceId}] is offline` });
        }
        return;
      }

      let packetToSend = raw;
      if (!packetToSend && command) {
        packetToSend = buildPacket(mfr, deviceId, command);
      }

      if (!packetToSend) {
        if (typeof callback === "function") {
          callback({ success: false, error: "Missing command or raw packet" });
        }
        return;
      }

      const sent = sendToSocket(entry.socket, packetToSend);
      if (typeof callback === "function") {
        callback({ success: sent, sentPacket: packetToSend });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Backend service disconnected from Stream: [${socket.id}]`);
    });
  });

  return io;
};

/**
 * Broadcasts incoming smartwatch packet to all connected backend listeners
 * Only executes if at least one client is connected
 */
export const broadcastDeviceData = (data) => {
  if (ioInstance && ioInstance.engine.clientsCount > 0) {
    ioInstance.emit("deviceData", data);
  }
};

/**
 * Gracefully shuts down the Socket.IO server
 */
export const closeSocket = () => {
  if (ioInstance) {
    ioInstance.close();
  }
};
