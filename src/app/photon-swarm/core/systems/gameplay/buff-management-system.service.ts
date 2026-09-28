import { Injectable, OnDestroy } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { BuffComponent } from '@photon/components/buff.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Buff effect types for optimized updates
 */
export type BuffEffectType = keyof BuffEffects;

/**
 * Buff effects interface
 */
export interface BuffEffects {
  damageMultiplier: number;
  damageReduction: number;
  criticalChance: number;
  criticalMultiplier: number;
  speedMultiplier: number;
  fireRateMultiplier: number;
  healingMultiplier: number;
  experienceMultiplier: number;
}

/**
 * Buff Definition Interface
 *
 * Defines the structure of a buff that can be applied to entities
 */
export interface BuffDefinition {
  id: string;
  name: string;
  description: string;
  duration: number; // milliseconds, -1 for permanent
  stackable: boolean;
  maxStacks: number;
  category: 'offensive' | 'defensive' | 'utility' | 'debuff';
  priority: number; // Higher priority buffs override lower in conflicts
  effects: Partial<BuffEffects>;
  onApply?: (entity: number, entityManager: EntityManager) => void;
  onExpire?: (entity: number, entityManager: EntityManager) => void;
  onStack?: (entity: number, currentStacks: number, entityManager: EntityManager) => void;
}

/**
 * Active Buff Instance
 *
 * Tracks a buff that is currently applied to an entity
 */
export interface ActiveBuff {
  buffId: string;
  entity: number;
  startTime: number;
  duration: number;
  stacks: number;
  isPermanent: boolean;
  refreshable: boolean;
}

/**
 * Buff Event for external systems
 */
export interface BuffEvent {
  type: 'applied' | 'expired' | 'refreshed' | 'stacked' | 'removed' | 'batch_applied';
  entity: number;
  buffId: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

/**
 * Batch buff application result
 */
export interface BatchBuffResult {
  buffId: string;
  success: boolean;
  reason?: string;
}

/**
 * Constants for buff system limits
 */
export const BUFF_CONSTANTS = {
  MAX_DAMAGE_REDUCTION: 0.9,
  MAX_CRITICAL_CHANCE: 1.0,
  MIN_SPEED_MULTIPLIER: 0.1,
  MAX_SPEED_MULTIPLIER: 5.0,
  MAX_DAMAGE_MULTIPLIER: 10.0,
  MAX_FIRE_RATE_MULTIPLIER: 5.0,
  MAX_HEALING_MULTIPLIER: 5.0,
  MAX_EXPERIENCE_MULTIPLIER: 10.0,
  DEFAULT_PRIORITY: 100,
  BUFF_ID_PATTERN: /^[a-z][a-z0-9_]*$/,
  LOG_FREQUENCY: 0.1, // 10% chance to log common events
} as const;

/**
 * Buff Management System Service - Improved Version
 *
 * Comprehensive ECS system for managing buffs and debuffs on any entity.
 *
 * Improvements:
 * - Optimized effect calculations with change tracking
 * - Memory management with buff unregistration
 * - Priority-based conflict resolution
 * - Batch operations support
 * - Constants for magic numbers
 * - Enhanced logging with levels
 * - Buff ID validation
 *
 * Features:
 * - Timed and permanent buffs
 * - Stackable buffs with limits
 * - Buff categories and conflicts
 * - Event-driven notifications
 * - Performance optimized for many entities
 */
@Injectable({ providedIn: 'root' })
export class BuffManagementSystemService implements System, OnDestroy {
  // Buff definitions registry
  private buffDefinitions = new Map<string, BuffDefinition>();

  // Active buffs tracking
  private activeBuffs = new Map<number, Map<string, ActiveBuff>>();

  // Buff conflict rules (buffs that can't coexist)
  private conflictRules = new Map<string, Set<string>>();

  // Performance optimization: track entities with buffs
  private buffedEntities = new Set<number>();

  // Event callbacks
  private eventCallbacks = new Map<string, ((event: BuffEvent) => void)[]>();

  // Track buffs in use to prevent unregistration
  private buffsInUse = new Map<string, number>();

