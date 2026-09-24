import type { CapabilityName } from '@/lib/capabilities/contracts';

/** HTTP operation name → Google capability. Shared by the route handler, the browser client and WebMCP. */
export const googleOperations = {
  status: 'k5_google_get_status', policy: 'k5_google_get_policy', 'policy-save': 'k5_google_save_policy',
  audit: 'k5_google_list_audit', operations: 'k5_google_list_operations',
  calendars: 'k5_calendar_list_calendars', 'calendars-select': 'k5_calendar_select_calendars', 'calendar-sync': 'k5_calendar_sync_now',
  events: 'k5_calendar_list_events', event: 'k5_calendar_get_event', 'event-create': 'k5_calendar_create_event',
  'event-update': 'k5_calendar_update_event', 'event-cancel': 'k5_calendar_cancel_event', 'event-respond': 'k5_calendar_respond',
  'event-discard': 'k5_calendar_discard_pending', 'event-share': 'k5_calendar_share_event', 'event-unshare': 'k5_calendar_unshare_event',
  'shared-events': 'k5_calendar_list_shared',
  threads: 'k5_gmail_list_threads', thread: 'k5_gmail_get_thread', drafts: 'k5_gmail_list_drafts', draft: 'k5_gmail_get_draft',
  'draft-save': 'k5_gmail_save_draft', 'draft-delete': 'k5_gmail_delete_draft', send: 'k5_gmail_send', 'attachment-import': 'k5_gmail_import_attachment',
  'drive-register': 'k5_drive_register_files', 'drive-files': 'k5_drive_list_files', 'drive-file-refresh': 'k5_drive_refresh_file',
  'drive-import': 'k5_drive_import_file', 'drive-imports': 'k5_drive_list_imports', 'drive-rename': 'k5_drive_rename_file',
  'drive-version': 'k5_drive_upload_version', 'drive-permissions': 'k5_drive_list_permissions', 'drive-share': 'k5_drive_share_file',
  'drive-revoke': 'k5_drive_revoke_permission', 'docs-read': 'k5_docs_read', 'docs-edit': 'k5_docs_edit',
} as const satisfies Record<string, CapabilityName>;
export type GoogleOperation = keyof typeof googleOperations;
export type GoogleCapabilityName = (typeof googleOperations)[GoogleOperation];

export const googleOperationFor = Object.fromEntries(Object.entries(googleOperations).map(([operation, name]) => [name, operation])) as Record<GoogleCapabilityName, GoogleOperation>;

/** Every Google capability is a POST with a JSON body to its operation path. */
export function googleOperationPath(operation: GoogleOperation) { return `/api/integrations/google/${operation}`; }
