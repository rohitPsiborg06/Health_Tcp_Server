# 🛰️ TCP_SERVER_NEW

A dedicated, lightweight, and robust TCP & HTTP bridge server for smartwatch communication following the **Beesure / SeTracker** protocol.

---

## 📡 Architecture

1. **Devices (Smartwatches / Trackers)**: Connect via raw TCP to port **`8000`** (`TCP_PORT`).
   - Receives automatic protocol ACKs (`LK`, `CONFIG`, `AL`, `bphrt`, `oxygen`, etc.).
   - Persistent keepalive connection (`30s` TCP probes).
2. **Users / Main Server (HealthCare Backend)**: Communicate via HTTP REST API on port **`8001`** (`HTTP_PORT`).
   - Send downlink commands (`CR`, `RESET`, `SOS`, etc.) directly to active devices.
   - Query online/connected devices in real-time.

---

## 🌐 HTTP REST API Endpoints

### 1. Send Command to Device
```http
POST /api/device/command
Content-Type: application/json

{
  "deviceId": "8800000015",
  "command": "CR",
  "mfr": "3G"
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
* **Response (200 OK):**
```json
{
  "success": true,
  "count": 1,
  "devices": [
    {
      "deviceId": "8800000015",
      "ip": "1.2.3.4:5678",
      "connectedAt": "2026-10-07T09:20:00.000Z",
      "lastSeen": "2026-10-07T09:24:00.000Z"
    }
  ]
}
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
