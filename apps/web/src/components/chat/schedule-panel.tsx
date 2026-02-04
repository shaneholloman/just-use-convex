import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { Schedule } from "agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SchedulePanel = memo(function SchedulePanel({
  agent,
  chatTitle,
  chatId,
}: {
  agent:
    | {
        call: (method: string, args?: unknown[]) => Promise<unknown>;
        addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
        removeEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
      }
    | null;
  chatTitle?: string | null;
  chatId?: string | null;
}) {
  const [mode, setMode] = useState<"after" | "at" | "every">("after");
  const [prompt, setPrompt] = useState("");
  const [label, setLabel] = useState("");
  const [runAt, setRunAt] = useState("");
  const [afterAmount, setAfterAmount] = useState("30");
  const [afterUnit, setAfterUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [everyAmount, setEveryAmount] = useState("1");
  const [everyUnit, setEveryUnit] = useState<"minutes" | "hours" | "days">("days");
  const [everyTime, setEveryTime] = useState("09:00");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [executions, setExecutions] = useState<
    Array<{ id: string; label: string; timestamp: number }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatTimestamp = useCallback((timestampSeconds: number) => {
    const date = new Date(timestampSeconds * 1000);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }, []);

  const refreshSchedules = useCallback(async () => {
    if (!agent) return;
    setIsLoading(true);
    try {
      const result = (await agent.call("listSchedules")) as Schedule[];
      setSchedules(result);
    } finally {
      setIsLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    refreshSchedules();
  }, [refreshSchedules]);

  useEffect(() => {
    setExecutions([]);
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          payload?: { label?: string | null; prompt?: string };
          timestamp?: number;
          workflowId?: string;
        };
        if (data.type !== "schedule_executed") return;
        const timestamp = data.timestamp ?? Date.now();
        setExecutions((prev) => [
          {
            id: data.workflowId ?? crypto.randomUUID(),
            label: data.payload?.label || data.payload?.prompt || "Scheduled job",
            timestamp,
          },
          ...prev,
        ]);
        refreshSchedules();
      } catch {}
    };

    agent.addEventListener("message", handleMessage);
    return () => agent.removeEventListener("message", handleMessage);
  }, [agent, refreshSchedules]);

  const sortedSchedules = useMemo(
    () => [...schedules].sort((a, b) => a.time - b.time),
    [schedules]
  );

  const formatDelay = useCallback((seconds: number | null | undefined) => {
    if (!seconds || !Number.isFinite(seconds)) return null;
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return `${days}d`;
  }, []);

  const formatCron = useCallback((cron: string) => {
    const trimmed = cron.trim();
    const everyMinutes = trimmed.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
    if (everyMinutes) return `Every ${everyMinutes[1]} minutes`;
    const everyHours = trimmed.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
    if (everyHours) return `Every ${everyHours[1]} hours`;
    const everyDays = trimmed.match(/^(\d+)\s+(\d+)\s+\*\/(\d+)\s+\*\s+\*$/);
    if (everyDays) {
      const [, minute, hour, dayStep] = everyDays;
      return `Every ${dayStep} days at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    const daily = trimmed.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
    if (daily) {
      const [, minute, hour] = daily;
      return `Every day at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    return null;
  }, []);

  const handleCreate = useCallback(async () => {
    if (!agent || !prompt.trim()) return;
    if (mode === "at" && !runAt) return;
    setIsSubmitting(true);
    try {
      let type: "delay" | "date" | "cron";
      let value: number | string;
      if (mode === "after") {
        const amount = Number(afterAmount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        const seconds =
          afterUnit === "minutes"
            ? amount * 60
            : afterUnit === "hours"
            ? amount * 60 * 60
            : amount * 60 * 60 * 24;
        type = "delay";
        value = seconds;
      } else if (mode === "at") {
        type = "date";
        value = new Date(runAt).toISOString();
      } else {
        const amount = Number(everyAmount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        type = "cron";
        if (everyUnit === "minutes") {
          value = `*/${amount} * * * *`;
        } else if (everyUnit === "hours") {
          value = `0 */${amount} * * *`;
        } else {
          const [hour, minute] = everyTime.split(":").map((part) => Number(part));
          const safeHour = Number.isFinite(hour) ? hour : 9;
          const safeMinute = Number.isFinite(minute) ? minute : 0;
          value = `${safeMinute} ${safeHour} */${amount} * *`;
        }
      }

      await agent.call("createSchedule", [
        {
          type,
          value,
          prompt,
          label: label.trim() || null,
        },
      ]);
      setPrompt("");
      setLabel("");
      refreshSchedules();
    } finally {
      setIsSubmitting(false);
    }
  }, [
    agent,
    afterAmount,
    afterUnit,
    everyAmount,
    everyTime,
    everyUnit,
    label,
    mode,
    prompt,
    refreshSchedules,
    runAt,
  ]);

  const handleCancel = useCallback(
    async (id: string) => {
      if (!agent) return;
      await agent.call("cancelScheduleById", [id]);
      refreshSchedules();
    },
    [agent, refreshSchedules]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedules</CardTitle>
        <CardDescription>
          Create one-time or recurring jobs for the active agent.
        </CardDescription>
        {(chatTitle || chatId) && (
          <div className="text-xs text-muted-foreground">
            Active chat: <span className="font-medium text-foreground">{chatTitle || "Untitled chat"}</span>
            {chatId ? <span className="ml-2 opacity-70">({chatId})</span> : null}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
          <TabsList className="w-full">
            <TabsTrigger value="after">Run after</TabsTrigger>
            <TabsTrigger value="every">Run every</TabsTrigger>
            <TabsTrigger value="at">Run at</TabsTrigger>
          </TabsList>
          <TabsContent value="after">
            <div className="flex flex-col gap-2">
              <Label>Run after</Label>
              <div className="grid gap-2 md:grid-cols-[160px_160px]">
                <Input
                  type="number"
                  min={1}
                  value={afterAmount}
                  onChange={(event) => setAfterAmount(event.target.value)}
                  placeholder="30"
                />
                <Select value={afterUnit} onValueChange={(value) => setAfterUnit(value as typeof afterUnit)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Example: 30 minutes.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="every">
            <div className="flex flex-col gap-2">
              <Label>Run every</Label>
              <div className="grid gap-2 md:grid-cols-[160px_160px_1fr]">
                <Input
                  type="number"
                  min={1}
                  value={everyAmount}
                  onChange={(event) => setEveryAmount(event.target.value)}
                  placeholder="1"
                />
                <Select value={everyUnit} onValueChange={(value) => setEveryUnit(value as typeof everyUnit)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
                {everyUnit === "days" && (
                  <Input
                    type="time"
                    value={everyTime}
                    onChange={(event) => setEveryTime(event.target.value)}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                We’ll translate this into a schedule automatically.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="at">
            <div className="flex flex-col gap-2">
              <Label>Run at</Label>
              <Input
                type="datetime-local"
                value={runAt}
                onChange={(event) => setRunAt(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Runs once at the selected time.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex flex-col gap-2">
          <Label>Label</Label>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Morning summary"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Task</Label>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Summarize yesterday's updates from the conversation."
          />
        </div>

        <div className="flex items-center justify-end">
          <Button onClick={handleCreate} disabled={!prompt.trim() || isSubmitting}>
            Create schedule
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Active schedules ({sortedSchedules.length})
            </span>
            <Button variant="ghost" size="xs" onClick={refreshSchedules} disabled={isLoading}>
              Refresh
            </Button>
          </div>

          {isLoading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!isLoading && sortedSchedules.length === 0 && (
            <div className="text-xs text-muted-foreground">No schedules yet.</div>
          )}

          {!isLoading &&
            sortedSchedules.map((schedule) => {
              const payload = schedule.payload as { label?: string | null; prompt?: string } | null;
              const displayLabel = payload?.label || payload?.prompt || schedule.callback;
              const cronSummary =
                "cron" in schedule && typeof schedule.cron === "string"
                  ? formatCron(schedule.cron)
                  : null;
              const delaySummary =
                "delayInSeconds" in schedule ? formatDelay(schedule.delayInSeconds) : null;
              return (
                <div
                  key={schedule.id}
                  className="border-border/60 bg-muted/20 flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{displayLabel}</span>
                      <Badge variant="outline">{schedule.type}</Badge>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap gap-2">
                      <span>Next run: {formatTimestamp(schedule.time)}</span>
                      {cronSummary && <span>{cronSummary}</span>}
                      {!cronSummary && "cron" in schedule && <span>Cron: {schedule.cron}</span>}
                      {delaySummary && <span>Delay: {delaySummary}</span>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleCancel(schedule.id)}
                  >
                    Cancel
                  </Button>
                </div>
              );
            })}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Recent runs</span>
          {executions.length === 0 && (
            <div className="text-xs text-muted-foreground">No executions yet.</div>
          )}
          {executions.slice(0, 5).map((execution) => (
            <div
              key={execution.id}
              className="border-border/60 bg-muted/10 flex items-center justify-between rounded-md border px-3 py-2 text-xs"
            >
              <span className="font-medium">{execution.label}</span>
              <span className="text-muted-foreground">
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(execution.timestamp))}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
});

export { SchedulePanel };
