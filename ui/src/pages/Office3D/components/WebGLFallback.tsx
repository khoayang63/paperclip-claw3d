import { AlertTriangle, LayoutDashboard, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import type { AgentOfficeSnapshot } from "../model/types";
import { useOfficeT } from "../officeCopy";

export interface WebGLFallbackProps {
  agents: AgentOfficeSnapshot[];
}

export function WebGLFallback({ agents }: WebGLFallbackProps) {
  const ot = useOfficeT();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-auto bg-background p-6">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-border bg-muted p-2 text-muted-foreground">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground">
              {ot("office3d.fallback.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {ot("office3d.fallback.description")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="default" size="sm">
                <Link to="/org">
                  <Network className="size-4" aria-hidden />
                  {ot("office3d.fallback.openOrg")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/dashboard">
                  <LayoutDashboard className="size-4" aria-hidden />
                  {ot("office3d.fallback.openDashboard")}
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {agents.length > 0 ? (
          <div className="mt-6 border-t border-border pt-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {agents
                .filter((a) => a.visualState !== "hidden")
                .map((agent) => (
                  <Link
                    key={agent.agentId}
                    to={`/agents/${encodeURIComponent(agentRouteRef({ id: agent.agentId, urlKey: agent.urlKey, name: agent.name }))}`}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="truncate font-medium text-foreground">{agent.name}</span>
                    <Badge variant="outline">{agent.visualState}</Badge>
                  </Link>
                ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
