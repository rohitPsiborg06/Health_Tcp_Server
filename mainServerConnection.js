import { io } from "socket.io-client";

// Connect to the TCP Server's Socket.IO bridge
const socket = io("http://localhost:8001");

socket.on("connect", () => {
  console.log("✅ Main Server connected to TCP Socket.IO bridge!");
});

// Device data is received here
socket.on("deviceData", ({ deviceId, command, rawPacket, content, receivedAt }) => {
  console.log(`\n📥 [DEVICE DATA] Device: ${deviceId}, Command: ${command}`);
  console.log("Timestamp:", receivedAt);
  console.log("Raw Packet:", rawPacket);
  console.log("Content:", content);

  // 👉 1. Save to your database here in your Main Server

  // 👉 2. Example: Send a command back to the device (e.g., Request Instant Location 'CR')
  // Format: [MANUFACTURER*DEVICE_ID*LEN*CONTENT]
  if (command === "LK") {
    console.log(`🚀 Sending instant location command (CR) to device ${deviceId}...`);
    socket.emit("sendToDevice", {
      deviceId,
      data: `[3G*${deviceId}*0002*CR]`,
    });
  }
});
