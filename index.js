import net from "net";
import http from "http";
import { Server } from "socket.io";

const TCP_PORT = process.env.TCP_PORT || 8000;
const SOCKET_PORT = process.env.SOCKET_PORT || 8001;

// --------------------------------------------------------------------------
// 1. Socket.IO Server (Main Server Bridge)
// --------------------------------------------------------------------------
const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// In-memory active devices map: deviceId => { socket, ip, connectedAt, lastSeen }
const connectedDevices = new Map();

io.on("connection", (socket) => {
  console.log("⚡ Main Server connected via Socket.IO");

  // Send Downlink Command from Main Server to Watch (e.g. CR, RESET, LK, etc.)
  socket.on("sendToDevice", ({ deviceId, data, command }, callback) => {
    const entry = connectedDevices.get(deviceId);
    if (!entry || entry.socket.destroyed) {
      console.log(`❌ Device [${deviceId}] is not connected`);
      if (typeof callback === "function") {
        callback({ success: false, error: `Device ${deviceId} is offline` });
      }
      return;
    }

    // Format packet if raw command string is given without brackets
    let packetToSend = data;
    if (!packetToSend && command) {
      const lenHex = command.length.toString(16).toUpperCase().padStart(4, "0");
      packetToSend = `[3G*${deviceId}*${lenHex}*${command}]`;
    }

    if (packetToSend) {
      entry.socket.write(packetToSend);
      console.log(`📤 Sent to Device [${deviceId}]:`, packetToSend);
      if (typeof callback === "function") {
        callback({ success: true, sent: packetToSend });
      }
    }
  });

  // Query connected device IDs and status
  socket.on("getConnectedDevices", (callback) => {
    if (typeof callback === "function") {
      const list = Array.from(connectedDevices.entries()).map(([id, info]) => ({
        deviceId: id,
        ip: info.ip,
        connectedAt: info.connectedAt,
        lastSeen: info.lastSeen,
      }));
      callback(list);
    }
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`📡 Socket.IO Bridge running on port ${SOCKET_PORT} (Main Server connects here)`);
});

// --------------------------------------------------------------------------
// 2. Parsers for Open BeeSure / 3G / SeTracker Protocol
// --------------------------------------------------------------------------
const deviceParsers = {
  // Position Report: UD, UD_LTE, UD_WCDMA, AL, AL_LTE, AL_WCDMA
  parsePosition: (content) => {
    const parts = content.split(",");
    if (parts.length < 13) return null;

    const [
      command, date, time, gpsStatus, rawLat, latDir, rawLon, lonDir,
      speed, direction, altitude, satellites, gsmSignal, battery,
      pedometer, tumbling, deviceStatusHex, ...extras
    ] = parts;

    const latitude = parseFloat(rawLat) || 0;
    const longitude = parseFloat(rawLon) || 0;

    return {
      command,
      date,
      time,
      isGpsValid: gpsStatus === "A",
      latitude: latDir === "S" ? -latitude : latitude,
      longitude: lonDir === "W" ? -longitude : longitude,
      speed: parseFloat(speed) || 0,
      direction: parseFloat(direction) || 0,
      altitude: parseFloat(altitude) || 0,
      satellites: parseInt(satellites, 10) || 0,
      gsmSignal: parseInt(gsmSignal, 10) || 0,
      battery: parseInt(battery, 10) || 0,
      pedometer: parseInt(pedometer, 10) || 0,
      tumbling: parseInt(tumbling, 10) || 0,
      deviceStatusHex: deviceStatusHex || "0",
    };
  },

  // Heartbeat: LK
  parseHeartbeat: (content) => {
    const parts = content.split(",");
    return {
      command: "LK",
      steps: parseInt(parts[1], 10) || 0,
      tumbling: parseInt(parts[2], 10) || 0,
      battery: parseInt(parts[3], 10) || 0,
    };
  },

  // Blood Pressure & Heart Rate: bphrt
  parseBpHrt: (content) => {
    const [command, systolicBP, diastolicBP, heartRate] = content.split(",");
    return {
      command,
      systolicBP: parseInt(systolicBP, 10) || 0,
      diastolicBP: parseInt(diastolicBP, 10) || 0,
      heartRate: parseInt(heartRate, 10) || 0,
    };
  },

  // SpO2 Blood Oxygen: oxygen
  parseSpo2: (content) => {
    const [command, type, spo2] = content.split(",");
    return {
      command,
      type,
      spo2: parseInt(spo2, 10) || 0,
    };
  },

  // Diagnostic / Status: TS
  parseTS: (content) => {
    const pairs = content.split(/[,;]/);
    const res = { command: "TS" };
    pairs.forEach((p) => {
      const [k, v] = p.split(":");
      if (k && v !== undefined) res[k.trim()] = v.trim();
    });
    return res;
  },
};

// --------------------------------------------------------------------------
// 3. TCP Server (Smartwatch connects directly here)
// --------------------------------------------------------------------------
const tcpServer = net.createServer((socket) => {
  const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`\n🔌 Device Connected: ${clientAddr}`);

  // Keep cellular IoT connection alive through carrier NAT firewalls
  socket.setKeepAlive(true, 30000);
  socket.setNoDelay(true);

  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Trim noise/garbage preceding the start delimiter '['
    const firstBracket = buffer.indexOf(0x5b); // '['
    if (firstBracket > 0) {
      buffer = buffer.subarray(firstBracket);
    } else if (firstBracket === -1) {
      // Discard buffer if it grows too large without a valid packet start
      if (buffer.length > 4096) buffer = Buffer.alloc(0);
      return;
    }

    // Process all framed packets: [MANUFACTURER*ID*LENGTH*CONTENT]
    let startIdx = buffer.indexOf(0x5b); // '['
    let endIdx = buffer.indexOf(0x5d);   // ']'

    while (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const packetBuf = buffer.subarray(startIdx, endIdx + 1);
      buffer = buffer.subarray(endIdx + 1);

      const rawPacket = packetBuf.toString("ascii");
      console.log(`📥 [DEVICE PACKET]: ${rawPacket}`);

      const parts = rawPacket.slice(1, -1).split("*");
      if (parts.length >= 4) {
        const [mfr, deviceId, lenHex, content] = parts;
        const command = content.split(",")[0];

        // Register / update device connection
        connectedDevices.set(deviceId, {
          socket,
          ip: clientAddr,
          connectedAt: connectedDevices.get(deviceId)?.connectedAt || new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });

        // Protocol Required Auto-ACKs
        if (command === "LK") socket.write(`[${mfr}*${deviceId}*0002*LK]`);
        if (command.startsWith("AL")) socket.write(`[${mfr}*${deviceId}*0002*AL]`);
        if (command === "CONFIG") socket.write(`[${mfr}*${deviceId}*0008*CONFIG,1]`);

        // Structured parsing
        let parsedData = null;
        if (["UD", "UD_LTE", "UD_WCDMA", "AL", "AL_LTE", "AL_WCDMA"].includes(command)) {
          parsedData = deviceParsers.parsePosition(content);
        } else if (command === "LK") {
          parsedData = deviceParsers.parseHeartbeat(content);
        } else if (command === "bphrt") {
          parsedData = deviceParsers.parseBpHrt(content);
        } else if (command === "oxygen") {
          parsedData = deviceParsers.parseSpo2(content);
        } else if (command === "TS") {
          parsedData = deviceParsers.parseTS(content);
        }

        // Emit clean structured event to Main Server
        io.emit("deviceData", {
          deviceId,
          manufacturer: mfr,
          command,
          rawPacket,
          content,
          data: parsedData,
          receivedAt: new Date().toISOString(),
        });
      }

      startIdx = buffer.indexOf(0x5b);
      endIdx = buffer.indexOf(0x5d);
    }
  });

  socket.on("close", () => {
    for (const [id, info] of connectedDevices.entries()) {
      if (info.socket === socket) {
        connectedDevices.delete(id);
        console.log(`🔌 Device [${id}] Disconnected`);
      }
    }
  });

  socket.on("error", (err) => {
    console.error(`Socket error from ${clientAddr}:`, err.message);
  });
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`🛰️  TCP Server running on port ${TCP_PORT} (Devices send data here)`);
});

// --------------------------------------------------------------------------
// 4. Graceful Shutdown
// --------------------------------------------------------------------------
const shutdown = () => {
  console.log("\nShutting down gracefully...");
  tcpServer.close(() => console.log("TCP server closed."));
  httpServer.close(() => console.log("Socket.IO server closed."));
  for (const { socket } of connectedDevices.values()) {
    socket.destroy();
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
