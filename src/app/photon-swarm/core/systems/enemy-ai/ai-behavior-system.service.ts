import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import {
  AIControlledComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  TerritorialGuardianComponent,
  WeaponComponent,
} from '@photon/components';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { AI_BEHAVIOR_CONFIG } from '@photon/config/game-constants';
import { AudioService } from '../../audio/audio.service';

@Injectable({ providedIn: 'root' })
export class AIBehaviorSystemService implements System {
  _entityManager!: EntityManager;
  private playerPosition: { x: number; y: number } | null = null;
  private playerEntityId: number | null = null;
  private behaviorUpdateCounter = 0;

  private readonly BEHAVIOR_UPDATE_INTERVAL = AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL;

  /**
   * JITTER FIX: Per-behavior smoothing factors for wanderDirection updates.
   * Instead of snapping to new direction each update cycle (causes oscillation when
   * blended with separation in EnemyMovementSystem), we lerp toward the target direction.
   *
   * Low values = slow convergence (deliberate, heavy movement)
   * High values = fast convergence (twitchy, reactive movement)
   */
  private readonly DIRECTION_SMOOTHING: Record<BehaviorPattern, number> = {
    [BehaviorPattern.Idle]: 0.5,
    [BehaviorPattern.Direct]: 0.5,
    [BehaviorPattern.Flank]: 0.5,
    [BehaviorPattern.Orbit]: 0.5,
    [BehaviorPattern.Retreat]: 0.6,
    [BehaviorPattern.Wander]: 0.4,
    [BehaviorPattern.Grouping]: 0.5,
    [BehaviorPattern.Ranged]: 0.4,
    [BehaviorPattern.Sniper]: 0.2,
    [BehaviorPattern.Charger]: 0.3,
    [BehaviorPattern.Swarm]: 0.8,
    [BehaviorPattern.Aggressive]: 0.7,
    [BehaviorPattern.Boss]: 0.35,
    [BehaviorPattern.Disruptor]: 0.4, // Deliberate orbiting movement
    [BehaviorPattern.Sentinel]: 0.25, // Slow, deliberate advance — heavy shield carrier
    [BehaviorPattern.TerritorialGuardian]: 0.3,
  };

  constructor(private audio: AudioService) {}

  init(entityManager: EntityManager): void {
    this._entityManager = entityManager;
    if (window.debugLogBridge) {
      window.debugLogBridge.log(`🤖 AI Behavior System Initialized`, 'success', {
        updateInterval: this.BEHAVIOR_UPDATE_INTERVAL,
      });
    }
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    this.behaviorUpdateCounter++;

    if (this.behaviorUpdateCounter < this.BEHAVIOR_UPDATE_INTERVAL) {
      return;
    }

    this.behaviorUpdateCounter = 0;
    this.updatePlayerPosition(entityManager);

    const aiEntities = entityManager.getEntitiesWithComponents(AIControlledComponent, PositionComponent);

    for (const entityId of aiEntities) {
      const ai = entityManager.getComponent(entityId, AIControlledComponent);
      const position = entityManager.getComponent(entityId, PositionComponent);

      if (!ai || !position) continue;

      // Champions use boss-style phase cycling behavior
      const enemyTypeForBehavior = entityManager.getComponent(entityId, EnemyTypeComponent);
      if (enemyTypeForBehavior?.isChampion && ai.behaviorPattern !== BehaviorPattern.Boss) {
        ai.originalBehaviorPattern = BehaviorPattern.Boss;
        ai.behaviorPattern = BehaviorPattern.Boss;
      }

      if (ai.targetEntityId) {
        this.updateTargetBasedBehavior(entityId, ai, position, entityManager);
      } else {
        this.updatePlayerBasedBehavior(entityId, ai, position, entityManager);
      }

      this.handleWeaponFiring(entityId, ai, position, entityManager);
    }
  }

  private updatePlayerPosition(entityManager: EntityManager): void {
    const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    if (players.length > 0) {
      this.playerEntityId = players[0];
      const playerPos = entityManager.getComponent(players[0], PositionComponent);
      if (playerPos) {
        this.playerPosition = { x: playerPos.x, y: playerPos.y };
      }
    }
  }

