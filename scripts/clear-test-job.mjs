import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:") });
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("afrotune-incoming-message", { connection });
await queue.clean(0, 1000, "failed");
console.log("cleared failed jobs");
await queue.close();
await connection.quit();