  // Reusable per-frame buffers to avoid allocations in update()
  private readonly _expiredBuffsBuffer: Array<{ entity: number; buffId: string }> = [];
  private readonly _effectsToUpdateBuffer = new Set<BuffEffectType>();

  constructor(private debugLog: DebugLogBridgeService) {
    this.initializeBuiltInBuffs();
  }

  /**
   * Initialize built-in buff definitions
   */
  private initializeBuiltInBuffs(): void {
    // Offensive buffs
    this.registerBuff({
      id: 'damage_boost',
      name: 'Damage Boost',
      description: 'Increases damage by 50%',
      duration: 10000,
      stackable: false,
      maxStacks: 1,
      category: 'offensive',
      priority: 100,
      effects: { damageMultiplier: 1.5 },
    });

    this.registerBuff({
      id: 'damage_boost_2x',
      name: 'Power Surge',
      description: 'Doubles damage output',
      duration: 8000,
      stackable: false,
      maxStacks: 1,
      category: 'offensive',
      priority: 110,
      effects: { damageMultiplier: 2.0 },
    });

    this.registerBuff({
      id: 'damage_boost_3x',
      name: 'Fury',
      description: 'Triples damage briefly',
      duration: 5000,
      stackable: false,
      maxStacks: 1,
      category: 'offensive',
      priority: 120,
      effects: { damageMultiplier: 3.0 },
    });

    this.registerBuff({
      id: 'critical_surge',
      name: 'Critical Surge',
      description: 'Increases critical chance and damage',
      duration: 15000,
      stackable: false,
      maxStacks: 1,
      category: 'offensive',
      priority: 110,
      effects: {
        criticalChance: 0.25,
        criticalMultiplier: 2.0,
      },
    });

    this.registerBuff({
      id: 'rapid_fire',
      name: 'Rapid Fire',
      description: 'Doubles fire rate',
      duration: 8000,
      stackable: false,
      maxStacks: 1,
      category: 'offensive',
      priority: 105,
      effects: { fireRateMultiplier: 2.0 },
    });

    // Defensive buffs
    this.registerBuff({
      id: 'shield',
      name: 'Shield',
      description: 'Reduces damage taken by 30%',
      duration: 12000,
      stackable: true,
      maxStacks: 2,
      category: 'defensive',
      priority: 120,
      effects: { damageReduction: 0.3 },
    });

    this.registerBuff({
      id: 'regeneration',
      name: 'Regeneration',
      description: 'Increases healing received by 100%',
      duration: 20000,
      stackable: false,
      maxStacks: 1,
      category: 'defensive',
      priority: 115,
      effects: { healingMultiplier: 2.0 },
    });

    // Utility buffs
    this.registerBuff({
      id: 'speed_boost',
      name: 'Speed Boost',
      description: 'Increases movement speed by 30%',
      duration: 10000,
      stackable: true,
      maxStacks: 3,
      category: 'utility',
      priority: 100,
      effects: { speedMultiplier: 1.3 },
    });

    this.registerBuff({
      id: 'experience_boost',
      name: 'Experience Boost',
      description: 'Doubles experience gained',
      duration: 15000,
      stackable: false,
      maxStacks: 1,
      category: 'utility',
      priority: 90,
      effects: { experienceMultiplier: 2.0 },
    });

    // Debuffs (lower priority)
    this.registerBuff({
      id: 'slow',
      name: 'Slowed',
      description: 'Movement speed reduced by 50%',
      duration: 5000,
      stackable: false,
      maxStacks: 1,
      category: 'debuff',
      priority: 50,
      effects: { speedMultiplier: 0.5 },
    });

    this.registerBuff({
      id: 'weakness',
      name: 'Weakened',
      description: 'Damage dealt reduced by 30%',
      duration: 8000,
      stackable: true,
      maxStacks: 3,
      category: 'debuff',
      priority: 60,
      effects: { damageMultiplier: 0.7 },
    });

    // Set up conflict rules
    this.addConflictRule('damage_boost', 'weakness');
    this.addConflictRule('speed_boost', 'slow');
    this.addConflictRule('shield', 'vulnerability');
  }

