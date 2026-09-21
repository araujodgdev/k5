import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { database } from "./database";
import { ensureOfficeForUser } from "./offices";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export const requireWorkspace = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const office = await ensureOfficeForUser(database, session.user);
  // The session id travels with the context so a privileged step taken later in a long turn can
  // check that the session still exists, instead of trusting a check made minutes earlier.
  return { user: session.user, office, session: { id: session.session?.id } };
});
