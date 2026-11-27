// The bluetardigrade mark for the console (same figure as lib/brand-logo.ts
// draws for the sign-in pages). Decorative: the link or text around it
// carries the name.
import { LOGO_BODY, LOGO_COLOR, LOGO_EYES, LOGO_SMILE, LOGO_VIEWBOX } from '@/lib/brand-logo'

export function TardigradeMark({ size = 32, color = LOGO_COLOR, className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox={LOGO_VIEWBOX}
      width={size}
      height={Math.round((size * 52) / 64)}
      fill="none"
      stroke={color}
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={LOGO_BODY} />
      <path d={LOGO_SMILE} strokeWidth="2.6" />
      {LOGO_EYES.map(([cx, cy]) => (
        <circle key={cx} cx={cx} cy={cy} r="1.9" fill={color} stroke="none" />
      ))}
    </svg>
  )
}