  private updateTargetBasedBehavior(
    entityId: number,
    ai: AIControlledComponent,
    position: PositionComponent,
    entityManager: EntityManager
  ): void {
    const targetEntityId = ai.targetEntityId;
    if (!targetEntityId) return;
    const targetPos = entityManager.getComponent(targetEntityId, PositionComponent);
    if (!targetPos) {
      ai.targetEntityId = undefined;
      return;
    }

    const dx = targetPos.x - position.x;
    const dy = targetPos.y - position.y;
    const distanceSquared = dx * dx + dy * dy;

    // Use squared distance for comparison (avoids sqrt in hot path)
    const maxRangeSquared = ai.detectionRange * 2 * (ai.detectionRange * 2);
    if (distanceSquared > maxRangeSquared) {
      ai.targetEntityId = undefined;
      return;
    }

    // Only compute sqrt when needed for behavior calculations
    const distance = Math.sqrt(distanceSquared);
    this.applyBehaviorPattern(entityId, ai, dx, dy, distance, entityManager);
  }

  private updatePlayerBasedBehavior(
    entityId: number,
    ai: AIControlledComponent,
    position: PositionComponent,
    entityManager: EntityManager
  ): void {
    if (!this.playerPosition) return;

    const dx = this.playerPosition.x - position.x;
    const dy = this.playerPosition.y - position.y;
    const distanceSquared = dx * dx + dy * dy;

    // Use squared distance for comparison (avoids sqrt in hot path)
    const detectionRangeSquared = ai.detectionRange * ai.detectionRange;
    if (distanceSquared > detectionRangeSquared) {
      // Player out of range - switch to wander (but remember original behavior)
      if (ai.behaviorPattern !== BehaviorPattern.Wander && ai.behaviorPattern !== BehaviorPattern.Idle) {
        ai.behaviorPattern = BehaviorPattern.Wander;
      }
    } else {
      // Player in range - restore original behavior if we were wandering
      if (ai.behaviorPattern === BehaviorPattern.Wander && ai.originalBehaviorPattern !== BehaviorPattern.Wander) {
        ai.behaviorPattern = ai.originalBehaviorPattern;
      }
    }

    // Only compute sqrt when needed for behavior calculations
    const distance = Math.sqrt(distanceSquared);
    this.applyBehaviorPattern(entityId, ai, dx, dy, distance, entityManager);
  }

