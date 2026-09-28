import { Injectable } from '@angular/core';
import { EngineSystem } from '../utils/system';
import { EngineApi } from '../utils/engine-api';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

export interface TimedBuff {
  id: string;
  stat: keyof BuffMultipliers;
  multiplier: number;
  /** Duration in ms – use Infinity for permanent */
  duration: number;
  startTime: number;
}

/** Multipliers we can influence on the engine façade */
export interface BuffMultipliers {
  movementSpeed: number;
  beamDamage: number;
  damageTaken: number;
  effectChance: number;
  burnDamage: number;
  experienceGain: number;
}

export interface BuffUpgradeTransactionSnapshot {
  activeBuffs: TimedBuff[];
  multipliers: BuffMultipliers;
}

@EngineSystem()
@Injectable({ providedIn: 'root' })
export class BuffSystemService {
  engine!: EngineApi;
  private readonly activeBuffs: TimedBuff[] = [];
  private readonly multipliers: BuffMultipliers = {
    movementSpeed: 1,
    beamDamage: 1,
    damageTaken: 1,
    effectChance: 1,
    burnDamage: 1,
    experienceGain: 1,
  };

  constructor(private debugLog: DebugLogBridgeService) {}

  attachEngine(engine: EngineApi): void {
    this.engine = engine;
  }

  // Alias expected by GameEngineService for now
  setGameEngine(engine: EngineApi): void {
    this.attachEngine(engine);
  }

  /** Apply a buff – duplicates stack multiplicatively. */
  applyBuff(id: string, stat: keyof BuffMultipliers, multiplier: number, durationMs: number): void {
    const now = Date.now();

    // Stack limit: max 2 active buffs per stat to prevent runaway multipliers
    const activeForStat = this.activeBuffs.filter((b) => b.stat === stat && now - b.startTime < b.duration);
    if (activeForStat.length >= 2) {
      this.debugLog.log(`⚠️ Buff stack limit reached for ${stat}`, 'warning', {
        source: 'buff_system',
        stat,
        activeCount: activeForStat.length,
        buffId: id,
      });
      return;
    }

    const previousMultiplier = this.multipliers[stat];

    this.activeBuffs.push({ id, stat, multiplier, duration: durationMs, startTime: now });
    this.multipliers[stat] *= multiplier;

    // Log buff application
    this.debugLog.log(`🎆 Buff applied: ${id}`, multiplier > 1 ? 'success' : 'warning', {
      source: 'buff_system',
      operation: 'apply_buff',
      buffId: id,
      stat,
      multiplier,
      duration: durationMs === Infinity ? 'permanent' : `${durationMs}ms`,
      previousMultiplier,
      newMultiplier: this.multipliers[stat],
      activeBuffs: this.activeBuffs.length,
    });
  }

  /** Call once per frame from the façade */
  update(): void {
    const now = Date.now();
    const expiredBuffs: TimedBuff[] = [];

    for (let i = this.activeBuffs.length - 1; i >= 0; i--) {
      const buff = this.activeBuffs[i];
      if (now - buff.startTime >= buff.duration) {
        // Expire
        expiredBuffs.push(buff);
        this.activeBuffs.splice(i, 1);
        this.multipliers[buff.stat] /= buff.multiplier; // Revert effect
      }
    }

    // Log expired buffs
    for (const buff of expiredBuffs) {
      this.debugLog.log(`⏳ Buff expired: ${buff.id}`, 'info', {
        source: 'buff_system',
        operation: 'expire_buff',
        buffId: buff.id,
        stat: buff.stat,
        multiplier: buff.multiplier,
        duration: buff.duration,
        newMultiplier: this.multipliers[buff.stat],
        remainingBuffs: this.activeBuffs.length,
      });
    }
  }

  captureUpgradeTransaction(): BuffUpgradeTransactionSnapshot {
    return {
      activeBuffs: this.activeBuffs.map((buff) => ({ ...buff })),
      multipliers: { ...this.multipliers },
    };
  }

  restoreUpgradeTransaction(snapshot: BuffUpgradeTransactionSnapshot): void {
    this.activeBuffs.length = 0;
    this.activeBuffs.push(...snapshot.activeBuffs.map((buff) => ({ ...buff })));
    (Object.keys(this.multipliers) as (keyof BuffMultipliers)[]).forEach((stat) => {
      this.multipliers[stat] = snapshot.multipliers[stat];
    });
  }

  // ——— Exposed multipliers ———
  get movementSpeedMultiplier(): number {
    return this.multipliers.movementSpeed;
  }
  get beamDamageMultiplier(): number {
    return this.multipliers.beamDamage;
  }
  get damageTakenMultiplier(): number {
    return this.multipliers.damageTaken;
  }
  get effectChanceMultiplier(): number {
    return this.multipliers.effectChance;
  }
  get burnDamageMultiplier(): number {
    return this.multipliers.burnDamage;
  }
  get experienceGainMultiplier(): number {
    return this.multipliers.experienceGain;
  }

  /** Remove a buff by ID (for curse removal or manual buff cancellation) */
  removeBuffById(id: string): boolean {
    const buffIndex = this.activeBuffs.findIndex((buff) => buff.id === id);

    if (buffIndex === -1) {
      return false;
    }

    const buff = this.activeBuffs[buffIndex];

    // Revert the multiplier effect (same logic as expiration)
    this.multipliers[buff.stat] /= buff.multiplier;

    // Remove from active buffs
    this.activeBuffs.splice(buffIndex, 1);

    // Log buff removal
    this.debugLog.log(`🚫 Buff removed: ${id}`, 'info', {
      source: 'buff_system',
      operation: 'remove_buff',
      buffId: id,
      stat: buff.stat,
      multiplier: buff.multiplier,
      newMultiplier: this.multipliers[buff.stat],
      remainingBuffs: this.activeBuffs.length,
    });

    return true;
  }

  reset(): void {
    // Clear all buffs instantly (e.g., on new game)
    const previousBuffCount = this.activeBuffs.length;
    const previousMultipliers = { ...this.multipliers };

    this.activeBuffs.length = 0;
    (Object.keys(this.multipliers) as (keyof BuffMultipliers)[]).forEach((k) => {
      this.multipliers[k] = 1;
    });

    // Log buff system reset
    this.debugLog.log('🔄 Buff system reset', 'warning', {
      source: 'buff_system',
      operation: 'reset',
      clearedBuffs: previousBuffCount,
      previousMultipliers,
      newMultipliers: this.multipliers,
    });
  }

  /** Directly override a base multiplier (used by engine when loading saves or absolute effects) */
  setBaseMultiplier(stat: keyof BuffMultipliers, value: number): void {
    const previousValue = this.multipliers[stat];
    this.multipliers[stat] = value;

    // Log base multiplier change
    this.debugLog.log(`🎯 Base multiplier set: ${stat}`, 'info', {
      source: 'buff_system',
      operation: 'set_base_multiplier',
      stat,
      previousValue,
      newValue: value,
      change: value > previousValue ? 'increased' : value < previousValue ? 'decreased' : 'unchanged',
    });
  }
}
