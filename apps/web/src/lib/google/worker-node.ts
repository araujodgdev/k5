import { database as defaultDatabase, type Database } from '@/lib/database';
import { processDriveImport } from './drive/import';
import { driveReconcilers } from './drive/service';
import { gmailReconcilers, sweepExpiredMailUploads } from './gmail/service';
import { drainGoogleJobs, reconcileHandler, type JobHandlers } from './worker';
import { edgeHandlers, runEdgeMaintenance } from './worker-edge';

/** Heavy work for the Node processors: Drive imports into the Cofre and Gmail/Drive/Docs reconciliation. */
export const nodeHandlers: JobHandlers = {
  drive_import: processDriveImport,
  operation_reconcile: reconcileHandler({ ...gmailReconcilers, ...driveReconcilers }),
};

let maintenanceAt = 0;

/**
 * One pass for Node processes. `includeEdge` lets local development and Docker run the whole
 * integration without a Cloudflare Worker; in staging the Worker owns the edge queue.
 */
export async function runGoogleNodePass(input: { db?: Database; max?: number; includeEdge?: boolean } = {}) {
  const db = input.db ?? defaultDatabase;
  if (Date.now() >= maintenanceAt) {
    maintenanceAt = Date.now() + 60_000;
    if (input.includeEdge) await runEdgeMaintenance(db);
    await sweepExpiredMailUploads(50);
  }
  const max = input.max ?? 25;
  const node = await drainGoogleJobs('node', nodeHandlers, db, max);
  const edge = input.includeEdge ? await drainGoogleJobs('edge', edgeHandlers, db, max) : 0;
  return { node, edge };
}