  private applyBehaviorPattern(
    entityId: number,
    ai: AIControlledComponent,
    dx: number,
    dy: number,
    distance: number,
    entityManager: EntityManager
  ): void {
    const currentTime = Date.now();

    switch (ai.behaviorPattern) {
      case BehaviorPattern.Idle:
        break;

      case BehaviorPattern.Direct:
        // Direct chase with SURROUNDING behavior when close
        // HALLS OF TORMENT STYLE: Enemies approach, then spread around the player
        if (distance > 0) {
          const directAngle = Math.atan2(dy, dx);

          // When close to player, add tangential movement to spread around them
          // This prevents all enemies from piling on the exact same spot
          const SURROUND_DISTANCE = 80; // Start surrounding at this distance

          if (distance < SURROUND_DISTANCE) {
            // Blend between chase and orbit - closer = more orbit
            const orbitFactor = 1 - distance / SURROUND_DISTANCE; // 0 at edge, 1 at player
            // Use movementSeed to determine orbit direction (clockwise or counter)
            const orbitDirection = ai.movementSeed > 0.5 ? 1 : -1;
            const tangentAngle = directAngle + (Math.PI / 2) * orbitDirection;

            // Blend: chase direction + tangent direction
            const chaseX = Math.cos(directAngle);
            const chaseY = Math.sin(directAngle);
            const tangentX = Math.cos(tangentAngle);
            const tangentY = Math.sin(tangentAngle);

            // More orbit when closer (orbitFactor 0.3-0.7 range)
            const orbitWeight = 0.3 + orbitFactor * 0.4;
            const finalX = chaseX * (1 - orbitWeight) + tangentX * orbitWeight;
            const finalY = chaseY * (1 - orbitWeight) + tangentY * orbitWeight;

            this.smoothUpdateDirection(ai, finalX, finalY);
          } else {
            // Far from player - direct chase
            this.smoothUpdateDirection(ai, Math.cos(directAngle), Math.sin(directAngle));
          }
        }
        break;

      case BehaviorPattern.Aggressive: {
        // Thug low-health enrage: one-shot 2000ms speed burst at <40% HP.
        // Reuses chargeStartTime/isCharging for the burst window so no new
        // fields are needed beyond the enrageTriggered one-shot flag.
        if (!ai.enrageTriggered) {
          const health = entityManager.getComponent(entityId, HealthComponent);
          if (health && health.health / health.maxHealth < 0.4) {
            ai.enrageTriggered = true;
            ai.isCharging = true; // activates 'charging' visual state (red tint telegraph)
            ai.chargeStartTime = currentTime;
          }
        }
        // End the enrage burst after 2000ms
        if (ai.enrageTriggered && ai.isCharging && currentTime - ai.chargeStartTime > 2000) {
          ai.isCharging = false;
        }
        const enrageMult = ai.enrageTriggered && ai.isCharging ? 2.0 : 1.0;

        // Aggressive chase with surrounding when close
        if (distance > 0) {
          const aggroAngle = Math.atan2(dy, dx);
          const aggressionBoost = Math.max(1, 1.5 - distance / 400) * enrageMult;

          const SURROUND_DISTANCE = 60; // Aggressive enemies get closer before orbiting

          if (distance < SURROUND_DISTANCE) {
            const orbitFactor = 1 - distance / SURROUND_DISTANCE;
            const orbitDirection = ai.movementSeed > 0.5 ? 1 : -1;
            const tangentAngle = aggroAngle + (Math.PI / 2) * orbitDirection;

            const chaseX = Math.cos(aggroAngle) * aggressionBoost;
            const chaseY = Math.sin(aggroAngle) * aggressionBoost;
            const tangentX = Math.cos(tangentAngle) * aggressionBoost;
            const tangentY = Math.sin(tangentAngle) * aggressionBoost;

            const orbitWeight = 0.2 + orbitFactor * 0.3; // Less orbit, more aggression
            this.smoothUpdateDirection(
              ai,
              chaseX * (1 - orbitWeight) + tangentX * orbitWeight,
              chaseY * (1 - orbitWeight) + tangentY * orbitWeight
            );
          } else {
            this.smoothUpdateDirection(
              ai,
              Math.cos(aggroAngle) * aggressionBoost,
              Math.sin(aggroAngle) * aggressionBoost
            );
          }
        }
        break;
      }

      case BehaviorPattern.Wander: {
        // FIX: Use movementSeed for deterministic per-entity interval (not Math.random() each frame)
        const wanderInterval = 2500 + ai.movementSeed * 1000;
        // FIX: Immediately set wanderDirection if not set (prevents stuck enemies on first switch to Wander)
        if (!ai.wanderDirection || currentTime - ai.lastMovementChange > wanderInterval) {
          ai.lastMovementChange = currentTime;
          const angle = Math.random() * Math.PI * 2;
          ai.wanderDirection = {
            x: Math.cos(angle),
            y: Math.sin(angle),
          };
        }
        break;
      }

      case BehaviorPattern.Retreat: {
        // Retreat from target, slow down when far enough away
        const retreatThreshold = 200;
        if (distance < retreatThreshold) {
          // Too close - retreat quickly
          const avoidAngle = Math.atan2(dy, dx) + Math.PI;
          ai.wanderDirection = {
            x: Math.cos(avoidAngle),
            y: Math.sin(avoidAngle),
          };
        } else if (distance < retreatThreshold * 1.5) {
          // Safe-ish distance - slow retreat
          const avoidAngle = Math.atan2(dy, dx) + Math.PI;
          ai.wanderDirection = {
            x: Math.cos(avoidAngle) * 0.3,
            y: Math.sin(avoidAngle) * 0.3,
          };
        } else {
          // Far enough - hold position with slight wander
          if (!ai.wanderDirection || currentTime - ai.lastMovementChange > 2000) {
            ai.lastMovementChange = currentTime;
            const wanderAngle = Math.random() * Math.PI * 2;
            ai.wanderDirection = {
              x: Math.cos(wanderAngle) * 0.2,
              y: Math.sin(wanderAngle) * 0.2,
            };
          }
        }
        break;
      }

      case BehaviorPattern.Flank: {
        // FIX: Use movementSeed for deterministic per-entity interval
        const flankInterval = 1700 + ai.movementSeed * 600;
        if (currentTime - ai.lastMovementChange > flankInterval) {
          ai.lastMovementChange = currentTime;
          const flankSide = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
          const flankAngle = Math.atan2(dy, dx) + flankSide;
          ai.wanderDirection = {
            x: Math.cos(flankAngle),
            y: Math.sin(flankAngle),
          };
        }
        break;
      }

      case BehaviorPattern.Orbit: {
        // Orbit around target at preferred distance
        const orbitDistance = 200;
        if (distance > 0) {
          const tangentAngle = Math.atan2(dy, dx) + Math.PI / 2;
          // Adjust radial component based on distance
          let radialComponent = 0;
          if (distance < orbitDistance * 0.8) {
            radialComponent = -0.3; // Move away
          } else if (distance > orbitDistance * 1.2) {
            radialComponent = 0.3; // Move closer
          }
          const radialAngle = Math.atan2(dy, dx);
          ai.wanderDirection = {
            x: Math.cos(tangentAngle) + Math.cos(radialAngle) * radialComponent,
            y: Math.sin(tangentAngle) + Math.sin(radialAngle) * radialComponent,
          };
        }
        break;
      }

      case BehaviorPattern.Ranged: {
        // Ranged - maintain preferred distance (300), kite if too close
        const rangedPreferredDist = 300;
        if (distance > 0) {
          if (distance < rangedPreferredDist * 0.7) {
            // Too close - retreat while strafing
            const retreatAngle = Math.atan2(dy, dx) + Math.PI;
            // Slow strafe oscillation ~2 second cycle, ±17 degrees
            const strafeOffset = Math.sin(currentTime * 0.0008 + ai.movementSeed * 5) * 0.3;
            ai.wanderDirection = {
              x: Math.cos(retreatAngle + strafeOffset),
              y: Math.sin(retreatAngle + strafeOffset),
            };
          } else if (distance > rangedPreferredDist * 1.3) {
            // Too far - approach slowly
            const approachAngle = Math.atan2(dy, dx);
            ai.wanderDirection = {
              x: Math.cos(approachAngle) * 0.5,
              y: Math.sin(approachAngle) * 0.5,
            };
          } else {
            // At preferred distance - strafe
            const strafeAngle = Math.atan2(dy, dx) + Math.PI / 2;
            const strafeDir = Math.sin(currentTime * 0.001 + ai.movementSeed * 10) > 0 ? 1 : -1;
            ai.wanderDirection = {
              x: Math.cos(strafeAngle) * 0.4 * strafeDir,
              y: Math.sin(strafeAngle) * 0.4 * strafeDir,
            };
          }
        }
        break;
      }

      case BehaviorPattern.Sniper: {
        // Sniper - maintain long distance (500), retreat aggressively if approached
        const sniperPreferredDist = 500;
        if (distance > 0) {
          if (distance < sniperPreferredDist * 0.6) {
            // Way too close - fast retreat
            const retreatAngle = Math.atan2(dy, dx) + Math.PI;
            ai.wanderDirection = {
              x: Math.cos(retreatAngle) * 1.2,
              y: Math.sin(retreatAngle) * 1.2,
            };
          } else if (distance < sniperPreferredDist * 0.8) {
            // A bit too close - slow retreat
            const retreatAngle = Math.atan2(dy, dx) + Math.PI;
            ai.wanderDirection = {
              x: Math.cos(retreatAngle) * 0.5,
              y: Math.sin(retreatAngle) * 0.5,
            };
          } else if (distance > sniperPreferredDist * 1.2) {
            // Too far - approach to get in range
            const approachAngle = Math.atan2(dy, dx);
            ai.wanderDirection = {
              x: Math.cos(approachAngle) * 0.3,
              y: Math.sin(approachAngle) * 0.3,
            };
          } else {
            // In optimal range - minimal movement, slight strafe
            const strafeAngle = Math.atan2(dy, dx) + Math.PI / 2;
            ai.wanderDirection = {
              x: Math.cos(strafeAngle) * 0.15,
              y: Math.sin(strafeAngle) * 0.15,
            };
          }
        }
        break;
      }

      case BehaviorPattern.Charger: {
        // Charger - wind up (telegraph) -> charge -> recovery -> repeat
        // Timeline: 0-600ms wind-up, 600-2000ms charge, 2000-3500ms recovery
        const chargeInterval = 3500;
        const windUpDuration = 600; // Telegraph duration
        const chargeDuration = 1400; // Actual charge duration
        const timeSinceLastCharge = currentTime - ai.lastMovementChange;

        if (timeSinceLastCharge > chargeInterval) {
          // Start new charge cycle - begin wind-up
          ai.lastMovementChange = currentTime;
          ai.isCharging = false; // Not charging yet, just winding up
          ai.chargeStartTime = currentTime;
          // Lock target direction for the upcoming charge
          if (distance > 0) {
            const chargeAngle = Math.atan2(dy, dx);
            ai.chargeTargetDirection = {
              x: Math.cos(chargeAngle),
              y: Math.sin(chargeAngle),
            };
          }
          // Slow down during wind-up (preparing to charge)
          ai.wanderDirection = {
            x: (ai.chargeTargetDirection?.x || 0) * 0.2,
            y: (ai.chargeTargetDirection?.y || 0) * 0.2,
          };
        } else if (timeSinceLastCharge < windUpDuration) {
          // Wind-up phase - slow movement, telegraph visible
          ai.isCharging = false;
          ai.wanderDirection = {
            x: (ai.chargeTargetDirection?.x || 0) * 0.2,
            y: (ai.chargeTargetDirection?.y || 0) * 0.2,
          };
        } else if (timeSinceLastCharge < windUpDuration + chargeDuration) {
          // CHARGE! Fast movement in locked direction
          ai.isCharging = true;
          ai.wanderDirection = {
            x: (ai.chargeTargetDirection?.x || 0) * 2.5, // 2.5x speed charge
            y: (ai.chargeTargetDirection?.y || 0) * 2.5,
          };
        } else {
          // Recovery phase - slow tracking movement towards target
          ai.isCharging = false;
          ai.chargeTargetDirection = undefined;
          if (distance > 0) {
            const trackAngle = Math.atan2(dy, dx);
            ai.wanderDirection = {
              x: Math.cos(trackAngle) * 0.3,
              y: Math.sin(trackAngle) * 0.3,
            };
          }
        }
        break;
      }

      case BehaviorPattern.Swarm:
        // Swarm - fast movement with surrounding behavior
        if (distance > 0) {
          const swarmAngle = Math.atan2(dy, dx);
          const swarmOffset = Math.sin(currentTime * 0.001 + ai.movementSeed * 10) * 0.4;

          const SURROUND_DISTANCE = 100; // Swarm enemies spread out more

          if (distance < SURROUND_DISTANCE) {
            const orbitFactor = 1 - distance / SURROUND_DISTANCE;
            const orbitDirection = ai.movementSeed > 0.5 ? 1 : -1;
            const tangentAngle = swarmAngle + (Math.PI / 2) * orbitDirection;

            const chaseX = Math.cos(swarmAngle + swarmOffset) * 1.2;
            const chaseY = Math.sin(swarmAngle + swarmOffset) * 1.2;
            const tangentX = Math.cos(tangentAngle) * 1.2;
            const tangentY = Math.sin(tangentAngle) * 1.2;

            const orbitWeight = 0.3 + orbitFactor * 0.4;
            this.smoothUpdateDirection(
              ai,
              chaseX * (1 - orbitWeight) + tangentX * orbitWeight,
              chaseY * (1 - orbitWeight) + tangentY * orbitWeight
            );
          } else {
            this.smoothUpdateDirection(
              ai,
              Math.cos(swarmAngle + swarmOffset) * 1.2,
              Math.sin(swarmAngle + swarmOffset) * 1.2
            );
          }
        }
        break;

      case BehaviorPattern.Grouping: {
        // Group with allies while still moving towards target
        const allies = this.findNearbyAllies(entityId, 150, entityManager);
        if (allies.length > 0) {
          let centerX = 0;
          let centerY = 0;

          for (const allyId of allies) {
            const allyPos = entityManager.getComponent(allyId, PositionComponent);
            if (allyPos) {
              centerX += allyPos.x;
              centerY += allyPos.y;
            }
          }

          centerX /= allies.length;
          centerY /= allies.length;

          const position = entityManager.getComponent(entityId, PositionComponent);
          if (position) {
            const toCenterX = centerX - position.x;
            const toCenterY = centerY - position.y;
            const toCenterDist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

            if (toCenterDist > 100) {
              // Move towards group center
              ai.wanderDirection = {
                x: toCenterX / toCenterDist,
                y: toCenterY / toCenterDist,
              };
            } else {
              // Already grouped - move as pack towards target
              if (distance > 0) {
                const packAngle = Math.atan2(dy, dx);
                ai.wanderDirection = {
                  x: Math.cos(packAngle) * 0.8,
                  y: Math.sin(packAngle) * 0.8,
                };
              }
            }
          }
        } else {
          // No allies nearby - chase target directly
          if (distance > 0) {
            const chaseAngle = Math.atan2(dy, dx);
            ai.wanderDirection = {
              x: Math.cos(chaseAngle),
              y: Math.sin(chaseAngle),
            };
          }
        }
        break;
      }

      case BehaviorPattern.Disruptor: {
        // Disruptor: maintain 150-200px from player, orbit at range, retreat if too close
        // Group-seeking: bias toward ally clusters when available
        const disruptorPreferredDist = 175;
        const disruptorRetreatDist = 100;
        const disruptorApproachDist = 250;

        if (distance > 0) {
          if (distance < disruptorRetreatDist) {
            // Too close — retreat directly away
            const retreatAngle = Math.atan2(dy, dx) + Math.PI;
            this.smoothUpdateDirection(ai, Math.cos(retreatAngle), Math.sin(retreatAngle));
          } else if (distance <= disruptorApproachDist) {
            // Preferred range: orbit perpendicular to player
            const orbitDirection = ai.movementSeed > 0.5 ? 1 : -1;
            const tangentAngle = Math.atan2(dy, dx) + (Math.PI / 2) * orbitDirection;
            // Slight radial correction to maintain preferred distance
            const radialAngle = Math.atan2(dy, dx);
            const radialCorrection = distance < disruptorPreferredDist ? -0.25 : 0.0;
            const tx = Math.cos(tangentAngle) + Math.cos(radialAngle) * radialCorrection;
            const ty = Math.sin(tangentAngle) + Math.sin(radialAngle) * radialCorrection;
            const mag = Math.sqrt(tx * tx + ty * ty);
            this.smoothUpdateDirection(ai, mag > 0.001 ? tx / mag : tx, mag > 0.001 ? ty / mag : ty);
          } else {
            // Too far — approach
            const approachAngle = Math.atan2(dy, dx);
            this.smoothUpdateDirection(ai, Math.cos(approachAngle) * 0.8, Math.sin(approachAngle) * 0.8);
          }
        }
        break;
      }

      case BehaviorPattern.Sentinel: {
        // Sentinel: always advance toward player, no retreat, no orbit.
        // Low separation scale means they clump into shield walls.
        if (distance > 0) {
          const advanceAngle = Math.atan2(dy, dx);
          this.smoothUpdateDirection(ai, Math.cos(advanceAngle), Math.sin(advanceAngle));
        }
        break;
      }

      case BehaviorPattern.TerritorialGuardian: {
        const guardian = entityManager.getComponent(entityId, TerritorialGuardianComponent);
        if (!guardian) {
          // No guardian component — fall back to wander
          if (!ai.wanderDirection || currentTime - ai.lastMovementChange > 2500) {
            ai.lastMovementChange = currentTime;
            const fallbackAngle = Math.random() * Math.PI * 2;
            ai.wanderDirection = { x: Math.cos(fallbackAngle), y: Math.sin(fallbackAngle) };
          }
          break;
        }

        const entityPos = entityManager.getComponent(entityId, PositionComponent);
        if (!entityPos) break;

        const homeDx = guardian.homeX - entityPos.x;
        const homeDy = guardian.homeY - entityPos.y;
        const homeDistSq = homeDx * homeDx + homeDy * homeDy;

        const playerDx = this.playerPosition ? this.playerPosition.x - entityPos.x : 0;
        const playerDy = this.playerPosition ? this.playerPosition.y - entityPos.y : 0;
        const playerDistSq = playerDx * playerDx + playerDy * playerDy;

        if (guardian.isLeashed) {
          // Return state: head back to home (movement system applies 1.5x speed boost for leashed state)
          const homeMag = Math.sqrt(homeDistSq);
          if (homeMag > 0) {
            this.smoothUpdateDirection(ai, homeDx / homeMag, homeDy / homeMag);
          }
          ai.aiVisualState = 'retreating';
          // Arrive check: within 50px squared = 2500
          if (homeDistSq < 2500) {
            guardian.isLeashed = false;
            guardian.isAggroed = false;
          }
        } else if (guardian.isAggroed) {
          // Aggro state: chase player
          const playerMag = Math.sqrt(playerDistSq);
          if (playerMag > 0) {
            this.smoothUpdateDirection(ai, playerDx / playerMag, playerDy / playerMag);
          }
          ai.aiVisualState = 'pursuing';
          // Leash check: beyond leashRadius * 1.2
          const leashThreshold = guardian.leashRadius * 1.2;
          if (homeDistSq > leashThreshold * leashThreshold) {
            guardian.isLeashed = true;
          }
        } else {
          // Patrol state: slow orbit around home
          // Rank 2 patrols faster (more alert), rank 3 patrols slower (more menacing)
          const orbitSpeed = guardian.rankTier === 3 ? 0.0004 : guardian.rankTier === 2 ? 0.0006 : 0.0005;
          const patrolRadius = guardian.aggroRadius * 0.5;
          const orbitAngle = (currentTime * orbitSpeed + entityId * 0.7) % (Math.PI * 2);
          const targetX = guardian.homeX + Math.cos(orbitAngle) * patrolRadius;
          const targetY = guardian.homeY + Math.sin(orbitAngle) * patrolRadius;
          const toTargetDx = targetX - entityPos.x;
          const toTargetDy = targetY - entityPos.y;
          const toTargetMag = Math.sqrt(toTargetDx * toTargetDx + toTargetDy * toTargetDy);
          if (toTargetMag > 0) {
            this.smoothUpdateDirection(ai, toTargetDx / toTargetMag, toTargetDy / toTargetMag);
          }
          ai.aiVisualState = 'idle';
          // Aggro check
          const aggroRadiusSq = guardian.aggroRadius * guardian.aggroRadius;
          if (this.playerPosition && playerDistSq < aggroRadiusSq) {
            const isFirstAggro = currentTime - guardian.lastAggroTime >= 3000;
            guardian.isAggroed = true;
            guardian.lastAggroTime = currentTime;
            if (this.playerEntityId !== null) {
              guardian.aggroTargetEntityId = this.playerEntityId;
            }
            if (isFirstAggro) {
              this.audio.playGuardianAggro();
            }
          }
        }
        break;
      }

      case BehaviorPattern.Boss: {
        // FIX: Use movementSeed for deterministic per-entity phase timing
        const phaseInterval = 9000 + ai.movementSeed * 2000;
        const phase = Math.floor(currentTime / phaseInterval) % 4;
        const subBehavior = [
          BehaviorPattern.Aggressive,
          BehaviorPattern.Orbit,
          BehaviorPattern.Retreat,
          BehaviorPattern.Ranged,
        ][phase];

        // Apply sub-behavior movement WITHOUT changing the main pattern
        switch (subBehavior) {
          case BehaviorPattern.Aggressive:
            if (distance > 0) {
              const angle = Math.atan2(dy, dx);
              ai.wanderDirection = {
                x: Math.cos(angle) * 1.5, // Boss aggressive speed boost
                y: Math.sin(angle) * 1.5,
              };
            }
            break;
          case BehaviorPattern.Orbit:
            if (distance > 0) {
              const bossOrbitAngle = Math.atan2(dy, dx) + Math.PI / 2;
              ai.wanderDirection = {
                x: Math.cos(bossOrbitAngle),
                y: Math.sin(bossOrbitAngle),
              };
            }
            break;
          case BehaviorPattern.Retreat:
            if (distance < 300) {
              // Too close - retreat
              const retreatAngle = Math.atan2(dy, dx) + Math.PI;
              ai.wanderDirection = {
                x: Math.cos(retreatAngle),
                y: Math.sin(retreatAngle),
              };
            } else {
              // Far enough - orbit while retreating
              const bossRetreatOrbitAngle = Math.atan2(dy, dx) + Math.PI / 2;
              ai.wanderDirection = {
                x: Math.cos(bossRetreatOrbitAngle) * 0.5,
                y: Math.sin(bossRetreatOrbitAngle) * 0.5,
              };
            }
            break;
          case BehaviorPattern.Ranged:
            // Maintain preferred distance (250-350)
            if (distance < 250) {
              // Too close - back off
              const backAngle = Math.atan2(dy, dx) + Math.PI;
              ai.wanderDirection = {
                x: Math.cos(backAngle) * 0.5,
                y: Math.sin(backAngle) * 0.5,
              };
            } else if (distance > 350) {
              // Too far - approach
              const forwardAngle = Math.atan2(dy, dx);
              ai.wanderDirection = {
                x: Math.cos(forwardAngle) * 0.3,
                y: Math.sin(forwardAngle) * 0.3,
              };
            } else {
              // Optimal range - strafe slowly
              const bossRangedStrafeAngle = Math.atan2(dy, dx) + Math.PI / 2;
              ai.wanderDirection = {
                x: Math.cos(bossRangedStrafeAngle) * 0.2,
                y: Math.sin(bossRangedStrafeAngle) * 0.2,
              };
            }
            break;
        }
        break;
      }
    }

    // Set visual state for renderer behavior indicators
    ai.aiVisualState = this.mapBehaviorToVisualState(ai);
  }

