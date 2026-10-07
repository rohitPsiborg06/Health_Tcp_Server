import net from "net";
import {
  TCP_PORT,
  HOST,
  INACTIVITY_TIMEOUT_MS,
  KEEPALIVE_MS,
  MAX_BUFFER_SIZE,
  LOG_MAX_CHARS,
} from "./utils/config.js";
import { START, END, getAckBody, buildPacket, sendToSocket } from "./utils/protocol.js";

// In-memory active devices map: deviceId => { socket, ip, connectedAt, lastSeen }
const connectedDevices = new Map();

// --------------------------------------------------------------------------
// TCP Server (Smartwatch / Device connects directly here)
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

  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Protect against buffer bloat / dirty noise
    if (buffer.length > MAX_BUFFER_SIZE) {
      console.warn(`⚠️ Buffer overflow from ${clientAddr}, resetting buffer.`);
      buffer = Buffer.alloc(0);
      return;
    }

    // Process all framed packets: [MANUFACTURER*ID*LENGTH*CONTENT]
    while (true) {
      const startIdx = buffer.indexOf(START);
      if (startIdx === -1) {
        if (buffer.length > 4096) buffer = Buffer.alloc(0);
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
        const [mfr, deviceId, lenHex, ...rest] = parts;
        const content = rest.join("*");
        const command = content.split(",")[0];

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
          connectedAt: existing?.connectedAt || new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });

        // Send required protocol auto-ACK
        const ackBody = getAckBody(command);
        if (ackBody) {
          sendToSocket(socket, buildPacket(mfr, deviceId, ackBody));
        }
      }
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
  console.error(`❌ Server error: ${err.message}`);
  process.exit(1);
});

tcpServer.listen(TCP_PORT, HOST, () => {
  console.log(`🛰️  TCP Server running on ${HOST}:${TCP_PORT} (Devices send data here)`);
});

// --------------------------------------------------------------------------
// Graceful Shutdown
// --------------------------------------------------------------------------
let isShuttingDown = false;
const shutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
  tcpServer.close(() => {
    console.log("TCP server closed.");
    process.exit(0);
  });

  for (const { socket } of connectedDevices.values()) {
    socket.destroy();
  }

  // Force close if sockets hang
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
