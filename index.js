import net from "net";
import http from "http";
import crypto from "crypto";
import { Server } from "socket.io";

const TCP_PORT = process.env.TCP_PORT || 8000;
const SOCKET_PORT = process.env.SOCKET_PORT || 8001;
const AES_KEY = process.env.AES_KEY || null;

// ----------------------------------------------------
// 1. Socket.IO Server (Main Server connects here)
// ----------------------------------------------------
const httpServer = http.createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

// In-memory connected devices: deviceId => tcpSocket
const connectedDevices = new Map();

io.on("connection", (socket) => {
  console.log("⚡ Main Server connected via Socket.IO");

  // Send Downlink Command from Main Server to Watch (e.g. CR, RESET, FIND, etc.)
  socket.on("sendToDevice", ({ deviceId, data }) => {
    const deviceSocket = connectedDevices.get(deviceId);
    if (deviceSocket && !deviceSocket.destroyed) {
      deviceSocket.write(data);
      console.log(`📤 Sent to Device [${deviceId}]:`, data);
    } else {
      console.log(`❌ Device [${deviceId}] is not connected`);
    }
  });

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
// 2. Parsers (Extracted from your old TCP_SERVER repository)
// ----------------------------------------------------
const deviceParsers = {
  // Position Report: UD, UD_LTE, UD_WCDMA, AL, AL_LTE
  parsePosition: (content) => {
    const parts = content.split(",");
    if (parts.length < 13) return null;

    const [
      command, date, time, gpsStatus, rawLat, latDir, rawLon, lonDir,
      speed, direction, altitude, satellites, gsmSignal, battery,
      pedometer, tumbling, deviceStatusHex, ...extras
    ] = parts;

    let latitude = parseFloat(rawLat) || 0;
    let longitude = parseFloat(rawLon) || 0;

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

  // Diagnosis / Test Status: TS
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

// ----------------------------------------------------
// 3. TCP Server (Device connects directly here)
// ----------------------------------------------------
const tcpServer = net.createServer((socket) => {
  const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`\n🔌 Device Connected: ${clientAddr}`);

  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    console.log(`\n📦 Raw Packet [Length: ${chunk.length} bytes]:`);
    console.log("HEX:", chunk.toString("hex"));

    buffer = Buffer.concat([buffer, chunk]);

    // Case A: 4P-Touch AQSH Protocol Header (0xFF 'A' 'Q' 'S' 'H')
    if (buffer.length >= 7 && buffer[0] === 0xff && buffer.subarray(1, 5).toString("ascii") === "AQSH") {
      const packetLength = buffer.readUInt16BE(5) + 5;
      if (buffer.length >= packetLength) {
        const rawPacket = buffer.subarray(0, packetLength);
        buffer = buffer.subarray(packetLength);

        console.log(`📦 [AQSH PACKET RECEIVED] Length: ${rawPacket.length} bytes`);

        // Handshake ACK to keep device online
        const deviceId = "9024506956";
        connectedDevices.set(deviceId, socket);

        console.log(`⚠️  Received encrypted AQSH packet (${rawPacket.length} bytes) from device ${deviceId}`);
        console.log(`ℹ️  To receive plain text [3G*...*UD], the watch supplier must configure the IMEI or encryption key must be provided.`);

        io.emit("deviceData", {
          protocol: "AQSH",
          deviceId,
          rawHex: rawPacket.toString("hex"),
          receivedAt: new Date().toISOString(),
        });
      }
    }

    // Case B: Standard BeeSure / SeTracker Protocol [MANUFACTURER*ID*LEN*CONTENT]
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

        connectedDevices.set(deviceId, socket);

        // Protocol Auto-ACKs
        if (command === "LK") socket.write(`[${mfr}*${deviceId}*0002*LK]`);
        if (command.startsWith("AL")) socket.write(`[${mfr}*${deviceId}*0002*AL]`);
        if (command === "CONFIG") socket.write(`[${mfr}*${deviceId}*0008*CONFIG,1]`);

        // Clean structured parsing based on command
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

        // Emit clean JSON to Main Server
        io.emit("deviceData", {
          deviceId,
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
