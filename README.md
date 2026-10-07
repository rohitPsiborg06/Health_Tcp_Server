# 🛰️ TCP_SERVER_NEW

A dedicated, lightweight, and robust TCP server for direct smartwatch and IoT device communication following the Beesure / SeTracker protocol:

1. **Device Connection**: Smartwatch / GPS Tracker connects directly to raw TCP port **`8000`** (configurable via `TCP_PORT`).
2. **Packet Processing & Framing**: Extracts framed packets formatted as `[MANUFACTURER*ID*LENGTH*CONTENT]`.
3. **Automatic Protocol ACKs**: Sends required protocol acknowledgment responses (`LK`, `AL`, `CONFIG`, `bphrt`, `oxygen`, `btemp2`, `TK`, `TKQ`, `ICCID`, etc.) directly back to the device to keep the connection persistent and prevent packet resending.
4. **Keep-Alive & Persistence**: Configured with TCP keepalive (`30s`) and `noDelay` to handle cellular connections without timeouts.
5. **Configurable Inactivity Timeout**: Safely cleans up dead / ghost connections after inactivity (default `20m` via `INACTIVITY_TIMEOUT_MS`).

---

## 🚀 Running the Server

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy and customize `.env`:
```bash
cp .env.example .env
```

### 3. Start Server
```bash
# Production mode
npm start

# Development mode (auto-reload)
npm run dev
```
