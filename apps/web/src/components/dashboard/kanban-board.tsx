import { useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import type { Todo, TodoStatus, Priority } from "@/hooks/use-todos";
import type { PaginationStatus } from "@/hooks/use-paginated-query";
import { TodoCard } from "./todo-card";
import {
  statusColumns,
  priorityColumns,
  type KanbanGroupBy,
  type ColumnDefinition,
} from "./constants";

interface KanbanBoardProps {
  todos: Todo[];
  groupBy: KanbanGroupBy;
  onOpenTodo: (todo: Todo) => void;
  onStatusChange: (todoId: Todo["_id"], status: TodoStatus) => void;
  onPriorityChange: (todoId: Todo["_id"], priority: Priority) => void;
  loadMore?: (count: number) => void;
  status?: PaginationStatus;
}

const ESTIMATED_CARD_HEIGHT = 100;
const LOAD_MORE_THRESHOLD = 3;
const LOAD_MORE_COUNT = 20;

export function KanbanBoard({
  todos,
  groupBy,
  onOpenTodo,
  onStatusChange,
  onPriorityChange,
  loadMore,
  status,
}: KanbanBoardProps) {
  const columns: readonly ColumnDefinition[] = groupBy === "status" ? statusColumns : priorityColumns;
  const canLoadMore = status === "CanLoadMore";
  const isLoadingMore = status === "LoadingMore";

  const handleMoveToColumn = (todo: Todo, columnId: string) => {
    if (groupBy === "status") {
      onStatusChange(todo._id, columnId as TodoStatus);
    } else {
      onPriorityChange(todo._id, columnId as Priority);
    }
  };

  const handleLoadMore = useCallback(() => {
    if (canLoadMore && !isLoadingMore && loadMore) {
      loadMore(LOAD_MORE_COUNT);
    }
  }, [canLoadMore, isLoadingMore, loadMore]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-1 min-h-0">
      {columns.map((column) => {
        const columnTodos = todos.filter(column.filter);
        return (
          <KanbanColumn
            key={column.id}
            column={column}
            todos={columnTodos}
            allColumns={columns}
            groupBy={groupBy}
            onOpenTodo={onOpenTodo}
            onStatusChange={onStatusChange}
            onMove={handleMoveToColumn}
            onLoadMore={handleLoadMore}
            canLoadMore={canLoadMore}
            isLoadingMore={isLoadingMore}
          />
        );
      })}
    </div>
  );
}

interface KanbanColumnProps {
  column: ColumnDefinition;
  todos: Todo[];
  allColumns: readonly ColumnDefinition[];
  groupBy: KanbanGroupBy;
  onOpenTodo: (todo: Todo) => void;
  onStatusChange: (todoId: Todo["_id"], status: TodoStatus) => void;
  onMove: (todo: Todo, columnId: string) => void;
  onLoadMore: () => void;
  canLoadMore: boolean;
  isLoadingMore: boolean;
}

function KanbanColumn({
  column,
  todos,
  allColumns,
  groupBy,
  onOpenTodo,
  onStatusChange,
  onMove,
  onLoadMore,
  canLoadMore,
  isLoadingMore,
}: KanbanColumnProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: todos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: 5,
    getItemKey: (index) => todos[index]._id,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Trigger load more when scrolled near the end
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;

    if (lastItem.index >= todos.length - LOAD_MORE_THRESHOLD && canLoadMore) {
      onLoadMore();
    }
  }, [virtualItems, todos.length, canLoadMore, onLoadMore]);

  return (
    <Card className="flex flex-col min-h-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          {column.label}
          <Badge variant="outline">{todos.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-2">
        {todos.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-xs">
            No tasks
          </p>
        ) : (
          <div
            ref={parentRef}
            className="h-full max-h-[calc(100vh-240px)] overflow-auto"
          >
            <div
              className="relative w-full"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualItems.map((virtualItem) => {
                const todo = todos[virtualItem.index];
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full pb-2"
                    style={{
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <TodoCard
                      todo={todo}
                      onOpen={() => onOpenTodo(todo)}
                      onStatusChange={(status) => onStatusChange(todo._id, status)}
                      groupBy={groupBy}
                      onMove={(columnId) => onMove(todo, columnId)}
                      columns={allColumns}
                      currentColumn={column.id}
                    />
                  </div>
                );
              })}
            </div>
            {isLoadingMore && (
              <div className="flex justify-center py-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
