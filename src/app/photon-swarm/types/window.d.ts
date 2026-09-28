/**
 * Type declarations for window extensions used in Photon Swarm.
 * Single source of truth — replaces former global.d.ts and core/types/window.d.ts.
 */

import type { GameEngineService } from '../core/engine/game-engine.service';
import type { CameraShakeService } from '../core/effects/camera-shake.service';
import type { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import type { EntityManagerService } from '../core/ecs/entity-manager.service';

declare global {
  interface Window {
    // Debug system
    debugLogBridge?: { log: DebugLogBridgeService['log'] };

    // Core services exposed for debugging
    gameEngine?: GameEngineService;
    cameraShake?: CameraShakeService;
    entityManager?: EntityManagerService;
    adaptiveDifficultyService?: unknown;

    // Debug inspection
    photonSwarmDebug?: {
      entityCount: number;
      fps: number;
      systemPerformance: Record<string, number>;
    };

    /** V8 garbage collection hook when the browser exposes it for diagnostics. */
    gc?: () => void;

    // Standard extensions
    performance: Performance;
    window: Window;
  }
}

export {};
