import "server-only";
import { auth } from "./auth";
import { database } from "./database";
import { authorizePlatformRequest, isPlatformAdmin } from "./platform-core";

export function requirePlatformRequest(request: Request, options: { mutation?: boolean } = {}) {
  return authorizePlatformRequest(database, (headers) => auth.api.getSession({ headers }), request, options);
}

export function userHasPlatformAccess(userId: string): boolean {
  return isPlatformAdmin(database, userId);
}

export async function requirePlatformPage() {
  const { getSession } = await import("./session");
  const session = await getSession();
  if (!session) return null;
  if (!isPlatformAdmin(database, session.user.id)) return null;
  return { user: session.user, db: database };
}
