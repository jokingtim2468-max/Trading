import { useId } from 'react';
import { levelFromXp, tierOf, ACCOUNT_STEP } from '@/lib/copy';

// Small numbers from a seed string, the same every time (picture colours and pattern)
function hashes(seed) {
  let h = 2166136261;
  const out = [];
  for (let i = 0; i < 16; i++) {
    for (const c of `${seed}:${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    out.push((h >>> 0) / 4294967296);
  }
  return out;
}

// Tier ornaments outside the ring: higher tiers add a crest, then wings, then a crown (QuantBot's own design)
function Ornaments({ index, color }) {
  const parts = [];
  if (index >= 3) parts.push(<path key="crest" d="M42 5 L50 -1 L58 5 L50 9 Z" fill={color} />);
  if (index >= 5) {
    parts.push(<path key="wl" d="M7 44 L-1 38 L1 50 L-1 62 L7 56 Z" fill={color} opacity="0.9" />);
    parts.push(<path key="wr" d="M93 44 L101 38 L99 50 L101 62 L93 56 Z" fill={color} opacity="0.9" />);
  }
  if (index >= 7) {
    parts.push(<path key="crown" d="M34 9 L38 -3 L44 5 L50 -6 L56 5 L62 -3 L66 9 Z" fill={color} />);
  }
  if (index >= 2) {
    for (const a of [45, 135, 225, 315]) {
      const r = (a * Math.PI) / 180;
      parts.push(<circle key={a} cx={50 + 45 * Math.cos(r)} cy={50 + 45 * Math.sin(r)} r={index >= 6 ? 2.6 : 2} fill={color} />);
    }
  }
  return parts;
}

// An account's or script's picture with its rank ring: the ring fills with XP towards the next level,
// its colour and ornaments show the tier, and the badge shows the level
export default function RankAvatar({ seed = '', xp = 0, step = ACCOUNT_STEP, size = 48, label = '' }) {
  const id = useId().replace(/:/g, '');
  const lv = levelFromXp(Number(xp) || 0, step);
  const tier = tierOf(lv.level);
  const h = hashes(seed || label || 'quantbot');
  const hue = Math.floor(h[0] * 360);
  const hue2 = (hue + 40 + Math.floor(h[1] * 120)) % 360;
  // 5 x 5 mirrored pattern
  const cells = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (h[2 + y * 3 + x] > 0.5 || (y === 2 && x === 2)) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  }
  const circ = 2 * Math.PI * 40;
  const title = `${tier.name}${tier.division ? ` ${tier.division}` : ''} · level ${lv.level} · ${Math.round(lv.into)}/${lv.need} XP to the next level`;

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} title={title} data-tier={tier.name} data-level={lv.level}>
      <svg viewBox="-8 -10 116 118" width={size} height={size} role="img" aria-label={`${label ? `${label}: ` : ''}${title}`} className={tier.index >= 7 ? 'drop-shadow-[0_0_6px_rgba(255,93,115,0.45)]' : ''}>
        <defs>
          <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`hsl(${hue} 70% 45%)`} />
            <stop offset="1" stopColor={`hsl(${hue2} 65% 30%)`} />
          </linearGradient>
          <clipPath id={`clip${id}`}><circle cx="50" cy="50" r="34" /></clipPath>
        </defs>
        <circle cx="50" cy="50" r="34" fill={`url(#bg${id})`} />
        <g clipPath={`url(#clip${id})`} fill="white" opacity="0.85">
          {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={26 + x * 9.6} y={26 + y * 9.6} width="9.6" height="9.6" rx="1.5" />)}
        </g>
        <circle cx="50" cy="50" r="40" fill="none" stroke={tier.color} strokeOpacity="0.25" strokeWidth="6" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={tier.color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${circ * Math.max(0.02, lv.progress)} ${circ}`} transform="rotate(-90 50 50)" />
        <Ornaments index={tier.index} color={tier.color} />
      </svg>
      <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 rounded-full px-1.5 text-[9px] font-semibold leading-[14px] tabular-nums text-black shadow"
        style={{ background: tier.color }}>{lv.level}</span>
    </span>
  );
}

export function RankName({ xp = 0, step = ACCOUNT_STEP, className = '' }) {
  const lv = levelFromXp(Number(xp) || 0, step);
  const tier = tierOf(lv.level);
  return <span className={className} style={{ color: tier.color }}>{tier.name}{tier.division ? ` ${tier.division}` : ''}</span>;
}
