import { LEN_LOWERCASE } from "./config.js";

// --------------------------------------------------------------------------
// Protocol Constants & Auto-ACK Definitions
// --------------------------------------------------------------------------
export const START = 0x5b; // '['
export const END = 0x5d;   // ']'

/**
 * Required auto-ACKs for Smartwatch protocol.
 * Without these, the device will resend the packet repeatedly or report upload failed.
 */
export const ACKS = Object.freeze({
  LK: "LK",
  CONFIG: "CONFIG,1",
  bphrt: "bphrt",
  oxygen: "oxygen,1",
  btemp2: "btemp2",
  TK: "TK,1",
  TKQ: "TKQ",
  TKQ2: "TKQ2",
  ICCID: "ICCID2,1",
  ICCID1: "ICCID2,1",
  GETFACEOPEN: "GETFACEOPEN,0",
  appcontacttel: "appcontacttel,0",
  DSSYNCUP: "DSSYNCUP,1",
  WIFIINFOUP: "WIFIINFOUP,1",
});

/**
 * Resolves the acknowledgment payload body for a given command.
 * Matches AL, AL_LTE, AL_WCDMA, etc. to 'AL'.
 */
export const getAckBody = (command) => {
  if (command === "AL" || (command && command.startsWith("AL_"))) return "AL";
  return ACKS[command] ?? null;
};

/**
 * Builds a standard smartwatch framed protocol packet:
 * [MANUFACTURER*DEVICE_ID*HEX_LEN*BODY]
 */
export const buildPacket = (mfr, deviceId, body) => {
  let lenHex = Buffer.byteLength(body).toString(16).padStart(4, "0");
  if (!LEN_LOWERCASE) lenHex = lenHex.toUpperCase();
  return `[${mfr}*${deviceId}*${lenHex}*${body}]`;
};

/**
 * Safely writes a payload to a socket if writable and alive.
 */
export const sendToSocket = (socket, payload) => {
  if (socket && socket.writable && !socket.destroyed) {
    socket.write(payload);
    console.log(`🚀 [SERVER RESP]: ${payload}`);
    return true;
  }
  return false;
};
