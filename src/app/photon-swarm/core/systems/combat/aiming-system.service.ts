import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { HealthComponent, PlayerControlledComponent, PositionComponent } from '@photon/components';
import { PLAYER_CONFIG } from '@photon/config/game-constants';
import { findNearestAliveEnemy } from '../../utils/targeting';
import { PlayerService } from '../../player/player.service';

/**
 * Aiming projection line component
 */
export class AimingProjectionComponent {
  public targetX: number;
  public targetY: number;
  public isActive: boolean;
  public projectilePreviewCount: number;
  public alpha: number;
  public lineColor: string;
  public dotColor: string;

  constructor(...args: unknown[]) {
    this.targetX = (args[0] as number) ?? 0;
    this.targetY = (args[1] as number) ?? 0;
    this.isActive = (args[2] as boolean) ?? false;
    this.projectilePreviewCount = (args[3] as number) ?? 5;
    this.alpha = (args[4] as number) ?? 0.6;
    this.lineColor = (args[5] as string) ?? '#00ffff';
    this.dotColor = (args[6] as string) ?? '#00cccc';
  }
}

/**
 * Aiming System - provides visual projection for projectile trajectories
 *
 * Shows where projectiles will travel when player aims, including:
 * - Trajectory line from player to target
 * - Preview dots showing projectile positions
 * - Fade-out effects for better visual appeal
 */
@Injectable({
  providedIn: 'root',
})
export class AimingSystemService implements System {
  private aimingProjectionEntity: number | null = null;
  private isActive = false;
  private targetPosition = { x: 0, y: 0 };

  // Focus Fire target cache — recompute every N frames instead of every frame
  private static readonly FOCUS_TARGET_RECOMPUTE_INTERVAL = 3;
  private cachedFocusTarget: { x: number; y: number; entityId: number } | null = null;
  private focusTargetFrameCounter = 0;
  private wasFocusFiring = false;

  // Trajectory point cache — avoid recomputing when nothing moved
  private cachedPoints: Array<{ x: number; y: number; alpha: number }> = [];
  private cachedPlayerX = 0;
  private cachedPlayerY = 0;
  private cachedTargetX = 0;
  private cachedTargetY = 0;

  constructor(private playerService: PlayerService) {}

  /**
   * Initialize the aiming system
   */
  init(entityManager: EntityManager): void {
    // Create the aiming projection entity
    this.createAimingProjection(entityManager);
  }

  /**
   * Update aiming projection based on mouse/target position
   */
  update(_deltaTime: number, entityManager: EntityManager): void {
    if (!this.aimingProjectionEntity) {
      this.createAimingProjection(entityManager);
      return;
    }

    const aimingComp = entityManager.getComponent(this.aimingProjectionEntity, AimingProjectionComponent);
    if (!aimingComp) return;

    // S5: Force trajectory visible during Focus Fire — always show aim line when
    //     focus fire is active and the player is in shooting mode, using the last
    //     known target position so the line persists even without a fresh mouse event.
    const isFocusFiring = this.playerService.getIsFocusFiring();
    const effectiveActive = this.isActive || (isFocusFiring && this.playerService.getIsShiftFiring());

    // Update target position if aiming is active
    if (effectiveActive) {
      // Focus Fire auto-locks trajectory on nearest enemy (cached — recompute every N frames)
      if (isFocusFiring) {
        // Invalidate cache on Focus Fire re-activation so we don't target a stale enemy
        if (!this.wasFocusFiring) {
          this.cachedFocusTarget = null;
          this.focusTargetFrameCounter = 0;
        }

        // Validate cached target is still alive — force recompute if target died
        if (this.cachedFocusTarget) {
          const health = entityManager.getComponent(this.cachedFocusTarget.entityId, HealthComponent);
          if (!health || health.health <= 0) {
            this.cachedFocusTarget = null;
          }
        }

        const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
        const playerPos =
          playerEntities.length > 0 ? entityManager.getComponent(playerEntities[0], PositionComponent) : null;
        this.focusTargetFrameCounter++;
        const shouldRecompute =
          !this.cachedFocusTarget ||
          this.focusTargetFrameCounter >= AimingSystemService.FOCUS_TARGET_RECOMPUTE_INTERVAL;
        if (shouldRecompute && playerPos) {
          this.cachedFocusTarget = findNearestAliveEnemy(playerPos.x, playerPos.y, entityManager);
          this.focusTargetFrameCounter = 0;
        }
        const nearest = this.cachedFocusTarget;
        if (nearest) {
          aimingComp.targetX = nearest.x;
          aimingComp.targetY = nearest.y;
        } else {
          // No enemies — fall back to cursor position
          aimingComp.targetX = this.targetPosition.x;
          aimingComp.targetY = this.targetPosition.y;
        }
        aimingComp.lineColor = PLAYER_CONFIG.FOCUS_FIRE.COLORS.AIM_LINE;
        aimingComp.dotColor = PLAYER_CONFIG.FOCUS_FIRE.COLORS.AIM_DOT;
      } else {
        aimingComp.targetX = this.targetPosition.x;
        aimingComp.targetY = this.targetPosition.y;
        aimingComp.lineColor = '#00ffff';
        aimingComp.dotColor = '#00cccc';
      }
      aimingComp.isActive = true;
    } else {
      aimingComp.isActive = false;
    }

    this.wasFocusFiring = isFocusFiring;
  }

