import { useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MOTION, reducedMotion } from '@/lib/clickOrigin';

// One page: fades in while sliding up a little, and fades out sliding up when leaving
function Page({ children }) {
  const [content] = useState(children); // freeze so the leaving page keeps its own content
  return (
    <motion.div
      data-page
      initial={{ opacity: 0, y: MOTION.slide }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -MOTION.slide / 2 }}
      transition={{ duration: reducedMotion() ? 0 : MOTION.duration, ease: MOTION.ease }}
    >
      {content}
    </motion.div>
  );
}

// The Strategy Lab's tabs each have their own URL but are one page: keep it mounted (and a running test alive)
const LAB = new Set(['/strategy-lab', '/strategy-converter', '/strategy-tester', '/market-lab']);

export default function PageTransition() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence mode="wait">
      <Page key={LAB.has(pathname) ? '/strategy-lab' : pathname}>{outlet}</Page>
    </AnimatePresence>
  );
}