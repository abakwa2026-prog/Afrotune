import { Redis } from "ioredis";

let connection: Redis | null = null;

/** Shared Redis connection for BullMQ. BullMQ requires maxRetriesPerRequest: null. */
export function getRedisConnection(): Redis {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL must be set");
  connection = new Redis(url, { maxRetriesPerRequest: null });
  return connection;
}
