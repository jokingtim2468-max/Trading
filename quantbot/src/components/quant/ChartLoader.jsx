import { motion } from 'framer-motion';

const LINES = [
  'M0 30 L8 22 L16 26 L24 12 L32 18 L40 8 L48 15 L56 6 L64 12',
  'M0 22 L8 28 L16 15 L24 21 L32 9 L40 17 L48 5 L56 14 L64 8',
  'M0 26 L8 14 L16 20 L24 25 L32 11 L40 21 L48 12 L56 18 L64 4',
];

export default function ChartLoader({ className = 'w-12 h-7' }) {
  return (
    <svg viewBox="0 0 64 36" className={className} aria-label="Loading">
      <line x1="0" y1="35" x2="64" y2="35" className="stroke-border" strokeWidth="1" />
      <motion.path
        d={LINES[0]}
        animate={{ d: [...LINES, LINES[0]] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        fill="none"
        className="stroke-primary"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}