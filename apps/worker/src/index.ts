import "./loadRootEnv.js";
import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES, type GenerationJob } from "@afrotune/queue";
import { loadEnv } from "./env.js";
import { processIncomingMessage } from "./processors/incomingMessage.js";
import { processPaymentVerification } from "./processors/paymentVerification.js";
import { processGeneration } from "./processors/generation.js";
import { handleTerminalGenerationFailure } from "./lib/generationFailure.js";

const env = loadEnv();
const connection = getRedisConnection();

const incomingMessageWorker = new Worker(QUEUE_NAMES.incomingMessage, processIncomingMessage, {
  connection,
  concurrency: 10,
});

const paymentVerificationWorker = new Worker(
  QUEUE_NAMES.paymentVerification,
  processPaymentVerification,
  { connection, concurrency: 10 },
);

// Lower concurrency: each job holds an FFmpeg process and polls an external
// API for minutes at a time.
const generationWorker = new Worker(QUEUE_NAMES.generation, processGeneration, {
  connection,
  concurrency: 3,
});

generationWorker.on("failed", async (job, err) => {
  if (!job) return;
  const attemptsMade = job.attemptsMade;
  const maxAttempts = job.opts.attempts ?? 1;
  if (attemptsMade >= maxAttempts) {
    await handleTerminalGenerationFailure(job.data as GenerationJob, err as Error);
  }
});

for (const worker of [incomingMessageWorker, paymentVerificationWorker, generationWorker]) {
  worker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error(`[${worker.name}] worker error`, err);
  });

  // Job-level failures otherwise fail silently on the console - this was the
  // gap that made a real bug (a non-retryable send error quietly consuming
  // all 5 default retry attempts) invisible during testing.
  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[${worker.name}] job ${job?.id} (${job?.name}) failed on attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 1}:`,
      err.message,
    );
  });
}

// eslint-disable-next-line no-console
console.log(`AfroTune worker started (env=${env.NODE_ENV})`);
