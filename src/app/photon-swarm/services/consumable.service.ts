import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { GameEngineService } from '../core/engine/game-engine.service';
import { PlayerService } from '../core/player/player.service';
import { StorageService } from './storage.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { BuffSystemService } from '../core/progression/buff-system.service';

export interface ConsumableItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  duration: number; // in seconds
  icon: string;
  category: 'combat' | 'defense' | 'utility';
  effectFn: () => boolean | void;
  cooldown?: number; // optional cooldown in seconds
  lastUsed?: number; // timestamp of last use
}

@Injectable({ providedIn: 'root' })
export class ConsumableService {
  private readonly CONSUMABLES_KEY = 'photon-swarm-consumables';
  private ownedConsumables: Map<string, number> = new Map();
  private consumableItems: ConsumableItem[] = [];
  private initialized = false;
  private cachedFrozenItems: ReadonlyArray<Readonly<ConsumableItem>> | null = null;

  /** Reactive inventory updates for HUD binding */
  readonly inventory$ = new BehaviorSubject<Map<string, number>>(new Map());

  constructor(
    private gameEngine: GameEngineService,
    private player: PlayerService,
    private storageService: StorageService,
    private debugLog: DebugLogBridgeService,
    private buffSystem: BuffSystemService
  ) {}

