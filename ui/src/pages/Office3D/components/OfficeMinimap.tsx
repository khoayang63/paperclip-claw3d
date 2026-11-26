import type {
  AgentOfficeSnapshot,
  AgentVisualState,
  FloorConfig,
  LiveAgentPosition,
  OfficePaletteKey,
} from "../model/types";

export interface OfficeMinimapProps {
  floor: FloorConfig;
  playerPos: { x: number; z: number };
  agentsById: Record<string, AgentOfficeSnapshot>;
  agentPositions?: Record<string, LiveAgentPosition>;
  onTeleportCell: (cell: [number, number]) => void;
}

const PALETTE_FILL: Record<OfficePaletteKey, string> = {
  slate: "var(--office-palette-slate)",
  sand: "var(--office-palette-sand)",
  sage: "var(--office-palette-sage)",
  sky: "var(--office-palette-sky)",
  rose: "var(--office-palette-rose)",
  amber: "var(--office-palette-amber)",
  graphite: "var(--office-palette-graphite)",
};

function agentDotFill(state: AgentVisualState): string {
  switch (state) {
    case "error":
    case "paused_budget":
      return "var(--office-status-critical)";
    case "coding":
      return "var(--office-status-coding)";
    case "thinking":
      return "var(--office-status-thinking)";
    case "waiting":
    case "paused":
    case "awaiting_hire":
      return "var(--office-status-warning)";
    case "meeting":
      return "var(--office-status-healthy)";
    default:
      return "var(--office-status-idle)";
  }
}

export function OfficeMinimap({
  floor,
  playerPos,
  agentsById,
  agentPositions,
  onTeleportCell,
}: OfficeMinimapProps) {
  const [w, d] = floor.gridSize;
  const outdoorPadSouth = 5;
  const viewH = d + outdoorPadSouth;
  const clampedPlayerX = Math.max(0.7, Math.min(w - 0.7, playerPos.x));
  const clampedPlayerZ = Math.max(0.7, Math.min(viewH - 0.7, playerPos.z));

  return (
    <div className="office-minimap pointer-events-auto rounded-lg border border-border bg-card/90 p-2 shadow-md backdrop-blur-sm">
      <svg
        viewBox={`0 0 ${w} ${viewH}`}
        className="h-full w-full cursor-crosshair rounded-sm bg-muted/60"
        role="img"
        aria-label={floor.name}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const gx = Math.max(0, Math.min(w - 1, Math.floor(((e.clientX - rect.left) / rect.width) * w)));
          const gz = Math.max(0, Math.min(viewH - 1, Math.floor(((e.clientY - rect.top) / rect.height) * viewH)));
          onTeleportCell([gx, gz]);
        }}
      >
        {/* South balcony / entrance plaza indicator */}
        <rect
          x={w / 2 - 5}
          y={d}
          width={10}
          height={4}
          fill="var(--muted)"
          fillOpacity={0.65}
          stroke="var(--border)"
          strokeWidth={0.2}
        />
        <rect
          x={w / 2 - 1.5}
          y={d - 0.35}
          width={3}
          height={0.7}
          fill="var(--office-screen-on)"
          fillOpacity={0.75}
        />

        {floor.rooms.map((room) => (
          <rect
            key={room.id}
            x={room.bounds.minX}
            y={room.bounds.minZ}
            width={room.bounds.maxX - room.bounds.minX + 1}
            height={room.bounds.maxZ - room.bounds.minZ + 1}
            fill={PALETTE_FILL[room.floorPalette]}
            fillOpacity={0.38}
            stroke="var(--border)"
            strokeWidth={0.25}
          />
        ))}

        {floor.elevatorCell ? (
          <rect
            x={floor.elevatorCell[0]}
            y={floor.elevatorCell[1]}
            width={1}
            height={1}
            fill="var(--office-elevator)"
          />
        ) : null}

        {floor.desks.map((desk) => {
          const agent = desk.assignedAgentId ? agentsById[desk.assignedAgentId] : undefined;
          const livePos = desk.assignedAgentId ? agentPositions?.[desk.assignedAgentId] : undefined;
          const ax = livePos ? livePos.x : desk.x + 0.5;
          const az = livePos ? livePos.z : desk.z + 0.5;
          return (
            <g key={desk.id}>
              <rect
                x={desk.x + 0.15}
                y={desk.z + 0.15}
                width={0.7}
                height={0.7}
                fill="var(--muted-foreground)"
                fillOpacity={0.35}
              />
              {agent && agent.visualState !== "hidden" ? (
                <circle
                  cx={ax}
                  cy={az}
                  r={livePos?.moving ? 0.72 : 0.65}
                  fill={agentDotFill(agent.visualState)}
                  stroke={livePos?.moving ? "var(--foreground)" : "var(--background)"}
                  strokeWidth={livePos?.moving ? 0.25 : 0.2}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    onTeleportCell([Math.floor(ax), Math.floor(az)]);
                  }}
                >
                  <title>{`${agent.name} (${agent.visualState})`}</title>
                </circle>
              ) : null}
            </g>
          );
        })}

        <circle
          cx={clampedPlayerX}
          cy={clampedPlayerZ}
          r={0.6}
          fill="var(--office-status-healthy)"
          stroke="var(--foreground)"
          strokeWidth={0.25}
        />
      </svg>
    </div>
  );
}