  private mapBehaviorToVisualState(ai: AIControlledComponent): AIControlledComponent['aiVisualState'] {
    if (ai.isCharging) return 'charging';
    switch (ai.behaviorPattern) {
      case BehaviorPattern.Idle:
      case BehaviorPattern.Wander:
        return 'idle';
      case BehaviorPattern.Direct:
      case BehaviorPattern.Flank:
      case BehaviorPattern.Grouping:
        return 'pursuing';
      case BehaviorPattern.Aggressive:
        return 'attacking';
      case BehaviorPattern.Retreat:
        return 'retreating';
      case BehaviorPattern.Charger:
        return 'charging';
      case BehaviorPattern.Sniper:
      case BehaviorPattern.Ranged:
        return 'aiming';
      case BehaviorPattern.Orbit:
        return 'orbiting';
      case BehaviorPattern.Swarm:
        return 'swarming';
      case BehaviorPattern.Boss:
        return 'attacking';
      case BehaviorPattern.Disruptor:
        return 'orbiting';
      case BehaviorPattern.Sentinel:
        return 'pursuing';
      case BehaviorPattern.TerritorialGuardian:
        // Visual state is set directly inside the case block (sub-state dependent)
        return ai.aiVisualState ?? 'idle';
      default:
        return 'idle';
    }
  }