  /**
   * Validate buff ID format
   */
  private isValidBuffId(id: string): boolean {
    return BUFF_CONSTANTS.BUFF_ID_PATTERN.test(id);
  }

  /**
   * Enhanced logging with levels
   */
  private logInfo(message: string, data?: Record<string, unknown>): void {
    this.debugLog.log(message, 'info', { source: 'buff_management', ...data });
  }

  private logWarn(message: string, data?: Record<string, unknown>): void {
    this.debugLog.log(message, 'warning', { source: 'buff_management', ...data });
  }

  private logError(message: string, data?: Record<string, unknown>): void {
    this.debugLog.log(message, 'error', { source: 'buff_management', ...data });
  }

  /**
   * Register a new buff definition
   */
  registerBuff(definition: BuffDefinition): void {
    if (!this.isValidBuffId(definition.id)) {
      this.logError(`Invalid buff ID format: ${definition.id}`, { buffId: definition.id });
      return;
    }

    // Set default priority if not provided
    if (definition.priority === undefined) {
      definition.priority = BUFF_CONSTANTS.DEFAULT_PRIORITY;
    }

    this.buffDefinitions.set(definition.id, definition);

    this.logInfo(`📜 Buff registered: ${definition.name}`, {
      buffId: definition.id,
      category: definition.category,
      duration: definition.duration,
      priority: definition.priority,
    });
  }

  /**
   * Check if a buff is registered
   */
  isBuffRegistered(buffId: string): boolean {
    return this.buffDefinitions.has(buffId);
  }

  /**
   * Unregister a buff definition
   */
  unregisterBuff(buffId: string): boolean {
    if (this.isBuffInUse(buffId)) {
      this.logWarn(`Cannot unregister buff in use: ${buffId}`, {
        buffId,
        useCount: this.buffsInUse.get(buffId),
      });
      return false;
    }

    const result = this.buffDefinitions.delete(buffId);
    if (result) {
      this.logInfo(`Buff unregistered: ${buffId}`, { buffId });
    }
    return result;
  }

  /**
   * Check if a buff is currently in use
   */
  private isBuffInUse(buffId: string): boolean {
    return (this.buffsInUse.get(buffId) ?? 0) > 0;
  }

  /**
   * Add a conflict rule between buffs
   */
  addConflictRule(buffId1: string, buffId2: string): void {
    if (!this.conflictRules.has(buffId1)) {
      this.conflictRules.set(buffId1, new Set());
    }
    if (!this.conflictRules.has(buffId2)) {
      this.conflictRules.set(buffId2, new Set());
    }

    const conflicts1 = this.conflictRules.get(buffId1);
    const conflicts2 = this.conflictRules.get(buffId2);
    if (conflicts1) conflicts1.add(buffId2);
    if (conflicts2) conflicts2.add(buffId1);
  }

  /**
   * Apply multiple buffs in batch
   */
  applyMultipleBuffs(entity: number, buffIds: string[], entityManager: EntityManager): BatchBuffResult[] {
    const results: BatchBuffResult[] = [];
    const effectsToUpdate = new Set<BuffEffectType>();

    // Apply all buffs, tracking which effects need updating
    for (const buffId of buffIds) {
      const definition = this.buffDefinitions.get(buffId);
      if (!definition) {
        results.push({ buffId, success: false, reason: 'Unknown buff' });
        continue;
      }

      // Track which effects this buff modifies
      for (const effect of Object.keys(definition.effects) as BuffEffectType[]) {
        effectsToUpdate.add(effect);
      }

      const success = this.applyBuffInternal(entity, buffId, entityManager, true);
      results.push({ buffId, success });
    }

    // Update effects once for all buffs
    this.updateBuffEffects(entity, entityManager, effectsToUpdate);

    // Emit batch event
    this.emitEvent({
      type: 'batch_applied',
      entity,
      buffId: 'multiple',
      timestamp: window.performance.now(),
      details: { results },
    });

    return results;
  }

  /**
   * Apply a buff to an entity
   */
  applyBuff(entity: number, buffId: string, entityManager: EntityManager): boolean {
    return this.applyBuffInternal(entity, buffId, entityManager, false);
  }

