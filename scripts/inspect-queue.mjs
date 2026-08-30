import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:") });
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("afrotune-incoming-message", { connection });

const counts = await queue.getJobCounts();
console.log("counts:", counts);

for (const state of ["completed", "failed", "active", "waiting", "delayed"]) {
  const jobs = await queue.getJobs([state], 0, 20);
  for (const job of jobs) {
    console.log({
      state,
      id: job.id,
      name: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace?.slice(-1),
      data: job.data,
      timestamp: new Date(job.timestamp).toISOString(),
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    });
  }
}

await queue.close();
await connection.quit();
