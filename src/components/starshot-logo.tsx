import { cn } from "@/lib/utils";

export function StarshotWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1 text-sm text-foreground", className)}>
      <AstroidIcon className="size-4 text-primary" />
      <span data-slot="wordmark-text" className="truncate font-mono">
        starshot
      </span>
    </span>
  );
}

function AstroidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="-2 -2 28 28" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M12 2.25c1.36 4.44 3.31 6.39 7.75 7.75a2.1 2.1 0 0 1 0 4c-4.44 1.36-6.39 3.31-7.75 7.75a2.1 2.1 0 0 1-4 0c-1.36-4.44-3.31-6.39-7.75-7.75a2.1 2.1 0 0 1 0-4C4.69 8.64 6.64 6.69 8 2.25a2.1 2.1 0 0 1 4 0Z"
      />
    </svg>
  );
}
