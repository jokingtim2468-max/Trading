import { useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { pageOrigin } from '@/lib/clickOrigin';

// One page: grows out of the clicked spot, and shrinks back into that same spot when leaving
function Page({ children }) {
  const [origin] = useState(() => pageOrigin());
  const [content] = useState(children); // freeze so the leaving page keeps its own content
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.05 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
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