  /**
   * Internal buff application with batch support
   */
  private applyBuffInternal(entity: number, buffId: string, entityManager: EntityManager, isBatch: boolean): boolean {
    const definition = this.buffDefinitions.get(buffId);
    if (!definition) {
      this.logWarn(`Unknown buff: ${buffId}`, { entity });
      return false;
    }

    // Ensure entity has BuffComponent
    let buffComponent = entityManager.getComponent(entity, BuffComponent);
    if (!buffComponent) {
      buffComponent = new BuffComponent();
      entityManager.addComponent(entity, buffComponent);
    }

    // Get or create active buff map for entity
    let entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs) {
      entityBuffs = new Map();
      this.activeBuffs.set(entity, entityBuffs);
    }
    const existingBuff = entityBuffs.get(buffId);

    // Check for conflicts with priority
    const conflicts = this.checkConflictsWithPriority(entity, buffId, definition.priority);
    if (conflicts.shouldBlock) {
      this.logInfo(`Buff blocked by higher priority conflict`, {
        entity,
        buffId,
        blockingBuff: conflicts.blockingBuff,
      });
      return false;
    }

    // Remove lower priority conflicts
    for (const conflictId of conflicts.toRemove) {
      this.removeBuff(entity, conflictId, entityManager);
    }

    // Refresh entityBuffs reference after removals (map may have been deleted if last buff was removed)
    entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs) {
      entityBuffs = new Map();
      this.activeBuffs.set(entity, entityBuffs);
    }

    // Handle existing buff
    if (existingBuff) {
      if (definition.stackable && existingBuff.stacks < definition.maxStacks) {
        // Stack the buff
        existingBuff.stacks++;

        // Track effects to update
        const effectsToUpdate = new Set(Object.keys(definition.effects) as BuffEffectType[]);

        if (!isBatch) {
          this.updateBuffEffects(entity, entityManager, effectsToUpdate);
        }

        if (definition.onStack) {
          definition.onStack(entity, existingBuff.stacks, entityManager);
        }

        this.emitEvent({
          type: 'stacked',
          entity,
          buffId,
          timestamp: window.performance.now(),
          details: { stacks: existingBuff.stacks },
        });

        return true;
      } else if (existingBuff.refreshable) {
        // Refresh duration
        existingBuff.startTime = window.performance.now();

        this.emitEvent({
          type: 'refreshed',
          entity,
          buffId,
          timestamp: window.performance.now(),
        });

        return true;
      }

      return false; // Can't stack or refresh
    }

    // Create new buff instance
    const activeBuff: ActiveBuff = {
      buffId,
      entity,
      startTime: window.performance.now(),
      duration: definition.duration,
      stacks: 1,
      isPermanent: definition.duration === -1,
      refreshable: true,
    };

    entityBuffs.set(buffId, activeBuff);
    this.buffedEntities.add(entity);

    // Track buff usage
    this.buffsInUse.set(buffId, (this.buffsInUse.get(buffId) ?? 0) + 1);

    // Apply effects if not batch
    if (!isBatch) {
      const effectsToUpdate = new Set(Object.keys(definition.effects) as BuffEffectType[]);
      this.updateBuffEffects(entity, entityManager, effectsToUpdate);
    }

    // Call onApply callback
    if (definition.onApply) {
      definition.onApply(entity, entityManager);
    }

    // Update BuffComponent's active buffs set
    buffComponent.addBuff(buffId);

    this.emitEvent({
      type: 'applied',
      entity,
      buffId,
      timestamp: window.performance.now(),
    });

    if (Math.random() < BUFF_CONSTANTS.LOG_FREQUENCY) {
      this.logInfo(`✨ Buff applied: ${definition.name} to entity ${entity}`, {
        entity,
        buffId,
        duration: definition.duration,
        stacks: 1,
        priority: definition.priority,
      });
    }