  private handleWeaponFiring(
    entityId: number,
    ai: AIControlledComponent,
    position: PositionComponent,
    entityManager: EntityManager
  ): void {
    const weapon = entityManager.getComponent(entityId, WeaponComponent);
    if (!weapon) return;

    // Block all weapon behavior until enemy is combat-ready (spawn complete + in viewport)
    const renderable = entityManager.getComponent(entityId, RenderableComponent);
    if (renderable && !renderable.isCombatReady(window.performance.now())) {
      weapon.readyToFire = false;
      weapon.isAiming = false;
      return;
    }

    let targetX: number;
    let targetY: number;

    if (ai.targetEntityId) {
      const targetPos = entityManager.getComponent(ai.targetEntityId, PositionComponent);
      if (!targetPos) return;
      targetX = targetPos.x;
      targetY = targetPos.y;
    } else if (this.playerPosition) {
      targetX = this.playerPosition.x;
      targetY = this.playerPosition.y;
    } else {
      return;
    }

    const dx = targetX - position.x;
    const dy = targetY - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const weaponRange = 500; // Default range for enemy weapons
    const currentTime = Date.now();

    // Store target direction for rendering (always update when in range)
    if (distance <= weaponRange && distance > 0) {
      const normalizedDx = dx / distance;
      const normalizedDy = dy / distance;
      weapon.targetDirection = { x: normalizedDx, y: normalizedDy };
    }

    // Check if this is a sniper - they use aiming telegraph
    const isSniper =
      ai.behaviorPattern === BehaviorPattern.Sniper || ai.originalBehaviorPattern === BehaviorPattern.Sniper;

    if (distance <= weaponRange && weapon.canFire(currentTime)) {
      if (isSniper) {
        // Sniper aiming telegraph system
        if (!weapon.isAiming) {
          // Start aiming - show telegraph
          weapon.isAiming = true;
          weapon.aimStartTime = currentTime;
          weapon.aimDuration = 800; // 800ms telegraph for snipers (gives player time to react)
          weapon.readyToFire = false;
        } else if (weapon.isAimComplete(currentTime)) {
          // Aiming complete - fire!
          weapon.readyToFire = true;
          weapon.isAiming = false; // Reset for next shot
        }
      } else {
        // Non-snipers fire immediately
        weapon.readyToFire = true;
        weapon.isAiming = false;
      }
    } else {
      // Out of range or on cooldown - clear states
      weapon.readyToFire = false;
      weapon.isAiming = false;
    }
  }

