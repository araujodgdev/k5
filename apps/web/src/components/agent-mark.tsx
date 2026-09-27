import type { SVGProps } from "react";
import { tisesPaths } from "@/components/tises-paths";

/** The agent's mark: the Tises T in one color (currentColor), for icons such as the nav row. */
export function AgentMark(props: SVGProps<SVGSVGElement>) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="none" {...props}>
    <path d={tisesPaths.arm} />
    <path d={tisesPaths.body} />
    <path d={tisesPaths.beam} />
  </svg>;
}
