import net from "net";
import http from "http";
import { Server } from "socket.io";

const TCP_PORT = process.env.TCP_PORT || 8000;
const SOCKET_PORT = process.env.SOCKET_PORT || 8001;

// ----------------------------------------------------
// 1. Socket.IO Server (Main Server connects here)
// ----------------------------------------------------
const httpServer = http.createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

// In-memory connected devices: deviceId => tcpSocket
const connectedDevices = new Map();

io.on("connection", (socket) => {
  console.log("⚡ Main Server connected via Socket.IO");

  // Receive downlink command from Main Server to send to device
  socket.on("sendToDevice", ({ deviceId, data }) => {
    const deviceSocket = connectedDevices.get(deviceId);
    if (deviceSocket && !deviceSocket.destroyed) {
      deviceSocket.write(data);
      console.log(`📤 Sent to Device [${deviceId}]:`, data);
    } else {
      console.log(`❌ Device [${deviceId}] is not connected`);
    }
  });

  // Return list of connected devices
  socket.on("getConnectedDevices", (callback) => {
    if (typeof callback === "function") {
      callback(Array.from(connectedDevices.keys()));
    }
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`📡 Socket.IO Bridge running on port ${SOCKET_PORT} (Main Server connects here)`);
});

// ----------------------------------------------------
// 2. TCP Server (Device connects here directly)
// ----------------------------------------------------
const tcpServer = net.createServer((socket) => {
  const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`\n🔌 Device Connected: ${clientAddr}`);
  let buffer = "";

  socket.on("data", (chunk) => {
    console.log(`\n📦 Raw Packet [Length: ${chunk.length} bytes]:`);
    console.log("HEX:", chunk.toString("hex"));
    console.log("ASCII:", chunk.toString("latin1"));
    buffer += chunk.toString();

    // Extract complete packets between '[' and ']'
    while (buffer.includes("[") && buffer.includes("]")) {
      const start = buffer.indexOf("[");
      const end = buffer.indexOf("]", start);
      if (end === -1) break;

      const rawPacket = buffer.slice(start, end + 1);
      buffer = buffer.slice(end + 1);

      console.log(`📥 Device Data: ${rawPacket}`);

      // Protocol format: [MANUFACTURER*DEVICE_ID*LEN*CONTENT]
      const parts = rawPacket.slice(1, -1).split("*");
      if (parts.length >= 4) {
        const [mfr, deviceId, len, content] = parts;
        const command = content.split(",")[0];

        connectedDevices.set(deviceId, socket);

        // Auto-reply ACK to keep device online
        if (command === "LK") socket.write(`[${mfr}*${deviceId}*0002*LK]`);
        if (command.startsWith("AL")) socket.write(`[${mfr}*${deviceId}*0002*AL]`);
        if (command === "CONFIG") socket.write(`[${mfr}*${deviceId}*0008*CONFIG,1]`);

        // Emit packet to Main Server via Socket.IO
        io.emit("deviceData", {
          deviceId,
          command,
          rawPacket,
          content,
          receivedAt: new Date().toISOString(),
        });
      }
    }
  });

  socket.on("close", () => {
    for (const [id, s] of connectedDevices.entries()) {
      if (s === socket) {
        connectedDevices.delete(id);
        console.log(`🔌 Device [${id}] Disconnected`);
      }
    }
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err.message);
  });
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`🛰️  TCP Server running on port ${TCP_PORT} (Devices send data here)`);
});
