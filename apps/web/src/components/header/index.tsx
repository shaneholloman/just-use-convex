import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { useHeader } from "@/hooks/use-header";
import { springExpand } from "@/lib/motion";
import Header from "./header";
import { HeaderChatsDropdown } from "./chats";

const CHAT_DETAIL_PATTERN = /^\/chats\/[^/]+$/;

function useIsChatDetailRoute() {
  const { pathname } = useLocation();
  return CHAT_DETAIL_PATTERN.test(pathname);
}

export default function HeaderIndex() {
  const blockRef = useRef<HTMLDivElement>(null);
  const { setHeaderHeight } = useHeader();
  const isChatDetail = useIsChatDetailRoute();

  useEffect(() => {
    const el = blockRef.current;
    if (!el) return;

    const update = () => setHeaderHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setHeaderHeight]);

  return (
    <motion.div
      ref={blockRef}
      layout
      transition={springExpand}
      className="relative z-50 flex flex-row mt-2 items-center gap-2 w-fit mx-auto"
    >
      {/* Before slot - extensible for dynamic content */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key="header-before"
          layout
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ ...springExpand, opacity: { duration: 0.15 } }}
          className="ml-auto overflow-hidden"
          >
            {isChatDetail ? (
              <HeaderChatsDropdown />
            ) : null}
        </motion.div>
      </AnimatePresence>

      <Header />

      {/* After slot - chats dropdown when on /chats/$chatId — left-to-right */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key="header-after"
          layout
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ ...springExpand, opacity: { duration: 0.15 } }}
          className="overflow-hidden"
        >
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
