import { Queue } from "bullmq";
import {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  QUEUE_NAME,
  ENABLE_QUEUE,
} from "./config.js";

let telemetryQueue = null;

let lastErrorLogTime = 0;
const ERROR_LOG_INTERVAL_MS = 10000; // Log at most once every 10s if Redis is down

if (ENABLE_QUEUE) {
  try {
    telemetryQueue = new Queue(QUEUE_NAME, {
      connection: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
        maxRetriesPerRequest: null,
      },
    });

    telemetryQueue.on("error", (err) => {
      const now = Date.now();
      if (now - lastErrorLogTime > ERROR_LOG_INTERVAL_MS) {
        lastErrorLogTime = now;
        console.error(`❌ [Queue Error] ${QUEUE_NAME}:`, err.message);
      }
    });

    console.log(
      `📦 Queue initialized: [${QUEUE_NAME}] via Redis at ${REDIS_HOST}:${REDIS_PORT}`,
    );
  } catch (err) {
    console.error(`❌ Failed to initialize BullMQ queue:`, err.message);
  }
}

// Commands that require high priority processing (SOS, Fall, Low Battery alarms)
const HIGH_PRIORITY_COMMANDS = new Set(["AL", "AL_LTE", "AL_WCDMA", "SOS"]);

/**
 * Pushes raw framed packet to the persistent queue.
 * Resolves within ~1-2ms to avoid holding up the TCP socket loop.
 */
export const enqueueDevicePacket = async (data) => {
  if (!telemetryQueue) return false;

  const isAlarm = HIGH_PRIORITY_COMMANDS.has(data.command);
  const priority = isAlarm ? 1 : 10;

  try {
    await telemetryQueue.add(
      isAlarm ? "alarm_packet" : "telemetry_packet",
      data,
      {
        priority,
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );
    return true;
  } catch (err) {
    const now = Date.now();
    if (now - lastErrorLogTime > ERROR_LOG_INTERVAL_MS) {
      lastErrorLogTime = now;
      console.error(
        `⚠️ Failed to enqueue packet for Device [${data.deviceId}]:`,
        err.message,
      );
    }
    return false;
  }
};


/**
 * Gracefully shuts down the Queue connection
 */
export const closeQueue = async () => {
  if (telemetryQueue) {
    try {
      await telemetryQueue.close();
      console.log(`📦 Queue [${QUEUE_NAME}] closed.`);
    } catch (err) {
      console.error("Error closing queue:", err.message);
    }
  }
};
