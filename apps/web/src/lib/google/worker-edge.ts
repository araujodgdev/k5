import type { Database } from '@/lib/database';
import { refreshCalendarList, renewCalendarChannel, scheduleCalendarWork, syncCalendar } from './calendar/sync';
import { calendarReconcilers } from './calendar/service';
import { drainGoogleJobs, googleMaintenance, reconcileHandler, type JobHandlers } from './worker';

/** Light work that fits the integrations Worker: calendar sync, channels and calendar reconciliation. */
export const edgeHandlers: JobHandlers = {
  calendar_list: refreshCalendarList,
  calendar_sync: syncCalendar,
  calendar_push: syncCalendar,
  calendar_watch: renewCalendarChannel,
  operation_reconcile: reconcileHandler(calendarReconcilers),
};

export async function runEdgeMaintenance(db: Database) {
  const base = await googleMaintenance(db);
  return { ...base, scheduled: await scheduleCalendarWork(db) };
}

export function drainEdgeJobs(db: Database, max = 25, deadline?: number) {
  return drainGoogleJobs('edge', edgeHandlers, db, max, deadline);
}
