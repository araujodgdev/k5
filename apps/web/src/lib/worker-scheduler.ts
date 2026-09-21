type Work = () => Promise<boolean>;
type WorkerOptions = {
  processDocuments: Work;
  verifyDocuments: Work;
  maintain: Work;
  stopping: () => boolean;
  once: boolean;
  onError: (error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
};

export async function runWorkerQueues(options: WorkerOptions) {
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  async function loop(work: Work) {
    while (!options.stopping()) {
      try {
        const worked = await work();
        if (options.once || options.stopping()) break;
        if (!worked) await sleep(1500);
      } catch (error) {
        options.onError(error);
        if (options.once || options.stopping()) break;
        await sleep(5000);
      }
    }
  }
  // At most one verification is in flight in this process. Its checkpoints and leases
  // stay in processNextVerification; provider latency cannot stall the other queues.
  // Await both loops so --once and shutdown drain work already in flight.
  await Promise.all([
    loop(async () => {
      const processed = await options.processDocuments();
      const maintained = await options.maintain();
      return processed || maintained;
    }),
    loop(options.verifyDocuments),
  ]);
}
