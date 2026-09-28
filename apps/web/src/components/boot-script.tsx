"use client";

/**
 * A script that runs while the server's HTML is parsed, before the first paint (nav width,
 * conversation list, landing motion). React never runs a script it creates on the client, and
 * warns when it has to create one (a client navigation, or a root rebuilt after an error), so the
 * client renders it as an inert data block. The server's copy has already run by then.
 */
export function BootScript({ code }: { code: string }) {
  return <script suppressHydrationWarning type={typeof window === "undefined" ? undefined : "text/plain"} dangerouslySetInnerHTML={{ __html: code }} />;
}
