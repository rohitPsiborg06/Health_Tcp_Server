import net from "net";

const DEVICE_ID = "8899776655";
const MANUFACTURER = "3G";

console.log(`🤖 Simulator connecting as device [${DEVICE_ID}] to 127.0.0.1:8000...`);

let heartbeatInterval;

const client = net.createConnection({ port: 8000, host: "127.0.0.1" }, () => {
  console.log("✅ Simulator connected! Staying connected persistently (like a real device)...\n");

  // 1. Initial Heartbeat
  client.write(`[${MANUFACTURER}*${DEVICE_ID}*0011*LK,1420,0,85]`);

  // 2. Realtime Location after 3 seconds
  setTimeout(() => {
    if (!client.destroyed) {
      client.write(`[${MANUFACTURER}*${DEVICE_ID}*007F*UD_LTE,051026,113000,A,28.6139,N,77.2090,E,0.0,90,216.0,8,95,85,1420,0,00000000,1,1,404,45,1234,5678,90]`);
    }
  }, 3000);

  // 3. Periodic Heartbeat every 30 seconds to keep connection alive permanently
  heartbeatInterval = setInterval(() => {
    if (!client.destroyed) {
      console.log("💓 Sending periodic heartbeat (LK)...");
      client.write(`[${MANUFACTURER}*${DEVICE_ID}*0011*LK,1420,0,85]`);
    }
  }, 30000);
});

// Listen for incoming commands sent from Server to Device
client.on("data", (data) => {
  const message = data.toString();
  console.log(`📩 [DEVICE RECEIVED COMMAND FROM SERVER]: ${message}`);

  // If server sends RESET / REBOOT
  if (message.includes("RESET") || message.includes("REBOOT")) {
    console.log("🔄 Device simulated rebooting...");
  }
  // If server sends CR (Locate)
  if (message.includes("CR")) {
    console.log("📍 Device received locate command! Simulating GPS lock...");
  }
});

client.on("close", () => {
  clearInterval(heartbeatInterval);
  console.log("🔌 Simulator connection closed.");
});

client.on("error", (err) => {
  clearInterval(heartbeatInterval);
  console.error("❌ Simulator error:", err.message);
});
