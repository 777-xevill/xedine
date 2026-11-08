import { encode } from 'uqr';

/**
 * A QR code drawn as one SVG path in the current text colour on the current background, so it follows
 * the brand tokens and prints sharp on the 58/80 mm receipt. Works in server and client components.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** What the code opens, for screen readers. */
  label: string;
  className?: string;
}) {
  const { data, size } = encode(value, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} className="fill-white" />
      <path d={d} className="fill-black" />
    </svg>
  );
}
