import { atomWithStorage } from "jotai/utils";
import type { ViewMode } from "@/components/dashboard/constants";

export const viewModeAtom = atomWithStorage<ViewMode>("dashboard-view-mode", "kanban", undefined, {
  getOnInit: true,
});