  /**
   * Set target position for aiming projection
   */
  setTargetPosition(x: number, y: number): void {
    this.targetPosition.x = x;
    this.targetPosition.y = y;
    this.isActive = true;
  }

  /**
   * Hide aiming projection
   */
  hideProjection(): void {
    this.isActive = false;
  }

  /**
   * Get the cached Focus Fire target. Used by weapon-firing-system to avoid
   * redundant O(n) enemy scans — both systems always target the same entity.
   */
  getCachedFocusTarget(): { x: number; y: number; entityId: number } | null {
    return this.cachedFocusTarget;
  }

  /**
   * Invalidate the cached Focus Fire target (e.g., when Focus Fire is toggled off).
   */
  invalidateFocusTarget(): void {
    this.cachedFocusTarget = null;
    this.focusTargetFrameCounter = 0;
  }

  /**
   * Get projectile trajectory points for rendering
   */
  getTrajectoryPoints(entityManager: EntityManager): Array<{ x: number; y: number; alpha: number }> {
    if (!this.isActive || !this.aimingProjectionEntity) return [];

    // Find player position
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    if (playerEntities.length === 0) return [];

    const playerPos = entityManager.getComponent(playerEntities[0], PositionComponent);
    if (!playerPos) return [];

    const aimingComp = entityManager.getComponent(this.aimingProjectionEntity, AimingProjectionComponent);
    if (!aimingComp || !aimingComp.isActive) return [];

    // Cache check — skip recomputation if nothing moved
    const tx = aimingComp.targetX;
    const ty = aimingComp.targetY;
    const px = playerPos.x;
    const py = playerPos.y;
    if (
      this.cachedPoints.length > 0 &&
      tx === this.cachedTargetX &&
      ty === this.cachedTargetY &&
      px === this.cachedPlayerX &&
      py === this.cachedPlayerY
    ) {
      return this.cachedPoints;
    }

    // Calculate trajectory
    const dx = tx - px;
    const dy = ty - py;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 10) {
      this.cachedPoints.length = 0;
      return this.cachedPoints;
    }

    // Normalize direction
    const dirX = dx / distance;
    const dirY = dy / distance;

    const maxDistance = Math.min(distance, 800); // Limit projection distance

    // Reuse cached array — resize without allocation when point count matches
    const pointCount = aimingComp.projectilePreviewCount;
    const stepDistance = maxDistance / pointCount;
    this.cachedPoints.length = pointCount;

    for (let i = 0; i < pointCount; i++) {
      const stepDist = stepDistance * (i + 1);
      const alpha = Math.max(0.1, 1 - ((i + 1) / pointCount) * 0.8) * aimingComp.alpha;

      if (this.cachedPoints[i]) {
        this.cachedPoints[i].x = px + dirX * stepDist;
        this.cachedPoints[i].y = py + dirY * stepDist;
        this.cachedPoints[i].alpha = alpha;
      } else {
        this.cachedPoints[i] = { x: px + dirX * stepDist, y: py + dirY * stepDist, alpha };
      }
    }

    this.cachedPlayerX = px;
    this.cachedPlayerY = py;
    this.cachedTargetX = tx;
    this.cachedTargetY = ty;

    return this.cachedPoints;
  }

  /**
   * Get trajectory line points for rendering
   */
  getTrajectoryLine(
    entityManager: EntityManager
  ): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
    if (!this.isActive || !this.aimingProjectionEntity) return null;

    // Find player position
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    if (playerEntities.length === 0) return null;

    const playerPos = entityManager.getComponent(playerEntities[0], PositionComponent);
    if (!playerPos) return null;

    const aimingComp = entityManager.getComponent(this.aimingProjectionEntity, AimingProjectionComponent);
    if (!aimingComp || !aimingComp.isActive) return null;

    // Calculate line end point (limited distance)
    const dx = aimingComp.targetX - playerPos.x;
    const dy = aimingComp.targetY - playerPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 10) return null;

    const maxDistance = Math.min(distance, 600);
    const dirX = dx / distance;
    const dirY = dy / distance;

    return {
      start: { x: playerPos.x, y: playerPos.y },
      end: {
        x: playerPos.x + dirX * maxDistance,
        y: playerPos.y + dirY * maxDistance,
      },
    };
  }

  /**
   * Create the aiming projection entity
   */
  private createAimingProjection(entityManager: EntityManager): void {
    if (this.aimingProjectionEntity) return;

    this.aimingProjectionEntity = entityManager.createEntity();
    entityManager.addComponent(this.aimingProjectionEntity, new AimingProjectionComponent());
  }

  /** Clear entity-linked state without making this root service unusable. */
  reset(): void {
    this.isActive = false;
    this.aimingProjectionEntity = null;
    this.cachedFocusTarget = null;
    this.focusTargetFrameCounter = 0;
    this.wasFocusFiring = false;
    this.cachedPoints.length = 0;
  }

  /** Cleanup when system is destroyed. */
  destroy(): void {
    this.reset();
  }
}