    return true;
  }

  /**
   * Check for buff conflicts with priority consideration
   */
  private checkConflictsWithPriority(
    entity: number,
    buffId: string,
    priority: number
  ): {
    shouldBlock: boolean;
    blockingBuff?: string;
    toRemove: string[];
  } {
    const conflictSet = this.conflictRules.get(buffId);

    if (!conflictSet) return { shouldBlock: false, toRemove: [] };

    const entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs) return { shouldBlock: false, toRemove: [] };

    let shouldBlock = false;
    let blockingBuff: string | undefined;
    const toRemove: string[] = [];

    for (const [activeBuffId] of entityBuffs) {
      if (conflictSet.has(activeBuffId)) {
        const activeDefinition = this.buffDefinitions.get(activeBuffId);
        if (activeDefinition) {
          if (activeDefinition.priority > priority) {
            // Higher priority buff blocks this one
            shouldBlock = true;
            blockingBuff = activeBuffId;
            break;
          } else {
            // Lower priority buff will be removed
            toRemove.push(activeBuffId);
          }
        }
      }
    }

    return { shouldBlock, blockingBuff, toRemove };
  }

  /**
   * Remove a specific buff from an entity
   */
  removeBuff(entity: number, buffId: string, entityManager: EntityManager): boolean {
    const entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs || !entityBuffs.has(buffId)) {
      return false;
    }

    const definition = this.buffDefinitions.get(buffId);
    // Remove from tracking
    entityBuffs.delete(buffId);
    if (entityBuffs.size === 0) {
      this.activeBuffs.delete(entity);
      this.buffedEntities.delete(entity);
    }

    // Update usage tracking
    this.buffsInUse.set(buffId, Math.max(0, (this.buffsInUse.get(buffId) ?? 0) - 1));

    // Update BuffComponent
    const buffComponent = entityManager.getComponent(entity, BuffComponent);
    if (buffComponent) {
      buffComponent.removeBuff(buffId);
      const effectsToUpdate = definition ? new Set(Object.keys(definition.effects) as BuffEffectType[]) : undefined;
      this.updateBuffEffects(entity, entityManager, effectsToUpdate);
    }

    // Call onExpire callback
    if (definition?.onExpire) {
      definition.onExpire(entity, entityManager);
    }

    this.emitEvent({
      type: 'removed',
      entity,
      buffId,
      timestamp: window.performance.now(),
      details: { wasExpired: false },
    });

    return true;
  }

  /**
   * Remove all buffs from an entity
   */
  removeAllBuffs(entity: number, entityManager: EntityManager): void {
    const entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs) return;

    // Copy buff IDs to avoid modification during iteration
    const buffIds = Array.from(entityBuffs.keys());

    for (const buffId of buffIds) {
      this.removeBuff(entity, buffId, entityManager);
    }
  }

  /**
   * Update buff effects with optimization for specific changes
   */
  private updateBuffEffects(entity: number, entityManager: EntityManager, changedEffects?: Set<BuffEffectType>): void {
    const buffComponent = entityManager.getComponent(entity, BuffComponent);
    if (!buffComponent) return;

    // If no specific changes, update everything
    if (!changedEffects || changedEffects.size === 0) {
      // Reset to base values
      buffComponent.damageMultiplier = 1.0;
      buffComponent.damageReduction = 0;
      buffComponent.criticalChance = 0;
      buffComponent.criticalMultiplier = 1.0;
      buffComponent.speedMultiplier = 1.0;
      buffComponent.fireRateMultiplier = 1.0;
      buffComponent.healingMultiplier = 1.0;
      buffComponent.experienceMultiplier = 1.0;
    } else {
      // Only reset changed effects
      if (changedEffects.has('damageMultiplier')) buffComponent.damageMultiplier = 1.0;
      if (changedEffects.has('damageReduction')) buffComponent.damageReduction = 0;
      if (changedEffects.has('criticalChance')) buffComponent.criticalChance = 0;
      if (changedEffects.has('criticalMultiplier')) buffComponent.criticalMultiplier = 1.0;
      if (changedEffects.has('speedMultiplier')) buffComponent.speedMultiplier = 1.0;
      if (changedEffects.has('fireRateMultiplier')) buffComponent.fireRateMultiplier = 1.0;
      if (changedEffects.has('healingMultiplier')) buffComponent.healingMultiplier = 1.0;
      if (changedEffects.has('experienceMultiplier')) buffComponent.experienceMultiplier = 1.0;
    }

    const entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs) return;

    // Apply all active buff effects
    for (const [buffId, activeBuff] of entityBuffs) {
      const definition = this.buffDefinitions.get(buffId);
      if (!definition) continue;

      const stackMultiplier = activeBuff.stacks;

      // Only update if this buff affects the changed effects (or if updating all)
      const shouldUpdate =
        !changedEffects ||
        Object.keys(definition.effects).some((effect) => changedEffects.has(effect as BuffEffectType));

      if (!shouldUpdate) continue;

      // Apply multiplicative effects
      if (definition.effects.damageMultiplier !== undefined) {
        buffComponent.damageMultiplier *= Math.pow(definition.effects.damageMultiplier, stackMultiplier);
        // Clamp damage multiplier
        buffComponent.damageMultiplier = Math.min(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER, buffComponent.damageMultiplier);
      }
      if (definition.effects.speedMultiplier !== undefined) {
        buffComponent.speedMultiplier *= Math.pow(definition.effects.speedMultiplier, stackMultiplier);
        // Clamp speed multiplier
        buffComponent.speedMultiplier = Math.max(
          BUFF_CONSTANTS.MIN_SPEED_MULTIPLIER,
          Math.min(BUFF_CONSTANTS.MAX_SPEED_MULTIPLIER, buffComponent.speedMultiplier)
        );
      }
      if (definition.effects.fireRateMultiplier !== undefined) {
        buffComponent.fireRateMultiplier *= Math.pow(definition.effects.fireRateMultiplier, stackMultiplier);
        // Clamp fire rate multiplier
        buffComponent.fireRateMultiplier = Math.min(
          BUFF_CONSTANTS.MAX_FIRE_RATE_MULTIPLIER,
          buffComponent.fireRateMultiplier
        );
      }
      if (definition.effects.criticalMultiplier !== undefined) {
        buffComponent.criticalMultiplier *= Math.pow(definition.effects.criticalMultiplier, stackMultiplier);
      }
      if (definition.effects.healingMultiplier !== undefined) {
        buffComponent.healingMultiplier *= Math.pow(definition.effects.healingMultiplier, stackMultiplier);
        // Clamp healing multiplier
        buffComponent.healingMultiplier = Math.min(
          BUFF_CONSTANTS.MAX_HEALING_MULTIPLIER,
          buffComponent.healingMultiplier
        );
      }
      if (definition.effects.experienceMultiplier !== undefined) {
        buffComponent.experienceMultiplier *= Math.pow(definition.effects.experienceMultiplier, stackMultiplier);
        // Clamp experience multiplier
        buffComponent.experienceMultiplier = Math.min(
          BUFF_CONSTANTS.MAX_EXPERIENCE_MULTIPLIER,
          buffComponent.experienceMultiplier
        );
      }

      // Apply additive effects (capped)
      if (definition.effects.damageReduction !== undefined) {
        buffComponent.damageReduction = Math.min(
          BUFF_CONSTANTS.MAX_DAMAGE_REDUCTION,
          buffComponent.damageReduction + definition.effects.damageReduction * stackMultiplier
        );
      }
      if (definition.effects.criticalChance !== undefined) {
        buffComponent.criticalChance = Math.min(
          BUFF_CONSTANTS.MAX_CRITICAL_CHANCE,
          buffComponent.criticalChance + definition.effects.criticalChance * stackMultiplier
        );
      }
    }
  }

  /**
   * Main system update - check buff expirations
   */
  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = window.performance.now();
    this._expiredBuffsBuffer.length = 0;

    // Check all buffed entities
    for (const entity of this.buffedEntities) {
      const entityBuffs = this.activeBuffs.get(entity);
      if (!entityBuffs) continue;

      // Check each buff for expiration
      for (const [buffId, activeBuff] of entityBuffs) {
        if (!activeBuff.isPermanent) {
          const elapsed = currentTime - activeBuff.startTime;
          if (elapsed >= activeBuff.duration) {
            this._expiredBuffsBuffer.push({ entity, buffId });
          }
        }
      }
    }

    // Remove expired buffs
    for (const { entity, buffId } of this._expiredBuffsBuffer) {
      const definition = this.buffDefinitions.get(buffId);

      // Remove the buff
      const entityBuffs = this.activeBuffs.get(entity);
      if (entityBuffs) {
        entityBuffs.delete(buffId);
        if (entityBuffs.size === 0) {
          this.activeBuffs.delete(entity);
          this.buffedEntities.delete(entity);
        }
      }

      // Update usage tracking
      this.buffsInUse.set(buffId, Math.max(0, (this.buffsInUse.get(buffId) ?? 0) - 1));

      // Update BuffComponent
      const buffComponent = entityManager.getComponent(entity, BuffComponent);
      if (buffComponent) {
        buffComponent.removeBuff(buffId);
        let effectsToUpdate: Set<BuffEffectType> | undefined;
        if (definition) {
          this._effectsToUpdateBuffer.clear();
          for (const effect of Object.keys(definition.effects) as BuffEffectType[]) {
            this._effectsToUpdateBuffer.add(effect);
          }
          effectsToUpdate = this._effectsToUpdateBuffer;
        }
        this.updateBuffEffects(entity, entityManager, effectsToUpdate);
      }

      // Call onExpire callback
      if (definition?.onExpire) {
        definition.onExpire(entity, entityManager);
      }

      this.emitEvent({
        type: 'expired',
        entity,
        buffId,
        timestamp: currentTime,
        details: { wasExpired: true },
      });

      if (window.debugLogBridge && Math.random() < BUFF_CONSTANTS.LOG_FREQUENCY) {
        this.logInfo(`⏰ Buff expired: ${definition?.name || buffId} on entity ${entity}`, { entity, buffId });
      }
    }
  }

  /**
   * Get all active buffs for an entity
   */
  getEntityBuffs(entity: number): ActiveBuff[] {
    const entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs) return [];

    return Array.from(entityBuffs.values());
  }

  /**
   * Check if entity has a specific buff
   */
  hasBuff(entity: number, buffId: string): boolean {
    return this.activeBuffs.get(entity)?.has(buffId) ?? false;
  }

  /**
   * Get remaining duration of a buff
   */
  getBuffRemainingTime(entity: number, buffId: string): number {
    const entityBuffs = this.activeBuffs.get(entity);
    if (!entityBuffs) return 0;

    const activeBuff = entityBuffs.get(buffId);
    if (!activeBuff || activeBuff.isPermanent) return -1;

    const elapsed = window.performance.now() - activeBuff.startTime;
    return Math.max(0, activeBuff.duration - elapsed);
  }

  /**
   * Subscribe to buff events
   */
  onBuffEvent(event: BuffEvent['type'], callback: (event: BuffEvent) => void): () => void {
    let callbacks = this.eventCallbacks.get(event);
    if (!callbacks) {
      callbacks = [];
      this.eventCallbacks.set(event, callbacks);
    }

    callbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.eventCallbacks.get(event);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index >= 0) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit a buff event
   */
  private emitEvent(event: BuffEvent): void {
    const callbacks = this.eventCallbacks.get(event.type);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(event);
      }
    }
  }

  /**
   * Get debug statistics
   */
  getDebugStats(): {
    totalBuffedEntities: number;
    totalActiveBuffs: number;
    buffsByCategory: Record<string, number>;
    mostCommonBuff: string | null;
    buffsInUse: Record<string, number>;
  } {
    let totalBuffs = 0;
    const buffCounts = new Map<string, number>();
    const categoryCount: Record<string, number> = {
      offensive: 0,
      defensive: 0,
      utility: 0,
      debuff: 0,
    };

    for (const entityBuffs of this.activeBuffs.values()) {
      for (const [buffId] of entityBuffs) {
        totalBuffs++;
        buffCounts.set(buffId, (buffCounts.get(buffId) || 0) + 1);

        const definition = this.buffDefinitions.get(buffId);
        if (definition) {
          categoryCount[definition.category]++;
        }
      }
    }

    let mostCommonBuff: string | null = null;
    let maxCount = 0;
    for (const [buffId, count] of buffCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonBuff = buffId;
      }
    }

    // Convert buffsInUse Map to object
    const buffsInUseObj: Record<string, number> = {};
    for (const [buffId, count] of this.buffsInUse) {
      if (count > 0) {
        buffsInUseObj[buffId] = count;
      }
    }

    return {
      totalBuffedEntities: this.buffedEntities.size,
      totalActiveBuffs: totalBuffs,
      buffsByCategory: categoryCount,
      mostCommonBuff,
      buffsInUse: buffsInUseObj,
    };
  }

  /**
   * Save buff state for persistence
   */
  saveBuffState(): Record<number, ActiveBuff[]> {
    const state: Record<number, ActiveBuff[]> = {};

    for (const [entityId, buffs] of this.activeBuffs) {
      state[entityId] = Array.from(buffs.values());
    }

    this.logInfo('💾 Buff state saved', {
      entityCount: Object.keys(state).length,
      totalBuffs: Object.values(state).reduce((acc, buffs) => acc + buffs.length, 0),
    });

    return state;
  }

  /**
   * Load buff state from persistence
   */
  loadBuffState(state: Record<number, ActiveBuff[]>, entityManager: EntityManager): void {
    // Clear existing buffs
    this.activeBuffs.clear();
    this.buffedEntities.clear();

    let loadedCount = 0;
    let failedCount = 0;

    for (const [entityIdStr, buffs] of Object.entries(state)) {
      const entityId = parseInt(entityIdStr);

      // Verify entity exists
      if (!entityManager.hasEntity(entityId)) {
        failedCount += buffs.length;
        continue;
      }

      // Restore each buff
      for (const buffData of buffs) {
        try {
          // Verify buff definition exists
          const definition = this.buffDefinitions.get(buffData.buffId);
          if (!definition) {
            failedCount++;
            continue;
          }

          // Recreate the buff
          let entityBuffs = this.activeBuffs.get(entityId);
          if (!entityBuffs) {
            entityBuffs = new Map();
            this.activeBuffs.set(entityId, entityBuffs);

            // Add BuffComponent if missing
            if (!entityManager.hasComponent(entityId, BuffComponent)) {
              entityManager.addComponent(entityId, new BuffComponent());
            }
          }

          entityBuffs.set(buffData.buffId, buffData);
          this.buffedEntities.add(entityId);
          loadedCount++;

          // Track buff usage
          this.buffsInUse.set(buffData.buffId, (this.buffsInUse.get(buffData.buffId) ?? 0) + 1);

          // Update BuffComponent
          const buffComponent = entityManager.getComponent(entityId, BuffComponent);
          if (buffComponent) {
            buffComponent.addBuff(buffData.buffId);
          }

          // Recalculate effects
          this.updateBuffEffects(entityId, entityManager);
        } catch (error) {
          failedCount++;
          this.logError('Failed to restore buff', {
            entityId,
            buffId: buffData.buffId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    this.logInfo('📂 Buff state loaded', {
      loadedCount,
      failedCount,
      totalEntities: this.activeBuffs.size,
    });
  }

  /**
   * Angular lifecycle hook - cleanup on service destruction
   */
  ngOnDestroy(): void {
    this.destroy();
  }

  /**
   * Reset all tracking data for game restart (called from GameEngine.reset())
   */
  reset(): void {
    // Clear active state but preserve definitions
    this.activeBuffs.clear();
    this.buffedEntities.clear();
    this.buffsInUse.clear();
    // Re-register built-in buff definitions (definitions were cleared by prior bugs)
    this.buffDefinitions.clear();
    this.conflictRules.clear();
    this.initializeBuiltInBuffs();
  }

  /**
   * Clean up all tracking data to prevent memory leaks
   */
  destroy(): void {
    this.buffDefinitions.clear();
    this.activeBuffs.clear();
    this.conflictRules.clear();
    this.buffedEntities.clear();
    this.eventCallbacks.clear();
    this.buffsInUse.clear();
  }

  /**
   * Clean up tracking for a dead entity (call from death-detection-system)
   */
  cleanupDeadEntity(entityId: number): void {
    this.activeBuffs.delete(entityId);
    this.buffedEntities.delete(entityId);
  }
}
