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
export const ACKS = new Map(
  Object.entries({
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
  }),
);


/**
 * Resolves the acknowledgment payload body for a given command.
 * Matches AL, AL_LTE, AL_WCDMA, etc. to 'AL'.
 */
export const getAckBody = (command) => {
  if (/^AL(_|$)/.test(command)) return "AL";
  return ACKS.get(command) ?? null;
};

/**
 * Builds a standard smartwatch framed protocol packet:
 * [MANUFACTURER*DEVICE_ID*HEX_LEN*BODY]
 */
export const buildPacket = (mfr, deviceId, body) => {
  let lenHex = Buffer.byteLength(body).toString(16).padStart(4, "0");
  lenHex = LEN_LOWERCASE ? lenHex.toLowerCase() : lenHex.toUpperCase();
  return `[${mfr}*${deviceId}*${lenHex}*${body}]`;
};

/**
 * Safely writes a payload to a socket if writable and alive.
 */
export const sendToSocket = (socket, payload) => {
  if (socket && socket.writable && !socket.destroyed) {
    socket.write(payload);
    return true;
  }
  return false;
};
