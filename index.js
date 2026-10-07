import net from "net";
import {
  TCP_PORT,
  HTTP_PORT,
  HOST,
  INACTIVITY_TIMEOUT_MS,
  KEEPALIVE_MS,
  MAX_BUFFER_SIZE,
  LOG_MAX_CHARS,
} from "./utils/config.js";
import { START, END, getAckBody, buildPacket, sendToSocket } from "./utils/protocol.js";
import { startHttpApi } from "./utils/api.js";
import { initSocket, broadcastDeviceData, closeSocket } from "./utils/socket.js";

const EMPTY_BUFFER = Buffer.alloc(0);

// In-memory active devices map: deviceId => { socket, ip, connectedAt, lastSeen }
const connectedDevices = new Map();

// --------------------------------------------------------------------------
// 1. TCP Server (Smartwatch / Device connects directly here)
// --------------------------------------------------------------------------
const tcpServer = net.createServer((socket) => {
  const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`============>>>Device Connected: ${clientAddr}`);

  // Keep connection stable & prevent cellular NAT timeouts
  socket.setKeepAlive(true, KEEPALIVE_MS);
  socket.setNoDelay(true);

  // Inactivity timeout: close dead cellular connections
  if (INACTIVITY_TIMEOUT_MS > 0) {
    socket.setTimeout(INACTIVITY_TIMEOUT_MS);
    socket.on("timeout", () => {
      const target = socket.deviceId ? `[${socket.deviceId}] (${clientAddr})` : clientAddr;
      console.log(`⏱️ Inactivity timeout (${Math.round(INACTIVITY_TIMEOUT_MS / 60000)}m) reached for ${target}, terminating.`);
      socket.destroy();
    });
  }

  let buffer = EMPTY_BUFFER;

  socket.on("data", (chunk) => {
    // Zero-allocation: only concatenate if buffer has pending fragmented data
    buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;

    // Protect against buffer bloat / dirty noise
    if (buffer.length > MAX_BUFFER_SIZE) {
      console.warn(`⚠️ Buffer overflow from ${clientAddr}, resetting buffer.`);
      buffer = EMPTY_BUFFER;
      return;
    }

    // Process all framed packets: [MANUFACTURER*ID*LENGTH*CONTENT]
    while (true) {
      const startIdx = buffer.indexOf(START);
      if (startIdx === -1) {
        if (buffer.length > 4096) buffer = EMPTY_BUFFER;
        break;
      }

      // Discard noise preceding '['
      if (startIdx > 0) {
        buffer = buffer.subarray(startIdx);
      }

      const endIdx = buffer.indexOf(END);
      if (endIdx === -1) {
        // Incomplete packet frame; wait for next chunk
        break;
      }

      const rawPacket = buffer.subarray(0, endIdx + 1).toString("utf8");
      buffer = buffer.subarray(endIdx + 1);

      const logText =
        rawPacket.length > LOG_MAX_CHARS
          ? `${rawPacket.slice(0, LOG_MAX_CHARS)}…(${rawPacket.length}B)`
          : rawPacket;
      console.log(`📥 [DEVICE PACKET]: ${logText}`);

      const parts = rawPacket.slice(1, -1).split("*");
      if (parts.length >= 4) {
        const [mfr, deviceId, , ...rest] = parts;
        const content = rest.join("*");
        const command = content.split(",")[0];
        const now = new Date().toISOString();

        socket.deviceId = deviceId;

        // If device reconnected on a new socket, clean up the old stale socket
        const existing = connectedDevices.get(deviceId);
        if (existing && existing.socket !== socket && !existing.socket.destroyed) {
          existing.socket.destroy();
        }

        // Track connected device state
        connectedDevices.set(deviceId, {
          socket,
          ip: clientAddr,
          connectedAt: existing?.connectedAt || now,
          lastSeen: now,
        });

        // Send required protocol auto-ACK
        const ackBody = getAckBody(command);
        if (ackBody) {
          sendToSocket(socket, buildPacket(mfr, deviceId, ackBody));
        }

        // Stream real-time data to connected Socket.IO consumers (e.g. NestJS / DB service)
        broadcastDeviceData({
          deviceId,
          mfr,
          command,
          content,
          rawPacket,
          receivedAt: now,
        });
      }
    }

    // Release underlying ArrayBuffer slice for immediate V8 GC if buffer is drained
    if (buffer.length === 0) {
      buffer = EMPTY_BUFFER;
    }
  });

  socket.on("close", () => {
    if (socket.deviceId) {
      const entry = connectedDevices.get(socket.deviceId);
      if (entry && entry.socket === socket) {
        connectedDevices.delete(socket.deviceId);
        console.log(`🔌 Device [${socket.deviceId}] Disconnected`);
      }
    }
  });

  socket.on("error", (err) => {
    console.error(`Socket error from ${socket.deviceId ?? clientAddr}:`, err.message);
  });
});

// Server-level error handler (e.g., EADDRINUSE)
tcpServer.on("error", (err) => {
  console.error(`❌ TCP Server error: ${err.message}`);
  process.exit(1);
});

tcpServer.listen(TCP_PORT, HOST, () => {
  console.log(`🛰️  TCP Server running on ${HOST}:${TCP_PORT} (Devices connect here)`);
});

// --------------------------------------------------------------------------
// 2. HTTP REST API Server (Users / Main backend send commands here)
// --------------------------------------------------------------------------
const httpApiServer = startHttpApi({ connectedDevices, port: HTTP_PORT, host: HOST });

// --------------------------------------------------------------------------
// 3. Socket.IO Realtime Data Stream (Backend connects here to save in DB)
// --------------------------------------------------------------------------
initSocket(httpApiServer, connectedDevices);

// --------------------------------------------------------------------------
// 4. Graceful Shutdown
// --------------------------------------------------------------------------
let isShuttingDown = false;
const shutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
  tcpServer.close(() => console.log("TCP server closed."));
  closeSocket();
  httpApiServer.close(() => console.log("HTTP API server closed."));

  for (const { socket } of connectedDevices.values()) {
    socket.destroy();
  }

  setTimeout(() => process.exit(0), 1000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
