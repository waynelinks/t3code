import type { SVGProps } from "react";

/** Chief's mark: the orange tile with a white gate and check (assets/chief.svg in the chief repo). */
export function ChiefMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" role="img" {...props}>
      <defs>
        <linearGradient id="chief-mark-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ED6C47" />
          <stop offset="1" stopColor="#B7472A" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#chief-mark-tile)" />
      <path d="M11 20 H53" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" />
      <path d="M18 20 V53 M46 20 V53" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" />
      <path
        d="M24 38 L30.5 44.5 L41 31"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.95"
      />
    </svg>
  );
}
