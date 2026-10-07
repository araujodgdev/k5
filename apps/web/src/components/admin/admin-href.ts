/** A section's URL with its filters; empty values are left out so the default stays a clean path. */
export function adminHref(path: string, params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null && entry[1] !== "")
    .map(([key, value]) => [key, String(value)]);
  const query = new URLSearchParams(entries);
  return query.size ? `${path}?${query}` : path;
}
