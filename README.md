# 🛰️ TCP_SERVER_NEW (Simple & Lightweight)

A clean and simple TCP server that bridges your **GPS / IoT Device** to your **Main Server**:

1. **Device (GPS Watch/Tracker)** connects to raw TCP port **`8000`**.
2. **TCP Server** extracts packets and sends automatic ACK responses (`LK`, `AL`, `CONFIG`) so the device remains online.
3. **Socket.IO Bridge** (port **`8001`**) immediately emits the data to your Main Server:
   ```javascript
   io.emit("deviceData", { deviceId, command, rawPacket, content, receivedAt });
   ```
4. Your **Main Server** connects to `http://localhost:8001`, reads `deviceData`, and saves it to your database.

---

## 🚀 Running the Project

### 1. Start the Server (with Nodemon)
```bash
npm start
```

### 2. Listen in your Main Server
```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:8001");

socket.on("deviceData", ({ deviceId, command, rawPacket, content }) => {
  console.log(`Device: ${deviceId}, Command: ${command}`);
  console.log("Raw Packet:", rawPacket);
  console.log("Content:", content);

  // 👉 Save to your MongoDB or process data here in your Main Server!
});
```

### 3. Send Downlink Commands to Device
```javascript
// Send any command or raw string to a connected device via Socket.IO
socket.emit("sendToDevice", {
  deviceId: "8899776655",
  data: "[3G*8899776655*0005*RESET]"
});
```

### 4. Test Locally with Simulator
In a separate terminal:
```bash
node test.js
```