  /**
   * Initialize consumable definitions and load saved inventory.
   * Safe to call multiple times -- only runs once.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.initializeConsumables();
    this.loadOwnedConsumables();
  }

  private initializeConsumables(): void {
    this.consumableItems = [
      // Combat consumables
      {
        id: 'damage_boost',
        name: 'Power Surge',
        description: 'Double your damage output for 30 seconds',
        cost: 150,
        duration: 30,
        icon: 'fas fa-bolt',
        category: 'combat',
        effectFn: () => {
          const applied = this.gameEngine.applyConsumableBuff('power_surge', {
            damageMultiplier: 2.0,
            duration: 30000,
          });
          if (!applied) return false;
          this.debugLog.log('Consumable: Power Surge activated', 'info', { duration: 30 });
          return true;
        },
      },
      {
        id: 'rapid_fire',
        name: 'Rapid Fire',
        description: 'Triple your fire rate for 20 seconds',
        cost: 100,
        duration: 20,
        icon: 'fas fa-fire',
        category: 'combat',
        effectFn: () => {
          const applied = this.gameEngine.applyConsumableBuff('rapid_fire', {
            fireRateMultiplier: 3.0,
            duration: 20000,
          });
          if (!applied) return false;
          this.debugLog.log('Consumable: Rapid Fire activated', 'info', { duration: 20 });
          return true;
        },
      },
      {
        id: 'critical_boost',
        name: 'Critical Strike',
        description: '100% critical chance for 15 seconds',
        cost: 200,
        duration: 15,
        icon: 'fas fa-crosshairs',
        category: 'combat',
        effectFn: () => {
          const applied = this.gameEngine.applyConsumableBuff('critical_strike', {
            criticalChance: 1.0,
            criticalMultiplier: 2.0,
            duration: 15000,
          });
          if (!applied) return false;
          this.debugLog.log('Consumable: Critical Strike activated', 'info', { duration: 15 });
          return true;
        },
      },

      // Defense consumables
      {
        id: 'shield',
        name: 'Energy Shield',
        description: '50% damage reduction for 20 seconds',
        cost: 175,
        duration: 20,
        icon: 'fas fa-shield-alt',
        category: 'defense',
        effectFn: () => {
          const applied = this.gameEngine.applyConsumableBuff('energy_shield', {
            damageReduction: 0.5,
            duration: 20000,
          });
          if (!applied) return false;
          this.debugLog.log('Consumable: Energy Shield activated', 'info', { duration: 20 });
          return true;
        },
      },
      {
        id: 'heal_instant',
        name: 'Repair Kit',
        description: 'Instantly restore 50% of max health',
        cost: 100,
        duration: 0,
        icon: 'fas fa-wrench',
        category: 'defense',
        effectFn: () => {
          const maxHealth = this.gameEngine.player.getMaxHealth();
          this.gameEngine.heal(maxHealth * 0.5, 'consumable');
          this.debugLog.log('Consumable: Repair Kit used', 'info', { healAmount: maxHealth * 0.5 });
          return true;
        },
      },
      {
        id: 'invincibility',
        name: 'Phase Shift',
        description: 'Become invincible for 3 seconds',
        cost: 300,
        duration: 3,
        icon: 'fas fa-star',
        category: 'defense',
        cooldown: 60,
        effectFn: () => {
          this.player.activateInvincibility(3000);
          this.debugLog.log('Consumable: Phase Shift activated', 'info', { duration: 3 });
          return true;
        },
      },

      // Utility consumables
      {
        id: 'speed_boost',
        name: 'Turbo Boost',
        description: 'Double movement speed for 30 seconds',
        cost: 125,
        duration: 30,
        icon: 'fas fa-rocket',
        category: 'utility',
        // Route through BuffSystemService.movementSpeed — the source player.service reads
        // for speed calculation (gameEngine.movementSpeedMultiplier → buffSystem.movementSpeedMultiplier).
        effectFn: () => {
          this.buffSystem.applyBuff('turbo_boost', 'movementSpeed', 2.0, 30_000);
          this.debugLog.log('Consumable: Turbo Boost activated', 'info', { duration: 30 });
          return true;
        },
      },
      {
        id: 'xp_boost',
        name: 'XP Amplifier',
        description: 'Double XP gain for 60 seconds',
        cost: 250,
        duration: 60,
        icon: 'fas fa-certificate',
        category: 'utility',
        // Route through BuffSystemService.experienceGain — the source progression reads
        // (buffSystem.experienceGainMultiplier in ProgressionSystemService.addXp).
        effectFn: () => {
          this.buffSystem.applyBuff('xp_amplifier', 'experienceGain', 2.0, 60_000);
          this.debugLog.log('Consumable: XP Amplifier activated', 'info', { duration: 60 });
          return true;
        },
      },
      {
        id: 'magnet_field',
        name: 'Magnetic Field',
        description: 'Attract all shards on screen',
        cost: 75,
        duration: 0,
        icon: 'fas fa-magnet',
        category: 'utility',
        effectFn: () => {
          if (!this.gameEngine.magnetAllShards()) return false;
          this.debugLog.log('Consumable: Magnetic Field activated', 'info', {});
          return true;
        },
      },
    ];
  }

  private loadOwnedConsumables(): void {
    const saved = this.storageService.get<Record<string, number>>(this.CONSUMABLES_KEY) || {};
    const knownIds = new Set(this.consumableItems.map((item) => item.id));
    this.ownedConsumables = new Map(
      Object.entries(saved).filter(([id, quantity]) => knownIds.has(id) && Number.isInteger(quantity) && quantity > 0)
    );
    this.inventory$.next(new Map(this.ownedConsumables));
  }

  private saveOwnedConsumables(): boolean {
    const toSave = Object.fromEntries(this.ownedConsumables);
    const persisted = this.storageService.set(this.CONSUMABLES_KEY, toSave);
    if (persisted === false) return false;
    this.inventory$.next(new Map(this.ownedConsumables));
    return true;
  }

  /**
   * Purchase a consumable. Returns true if successful.
   */
  purchase(itemId: string): boolean {
    this.initialize();
    const item = this.consumableItems.find((candidate) => candidate.id === itemId);
    if (!item || !this.gameEngine.spendShards(item.cost)) return false;

    const current = this.ownedConsumables.get(itemId) || 0;
    this.ownedConsumables.set(itemId, current + 1);
    if (!this.saveOwnedConsumables()) {
      if (current > 0) this.ownedConsumables.set(itemId, current);
      else this.ownedConsumables.delete(itemId);
      this.gameEngine.refundShards(item.cost);
      return false;
    }

    this.debugLog.log('Consumable purchased', 'info', {
      item: itemId,
      quantity: current + 1,
      cost: item.cost,
    });
    return true;
  }

