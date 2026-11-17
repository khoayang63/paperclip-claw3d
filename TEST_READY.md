# TEST_READY — 3D Virtual AI Company Simulator ("3D Office" tab)

## Test Runner
- Command: `pnpm --filter @paperclipai/ui exec vitest run src/__tests__/office-3d-e2e.test.tsx`
- Expected: all tests pass with exit code 0

## Coverage Summary
| Tier | Count | Description |
|------|------:|-------------|
| 1. Feature Coverage | 55 | >=5 per feature across 11 features |
| 2. Boundary & Corner | 30 | >=5 per feature area across 6 areas |
| 3. Cross-Feature | 10 | Pairwise inter-system interaction combinations |
| 4. Real-World Application | 5 | Sprint lifecycle, bug escalation, standup, story handoff, idle lounge |
| **Total** | **100** | **100% Passing** |

## Full Test Suite Command (All 3D Office Suites)
```sh
pnpm --filter @paperclipai/ui exec vitest run src/__tests__/office-3d-e2e.test.tsx src/__tests__/office-agents-and-pathfinding.test.tsx src/__tests__/office-screen-and-speech.test.tsx src/__tests__/camera-controller-stress.test.ts src/__tests__/office-scene-lifecycle-stress.test.tsx src/__tests__/dijkstra-pathfinding-stress.test.ts src/__tests__/agent-navigation-lifecycle-stress.test.tsx src/__tests__/screen-texture-stress.test.ts src/__tests__/speech-billboard-stress.test.tsx
```
*Expected: 9 test files, 218+ tests passing.*
