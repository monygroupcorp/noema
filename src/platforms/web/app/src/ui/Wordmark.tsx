// Vendored from @mony/design components/wordmark (v0.1.21), pinned to the NOEMA brand
// (the app is single-brand, so the ThemeProvider dependency is dropped). The mark:
// a lit hemisphere inside an ever-present ring + "NOEMA" in Martian Mono — the
// engineered ad/hero lockup. Text inherits currentColor; the hemisphere stays on-brand.
// Do not hand-edit the design intent here — mirror changes from the module.
import type { SVGProps } from 'react';

interface WordmarkProps extends Omit<SVGProps<SVGSVGElement>, 'height' | 'width'> {
  height?: number;
  /** 'lockup' = hemisphere + NOEMA wordmark; 'symbol' = the hemisphere mark only. */
  variant?: 'lockup' | 'symbol';
  title?: string;
}

export function Wordmark({ height = 32, variant = 'lockup', title = 'noema', ...rest }: WordmarkProps) {
  const symbol = variant === 'symbol';
  const w = symbol ? 32 : 200;
  const h = 48;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      height={height}
      width={(height * w) / h}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <defs>
        <linearGradient id="ds-noema-grad" x1="0" y1="0.5" x2="1" y2="0.5">
          <stop offset="0%" stopColor="#8fb4ff" />
          <stop offset="100%" stopColor="#3f63d8" />
        </linearGradient>
      </defs>
      {/* lit hemisphere + ever-present frame; hidden half is transparent */}
      <g transform="translate(16,24)">
        <path d="M0,-13 A13 13 0 0 0 0,13 Z" fill="url(#ds-noema-grad)" />
        <circle r="13" fill="none" stroke="#5b8cff" strokeWidth="1.1" />
      </g>
      {!symbol && (
        <text
          x="40"
          y="31"
          fontFamily="'Martian Mono', ui-monospace, monospace"
          fontSize="20"
          fontWeight="600"
          letterSpacing="3"
          fill="currentColor"
        >
          NOEMA
        </text>
      )}
    </svg>
  );
}
