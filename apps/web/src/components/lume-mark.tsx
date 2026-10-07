import { useId, type SVGProps } from "react";

export function LumeMark(props: SVGProps<SVGSVGElement>) {
  const mask = useId();
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 818 818" width="24" height="24" fill="currentColor" stroke="none" {...props}>
    <defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="818" height="818" style={{ maskType: 'alpha' }}>
      <image href="/lume-mark.png" x="-221" y="-216" width="1254" height="1254" />
    </mask></defs>
    <rect width="818" height="818" mask={`url(#${mask})`} />
  </svg>;
}
