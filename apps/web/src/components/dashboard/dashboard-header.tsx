import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { OrgStats } from "@/hooks/use-todos";

interface DashboardHeaderProps {
  stats: OrgStats | undefined;
  onCreateClick: () => void;
}

export function DashboardHeader({ stats, onCreateClick }: DashboardHeaderProps) {
  const total = stats?.total ?? 0;

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">Todos</h1>
        <p className="text-muted-foreground text-sm">
          {total} {total === 1 ? "task" : "tasks"}
          {stats?.byStatus && (
            <span className="ml-2">
              ({stats.byStatus.done} done, {stats.byStatus.inProgress} in progress)
            </span>
          )}
        </p>
      </div>
      <Button onClick={onCreateClick}>
        <Plus className="size-4" />
        New Todo
      </Button>
    </div>
  );
}
