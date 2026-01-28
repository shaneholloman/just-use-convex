import { memo, useCallback, useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const CopyButton = memo(function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [text]);

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={handleCopy}
        className="inline-flex items-center justify-center rounded-md p-1 hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={copied ? "Copied" : "Copy message"}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </TooltipTrigger>
      <TooltipContent>
        <p>{copied ? "Copied!" : "Copy message"}</p>
      </TooltipContent>
    </Tooltip>
  );
});
