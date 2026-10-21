// A plain round monogram for an account or script (ranks and XP were removed to keep the accounts tab simple)
const HUES = [210, 190, 160, 260, 30, 340];
function hue(seed) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export default function RankAvatar({ seed = '', size = 48, label = '' }) {
  const letters = String(label || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const h = hue(seed || label);
  return (
    <span aria-label={label} title={label} className="shrink-0 rounded-full inline-flex items-center justify-center font-semibold select-none"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36), background: `hsl(${h} 70% 55% / .16)`, color: `hsl(${h} 80% 70%)` }}>
      {letters}
    </span>
  );
}

export function RankName() { return null; }
