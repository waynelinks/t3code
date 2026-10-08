import type { EnvironmentId } from "@t3tools/contracts";
import { CheckCircle2Icon } from "lucide-react";
import type { ReactNode } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";

export interface SpecCheck {
  readonly id: string;
  readonly what: string;
}

/**
 * A spec to read before approving it, in a drawer on the right: the spec as formatted text, then its
 * acceptance checks, with the approve and discard buttons at the bottom (asked: "it's difficult to read").
 */
export function SpecSheet({
  open,
  onOpenChange,
  title,
  spec,
  checks,
  environmentId,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  spec: string | null | undefined;
  checks: ReadonlyArray<SpecCheck>;
  environmentId: EnvironmentId;
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup
        side="right"
        className="flex w-[min(70vw,46rem)] max-w-[46rem] flex-col gap-0 p-0 max-[760px]:w-[min(94vw,46rem)]"
      >
        <SheetHeader className="shrink-0 border-b border-border/50 px-5 py-4 text-left">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription>
            The spec Chief wrote from the code. Nothing is built until you approve it.
            {checks.length > 0
              ? ` ${checks.length} acceptance ${checks.length === 1 ? "check" : "checks"} decide when it is done.`
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {spec ? (
            <ChatMarkdown
              text={spec}
              cwd={undefined}
              environmentId={environmentId}
              className="text-sm"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No spec text yet.</p>
          )}
          {checks.length > 0 ? (
            <section className="mt-6">
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Acceptance checks
              </h3>
              <ol className="flex flex-col gap-1.5">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm">
                    <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="font-medium">{c.id}</span>
                      {c.what ? (
                        <span className="text-muted-foreground [overflow-wrap:anywhere]">
                          {" "}
                          · {c.what}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
            {footer}
          </div>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
