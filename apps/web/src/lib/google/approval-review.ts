import 'server-only';
import type { ApprovalRow } from '@/lib/application/approvals-service';

/** Only the owner can obtain this through the existing authenticated approval endpoint. */
export function googleApprovalReview(row: ApprovalRow): Array<{ label: string; value: string }> | null {
  if (!/^k5_(gmail|calendar|drive|docs)_/.test(row.capability_name)) return null;
  const input = JSON.parse(row.normalized_input) as { __bound?: { review?: unknown } };
  const values = input.__bound?.review;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is { label: string; value: string } =>
    value !== null && typeof value === 'object' && typeof value.label === 'string' && typeof value.value === 'string');
}
