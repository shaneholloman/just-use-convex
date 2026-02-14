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
    <div ref={blockRef} className="relative z-50 flex flex-row mt-2 items-center gap-2 w-fit mx-auto">
      {/* Before slot - extensible for dynamic content */}
      <AnimatePresence mode="wait">
        {isChatDetail ? (
          <motion.div
            key="chats"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ...springExpand, opacity: { duration: 0.15 } }}
            className="overflow-hidden"
          >
            <HeaderChatsDropdown />
          </motion.div>
        ) : null}
      </AnimatePresence>
      
      <Header />

      {/* After slot - chats dropdown when on /chats/$chatId */}
    </div>
  );
}