  /**
   * Use a consumable by ID. Returns true if successfully activated.
   */
  use(itemId: string): boolean {
    this.initialize(); // Ensure items are ready

    const quantity = this.ownedConsumables.get(itemId) || 0;
    if (quantity <= 0) return false;

    const item = this.consumableItems.find((i) => i.id === itemId);
    if (!item) return false;

    // Check cooldown
    if (item.cooldown && item.lastUsed) {
      const timeSinceUse = (Date.now() - item.lastUsed) / 1000;
      if (timeSinceUse < item.cooldown) {
        const remaining = Math.ceil(item.cooldown - timeSinceUse);
        this.debugLog.log('Consumable on cooldown', 'warning', {
          item: item.name,
          remaining,
        });
        return false;
      }
    }

    const previousLastUsed = item.lastUsed;
    item.lastUsed = Date.now();
    this.cachedFrozenItems = null; // lastUsed changed — invalidate frozen cache
    this.ownedConsumables.set(itemId, quantity - 1);
    if (quantity - 1 === 0) {
      this.ownedConsumables.delete(itemId);
    }
    if (!this.saveOwnedConsumables()) {
      this.ownedConsumables.set(itemId, quantity);
      item.lastUsed = previousLastUsed;
      this.cachedFrozenItems = null;
      return false;
    }

    try {
      if (item.effectFn() === false) throw new Error('Consumable effect was not applied');
    } catch (error) {
      this.ownedConsumables.set(itemId, quantity);
      item.lastUsed = previousLastUsed;
      this.cachedFrozenItems = null;
      const rollbackPersisted = this.saveOwnedConsumables();
      this.debugLog.log('Consumable effect failed; inventory restored', 'error', {
        item: item.name,
        error: error instanceof Error ? error.message : String(error),
        rollbackPersisted,
      });
      return false;
    }

    this.debugLog.log('Consumable used', 'info', {
      item: item.name,
      remaining: quantity - 1,
    });
    return true;
  }

  /** Get all consumable definitions */
  getAll(): ReadonlyArray<Readonly<ConsumableItem>> {
    this.initialize();
    if (!this.cachedFrozenItems) {
      this.cachedFrozenItems = Object.freeze(this.consumableItems.map((item) => Object.freeze({ ...item })));
    }
    return this.cachedFrozenItems;
  }

  /** Get quantity of a specific consumable */
  getQuantity(id: string): number {
    return this.ownedConsumables.get(id) || 0;
  }

  /**
   * Returns the first 3 owned consumable items for the hotbar.
   * Ordered by the canonical item list, filtered to items with quantity > 0.
   */
  getQuickSlots(): ReadonlyArray<Readonly<ConsumableItem>> {
    this.initialize();
    return this.consumableItems.filter((item) => this.getQuantity(item.id) > 0).slice(0, 3);
  }

  /** Look up a consumable item definition by ID */
  getItem(id: string): Readonly<ConsumableItem> | undefined {
    this.initialize();
    return this.consumableItems.find((i) => i.id === id);
  }

  /** Check if a consumable is on cooldown */
  isOnCooldown(item: Readonly<ConsumableItem>): boolean {
    if (!item.cooldown || !item.lastUsed) return false;
    const timeSinceUse = (Date.now() - item.lastUsed) / 1000;
    return timeSinceUse < item.cooldown;
  }

  /** Get remaining cooldown in seconds (rounded up) */
  getCooldownRemaining(item: Readonly<ConsumableItem>): number {
    if (!item.cooldown || !item.lastUsed) return 0;
    const timeSinceUse = (Date.now() - item.lastUsed) / 1000;
    const remaining = item.cooldown - timeSinceUse;
    return remaining > 0 ? Math.ceil(remaining) : 0;
  }
}
