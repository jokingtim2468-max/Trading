const CANDLES = [
  { x: 5, wick: [12, 30], body: [17, 27], o: 'opacity-60' },
  { x: 15.5, wick: [7, 25], body: [11, 21], o: 'opacity-80' },
  { x: 26, wick: [3, 21], body: [6, 16], o: 'opacity-100' },
];

export default function LogoMark({ className = 'w-9 h-9' }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      {CANDLES.map((c) => (
        <g key={c.x} className={`fill-primary ${c.o}`}>
          <rect x={c.x + 2} y={c.wick[0]} width="1.5" height={c.wick[1] - c.wick[0]} rx="0.75" />
          <rect x={c.x} y={c.body[0]} width="5.5" height={c.body[1] - c.body[0]} rx="1.2" />
        </g>
      ))}
    </svg>
  );
}