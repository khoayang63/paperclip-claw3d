import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, Pause, Play, RotateCcw, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { loadArcadeHighScore, saveArcadeHighScore } from "../model/storage";
import { useOfficeT } from "../officeCopy";

const GRID_SIZE = 14;
const TICK_MS = 145;

type Point = { x: number; y: number };
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

const INITIAL_SNAKE: Point[] = [
  { x: 6, y: 7 },
  { x: 5, y: 7 },
  { x: 4, y: 7 },
];

const INITIAL_DIR: Direction = "RIGHT";

function randomFood(occupied: readonly Point[]): Point {
  const occupiedKeys = new Set(occupied.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (!occupiedKeys.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return { x: 0, y: 0 };
  return free[Math.floor(Math.random() * free.length)]!;
}

export interface ArcadeMiniGameModalProps {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onScoreMilestone?: () => void;
}

export function ArcadeMiniGameModal({
  open,
  companyId,
  onClose,
  onScoreMilestone,
}: ArcadeMiniGameModalProps) {
  const ot = useOfficeT();
  const [snake, setSnake] = useState<Point[]>(INITIAL_SNAKE);
  const [food, setFood] = useState<Point>(() => randomFood(INITIAL_SNAKE));
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => loadArcadeHighScore(companyId));
  const [running, setRunning] = useState(true);
  const [gameOver, setGameOver] = useState(false);

  const dirRef = useRef<Direction>(INITIAL_DIR);
  const nextDirRef = useRef<Direction>(INITIAL_DIR);

  useEffect(() => {
    setHighScore(loadArcadeHighScore(companyId));
  }, [companyId]);

  const resetGame = useCallback(() => {
    dirRef.current = INITIAL_DIR;
    nextDirRef.current = INITIAL_DIR;
    setSnake(INITIAL_SNAKE);
    setFood(randomFood(INITIAL_SNAKE));
    setScore(0);
    setGameOver(false);
    setRunning(true);
  }, []);

  useEffect(() => {
    if (open) {
      resetGame();
    }
  }, [open, resetGame]);

  const queueDirection = useCallback((next: Direction) => {
    const cur = dirRef.current;
    if (
      (cur === "UP" && next === "DOWN") ||
      (cur === "DOWN" && next === "UP") ||
      (cur === "LEFT" && next === "RIGHT") ||
      (cur === "RIGHT" && next === "LEFT")
    ) {
      return;
    }
    nextDirRef.current = next;
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === "ArrowUp" || k === "w") {
        e.preventDefault();
        queueDirection("UP");
      } else if (e.key === "ArrowDown" || k === "s") {
        e.preventDefault();
        queueDirection("DOWN");
      } else if (e.key === "ArrowLeft" || k === "a") {
        e.preventDefault();
        queueDirection("LEFT");
      } else if (e.key === "ArrowRight" || k === "d") {
        e.preventDefault();
        queueDirection("RIGHT");
      } else if (e.key === " ") {
        e.preventDefault();
        if (gameOver) resetGame();
        else setRunning((r) => !r);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [gameOver, open, queueDirection, resetGame]);

  useEffect(() => {
    if (!open || !running || gameOver) return;
    const timer = window.setInterval(() => {
      dirRef.current = nextDirRef.current;
      const d = dirRef.current;
      setSnake((prev) => {
        const head = prev[0]!;
        const nextHead: Point = {
          x: head.x + (d === "RIGHT" ? 1 : d === "LEFT" ? -1 : 0),
          y: head.y + (d === "DOWN" ? 1 : d === "UP" ? -1 : 0),
        };
        if (
          nextHead.x < 0 ||
          nextHead.x >= GRID_SIZE ||
          nextHead.y < 0 ||
          nextHead.y >= GRID_SIZE ||
          prev.some((seg) => seg.x === nextHead.x && seg.y === nextHead.y)
        ) {
          setGameOver(true);
          setRunning(false);
          return prev;
        }
        const ateFood = nextHead.x === food.x && nextHead.y === food.y;
        const nextSnake = ateFood ? [nextHead, ...prev] : [nextHead, ...prev.slice(0, -1)];
        if (ateFood) {
          setScore((prevScore) => {
            const nextScore = prevScore + 10;
            if (nextScore > highScore) {
              setHighScore(nextScore);
              saveArcadeHighScore(companyId, nextScore);
            }
            return nextScore;
          });
          setFood(randomFood(nextSnake));
          onScoreMilestone?.();
        }
        return nextSnake;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [companyId, food.x, food.y, gameOver, highScore, onScoreMilestone, open, running]);

  const snakeSet = new Set(snake.map((p) => `${p.x},${p.y}`));
  const headKey = `${snake[0]!.x},${snake[0]!.y}`;
  const foodKey = `${food.x},${food.y}`;

  const cells: number[] = [];
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) cells.push(i);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Gamepad2 className="size-4 text-primary" aria-hidden />
            {ot("office3d.arcade.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Badge variant="secondary" className="font-mono">
              {ot("office3d.arcade.score")}: {score}
            </Badge>
            <Badge variant="outline" className="gap-1 font-mono">
              <Trophy className="size-3 text-amber-500" aria-hidden />
              {ot("office3d.arcade.best")}: {highScore}
            </Badge>
          </div>

          <div className="relative mx-auto w-72 rounded-lg border border-border bg-muted/50 p-2">
            <div className="grid grid-cols-14 gap-0.5">
              {cells.map((idx) => {
                const x = idx % GRID_SIZE;
                const y = Math.floor(idx / GRID_SIZE);
                const key = `${x},${y}`;
                const isHead = key === headKey;
                const isBody = snakeSet.has(key);
                const isFood = key === foodKey;
                return (
                  <div
                    key={key}
                    className={cn(
                      "aspect-square rounded-xs",
                      isHead
                        ? "bg-primary"
                        : isBody
                          ? "bg-primary/75"
                          : isFood
                            ? "bg-destructive"
                            : "bg-background/70",
                    )}
                  />
                );
              })}
            </div>
            {gameOver ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/85 backdrop-blur-xs">
                <p className="text-sm font-bold text-foreground">{ot("office3d.arcade.gameOver")}</p>
                <Button type="button" size="sm" onClick={resetGame}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  {ot("office3d.arcade.restart")}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{ot("office3d.arcade.hint")}</span>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon-xs" variant="outline" onClick={() => queueDirection("LEFT")} aria-label="Left">
                ◀
              </Button>
              <Button type="button" size="icon-xs" variant="outline" onClick={() => queueDirection("UP")} aria-label="Up">
                ▲
              </Button>
              <Button type="button" size="icon-xs" variant="outline" onClick={() => queueDirection("DOWN")} aria-label="Down">
                ▼
              </Button>
              <Button type="button" size="icon-xs" variant="outline" onClick={() => queueDirection("RIGHT")} aria-label="Right">
                ▶
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {ot("office3d.issueModal.close")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (gameOver) resetGame();
                else setRunning((r) => !r);
              }}
            >
              {running ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              {running ? ot("office3d.arcade.pause") : ot("office3d.arcade.resume")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={resetGame}>
              <RotateCcw className="size-3.5" aria-hidden />
              {ot("office3d.arcade.restart")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