  /**
   * Find nearby allies for group-cohesion behavior.
   *
   * Group cohesion is currently disabled: this method always returns [] because
   * no shared spatial index is populated during the game loop. BehaviorPattern.Grouping
   * enemies consequently fall through to the "no allies nearby — chase target directly"
   * branch in applyBehaviorPattern, which preserves live behavior unchanged.
   *
   * To activate group cohesion: populate a shared spatial structure per frame and
   * replace this stub with a real radius query (see heal-aura-system.service.ts for
   * the full-scan fallback pattern used elsewhere until that work lands).
   */
  private findNearbyAllies(_entityId: number, _range: number, _entityManager: EntityManager): number[] {
    return [];
  }

  /**
   * JITTER FIX: Smoothly update wanderDirection instead of snapping to new values.
   * This prevents oscillation when direction changes frequently (like in 'direct' behavior)
   * and is then blended with separation in EnemyMovementSystem.
   */
  private smoothUpdateDirection(ai: AIControlledComponent, targetX: number, targetY: number): void {
    const smoothing = this.DIRECTION_SMOOTHING[ai.behaviorPattern] ?? 0.5;
    if (!ai.wanderDirection) {
      ai.wanderDirection = { x: targetX, y: targetY };
    } else {
      // Lerp toward target direction using behavior-specific smoothing
      ai.wanderDirection.x += (targetX - ai.wanderDirection.x) * smoothing;
      ai.wanderDirection.y += (targetY - ai.wanderDirection.y) * smoothing;
    }
  }

  reset(): void {
    this.playerPosition = null;
    this.playerEntityId = null;
    this.behaviorUpdateCounter = 0;
  }

  destroy(): void {
    this.reset();
  }
}
