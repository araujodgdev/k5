"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useShell } from "@/components/shell/shell-context";

/**
 * A link that opens its route as a canvas tab inside the office shell, the way the board opens a
 * case or a page; elsewhere, and for a new-tab click, it is a plain link.
 */
export function CanvasLink({ href, tab, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string; tab: string }) {
  const shell = useShell();
  function open(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (!shell || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    shell.open(href, tab);
  }
  return <Link href={href} onClick={open} {...props} />;
}
