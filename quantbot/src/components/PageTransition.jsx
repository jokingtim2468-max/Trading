import { useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { pageOrigin, MOTION, reducedMotion } from '@/lib/clickOrigin';

// One page: grows out of the middle of the window, and shrinks back into it when leaving
function Page({ children }) {
  const [origin] = useState(() => pageOrigin());
  const [content] = useState(children); // freeze so the leaving page keeps its own content
  return (
    <motion.div
      initial={{ opacity: 0, scale: MOTION.from }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: MOTION.from }}
      transition={{ duration: reducedMotion() ? 0 : MOTION.duration, ease: MOTION.ease }}
      style={{ transformOrigin: origin }}
    >
      {content}
    </motion.div>
  );
}

export default function PageTransition() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence mode="wait">
      <Page key={pathname}>{outlet}</Page>
    </AnimatePresence>
  );
}