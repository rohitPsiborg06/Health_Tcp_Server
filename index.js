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
// 2. Protocol Parser Helper Functions
// ----------------------------------------------------
function parseLocationPacket(content) {
  // Format: UD/UD_LTE,date,time,status,lat,lat_dir,lon,lon_dir,speed,direction,altitude,satellites,battery,signal,...
  const parts = content.split(",");
  if (parts.length < 13) return null;

  const [cmd, date, time, status, rawLat, latDir, rawLon, lonDir, speed, direction, altitude, satellites, battery, signal] = parts;

  let latitude = parseFloat(rawLat);
  let longitude = parseFloat(rawLon);

  return {
    command: cmd,
    date,
    time,
    isValid: status === "A",
    latitude: latDir === "S" ? -latitude : latitude,
    longitude: lonDir === "W" ? -longitude : longitude,
    speed: parseFloat(speed) || 0,
    direction: parseFloat(direction) || 0,
    altitude: parseFloat(altitude) || 0,
    satellites: parseInt(satellites, 10) || 0,
    battery: parseInt(battery, 10) || 0,
    signal: parseInt(signal, 10) || 0,
  };
}

function parseHeartbeatPacket(content) {
  // Format: LK,step,sleep_tumbling,battery_percent
  const parts = content.split(",");
  return {
    steps: parseInt(parts[1], 10) || 0,
    sleepTumbling: parseInt(parts[2], 10) || 0,
    battery: parseInt(parts[3], 10) || 0,
  };
}

// ----------------------------------------------------
// 3. TCP Server (Watch connects directly here)
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

        let decryptedText = null;
        if (AES_KEY && rawPacket.length > 16) {
          try {
            const decipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(AES_KEY, "utf8"), rawPacket.subarray(0, 16));
            decryptedText = Buffer.concat([decipher.update(rawPacket.subarray(16)), decipher.final()]).toString("ascii");
            console.log("🔓 Decrypted AQSH Data:", decryptedText);
          } catch (err) {
            console.log("Decryption pending valid AES key");
          }
        }

        io.emit("deviceData", {
          protocol: "AQSH",
          rawHex: rawPacket.toString("hex"),
          decrypted: decryptedText,
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
        const [mfr, deviceId, len, content] = parts;
        const command = content.split(",")[0];

        connectedDevices.set(deviceId, socket);

        // Protocol Auto-ACKs
        if (command === "LK") socket.write(`[${mfr}*${deviceId}*0002*LK]`);
        if (command.startsWith("AL")) socket.write(`[${mfr}*${deviceId}*0002*AL]`);
        if (command === "CONFIG") socket.write(`[${mfr}*${deviceId}*0008*CONFIG,1]`);

        // Structured parsing
        let parsed = null;
        if (command === "UD" || command === "UD_LTE" || command === "UD2") {
          parsed = parseLocationPacket(content);
        } else if (command === "LK") {
          parsed = parseHeartbeatPacket(content);
        }

        // Emit clean JSON to Main Server
        io.emit("deviceData", {
          deviceId,
          command,
          rawPacket,
          content,
          data: parsed,
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

/*
// ====================================================
// [LEGACY CODE ARCHIVE - PREVIOUS BASIC IMPLEMENTATION]
// ====================================================
const tcpServerOld = net.createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("[") && buffer.includes("]")) {
      const start = buffer.indexOf("[");
      const end = buffer.indexOf("]", start);
      if (end === -1) break;
      const rawPacket = buffer.slice(start, end + 1);
      buffer = buffer.slice(end + 1);
      const parts = rawPacket.slice(1, -1).split("*");
      if (parts.length >= 4) {
        const [mfr, deviceId, len, content] = parts;
        const command = content.split(",")[0];
        connectedDevices.set(deviceId, socket);
        if (command === "LK") socket.write(`[${mfr}*${deviceId}*0002*LK]`);
        if (command.startsWith("AL")) socket.write(`[${mfr}*${deviceId}*0002*AL]`);
        if (command === "CONFIG") socket.write(`[${mfr}*${deviceId}*0008*CONFIG,1]`);
        io.emit("deviceData", { deviceId, command, rawPacket, content, receivedAt: new Date().toISOString() });
      }
    }
  });
});
*/
