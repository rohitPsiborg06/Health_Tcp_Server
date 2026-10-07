# 🛰️ TCP_SERVER_NEW

A dedicated, lightweight, and robust TCP & HTTP bridge server for smartwatch communication following the **Beesure / SeTracker** protocol.

---

## 📡 Architecture

1. **Devices (Smartwatches / Trackers)**: Connect via raw TCP to port **`8000`** (`TCP_PORT`).
   - Receives automatic protocol ACKs (`LK`, `CONFIG`, `AL`, `bphrt`, `oxygen`, etc.).
   - Persistent keepalive connection (`30s` TCP probes).
2. **Real-time Data Stream (Socket.IO)**: Runs on port **`8001`** (`HTTP_PORT`).
   - Emits incoming device packets in real-time (`deviceData` event) to your main server / consumer for database storage.
3. **Users / Main Server (HealthCare Backend)**: Communicate via HTTP REST API on port **`8001`** (`HTTP_PORT`).
   - Send downlink commands (`CR`, `RESET`, `SOS`, etc.) directly to active devices.
   - Query online/connected devices in real-time.

---

## ⚡ Socket.IO Real-Time Stream (Connect & Save to DB)

Connect your backend (NestJS / Node service) to `http://localhost:8001` with your `API_SECRET_KEY`:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:8001", {
  auth: { token: "ehc_tcp_secret_key_2026" }
});

socket.on("connect", () => {
  console.log("Connected to Realtime Device Stream!");
});

// Device data is received here in real time
socket.on("deviceData", async ({ deviceId, command, content, rawPacket, receivedAt }) => {
  console.log(`Device: ${deviceId}, Command: ${command}`);

  // 👉 Save to MongoDB based on command:
  // - "UD" / "UD_LTE": Location data -> save coordinates
  // - "bphrt": BP & Heart Rate -> save vitals
  // - "oxygen": SpO2 -> save vitals
  // - "btemp2": Temperature -> save vitals
  // - "LK": Heartbeat -> update lastSeen & battery
  // - "AL": SOS Alarm -> save emergency alert
});
```

---

## 🌐 HTTP REST API Endpoints

All endpoints (except `/health`) require the `x-api-key` header (or `Authorization: Bearer <key>`).

### 1. Send Command to Device
```http
POST /api/device/command
x-api-key: ehc_tcp_secret_key_2026
Content-Type: application/json

{
  "deviceId": "8800000015",
  "command": "CR"
}
```
* **Success Response (200 OK):**
```json
{
  "success": true,
  "deviceId": "8800000015",
  "sentPacket": "[3G*8800000015*0002*CR]",
  "message": "Command sent successfully to device [8800000015]"
}
```
* **Offline Device (404 Not Found):**
```json
{
  "success": false,
  "deviceId": "8800000015",
  "error": "Device [8800000015] is offline or not connected"
}
```

### 2. List All Connected Devices
```http
GET /api/devices
```

### 3. Check Single Device Status
```http
GET /api/device/8800000015
```

### 4. Health Check
```http
GET /health
```

---

## 🚀 Running the Server

```bash
# Start server
npm start

# Development mode (auto-reload)
npm run dev
```
