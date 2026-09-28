// src/app/sections/pages/projects/lazy-projects/photon-swarm/core/player/player-upgrades.service.ts

import { Injectable } from '@angular/core';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { UPGRADE_EFFECTS } from '@photon/config/game-constants';
import { FOCUS_FIRE_CONFIG } from '@photon/config/constants/player';
import { AscensionService } from '../../services/ascension.service';
import { DEFAULT_BEAM_CORE_PROFILE, getBeamCoreProfile } from '../../config/beam-core.config';
import { BEAM_MUTATION_TUNINGS, resolveMutatedBeamCoreProfile } from '../../config/beam-mutation.config';
import type { BeamCoreId, BeamCoreProfile, BeamMutationId } from '../models/run-build.model';

/** Exact mutable player-upgrade state touched by run cards. */
export interface PlayerUpgradeTransactionSnapshot {
  beamCoreId: BeamCoreId | null;
  beamMutationIds: BeamMutationId[];
  maxHealth: number;
  speedMultiplier: number;
  dischargeRadiusMultiplier: number;
  beamWidthMultiplier: number;
  healthRegenRate: number;
  criticalHitChance: number;
  criticalHitMultiplier: number;
  shardMultiplier: number;
  beamDamageMultiplier: number;
  beamRotationMultiplier: number;
  beamSpeedMultiplier: number;
  hasDoubleBeam: boolean;
  dashCooldownReduction: number;
  burnChance: number;
  burnDamageMultiplier: number;
  recoilDamage: number;
  shardMagnetismBonus: number;
  effectChanceBonus: number;
  targetingHoldBonus: number;
  fireRateMultiplier: number;
  focusFirePenaltyLevel: number;
  emergencyProtocolsActive: boolean;
  emergencyHealingMultiplier: number;
  berserkerProtocolActive: boolean;
  berserkerMaxBonus: number;
  velocityMatrixActive: boolean;
  velocityMatrixSpeedBonus: number;
  velocityMatrixDamageBonus: number;
  shardSynthesisActive: boolean;
  shardSynthesisDuration: number;
  hasShardMagnetismFlag: boolean;
  hasDischargeFlag: boolean;
  hasVoidBeamFlag: boolean;
  hasShieldBreakerFlag: boolean;
}

/**
 * PlayerUpgradesService - Manages all player upgrade multipliers and unlock flags.
 *
 * Extracted from PlayerService to:
 * 1. Single Responsibility: Only handles upgrade state
 * 2. Easy Testing: Pure data, no side effects
 * 3. Clear API: All upgrade-related methods in one place
 */
@Injectable({ providedIn: 'root' })
export class PlayerUpgradesService {
  // ===== RUN IDENTITY =====
  private beamCoreId: BeamCoreId | null = null;
  private beamMutationIds: BeamMutationId[] = [];
  private resolvedBeamCoreProfile: BeamCoreProfile = DEFAULT_BEAM_CORE_PROFILE;

  // ===== HEALTH =====
  private maxHealth = 100;

  // ===== SHOP UPGRADE MULTIPLIERS =====
  private speedMultiplier = 1.0;
  private dischargeRadiusMultiplier = 1.0;
  private beamWidthMultiplier = 1.0;
  private healthRegenRate = 0;
  private criticalHitChance = 0;
  private criticalHitMultiplier = 1.5;
  private shardMultiplier = 1.0;

  // ===== BEAM UPGRADES =====
  private beamDamageMultiplier = 1.0;
  private beamRotationMultiplier = 1.0;
  private beamSpeedMultiplier = 1.0;
  private hasDoubleBeam = false;

  // ===== DASH UPGRADES =====
  private dashCooldownReduction = 0;

  // ===== BURN UPGRADES =====
  private burnChance = 0;
  private burnDamageMultiplier = 1.0;

  // ===== MISC UPGRADES =====
  private recoilDamage = 0;
  private shardMagnetismBonus = 0;
  private effectChanceBonus = 0;
  private targetingHoldBonus = 0;
  private fireRateMultiplier = 1.0;

  // ===== FOCUS FIRE UPGRADES =====
  // Base penalty: 20% speed reduction (0.80x). Each level reduces penalty by 5pp. Min: 5% (0.95x).
  private focusFirePenaltyLevel = 0; // 0 = 20%, 1 = 15%, 2 = 10%, 3 = 5%

  // ===== PROTOCOL UPGRADES =====
  private emergencyProtocolsActive = false;
  private emergencyHealingMultiplier = 1.0;
  private berserkerProtocolActive = false;
  private berserkerMaxBonus = 1.0;
  private velocityMatrixActive = false;
  private velocityMatrixSpeedBonus = 0.05;
  private velocityMatrixDamageBonus = 0.05;
  private shardSynthesisActive = false;
  private shardSynthesisDuration = 2000;

  // ===== EMERGENCY BARRIER (shop: shield_generator) =====
  /** True once the barrier has been purchased (any level). */
  private barrierPurchased = false;
  /** Purchased level; determines recharge time (30s − 5s × (level−1)). */
  private barrierLevel = 0;
  /** True when the barrier is ready to absorb a hit. */
  private barrierCharged = false;
  /** Recharge timer handle (window.setTimeout). */
  private barrierRechargeTimer: ReturnType<typeof setTimeout> | null = null;

  // ===== UNLOCK FLAGS =====
  private hasShardMagnetismFlag = false;
  private hasDischargeFlag = false;
  private hasVoidBeamFlag = false;
  private hasShieldBreakerFlag = false;

  constructor(
    private debugLog: DebugLogBridgeService,
    private ascensionService: AscensionService
  ) {}

  // ===== RESET =====
  reset(): void {
    this.beamCoreId = null;
    this.beamMutationIds.length = 0;
    this.resolvedBeamCoreProfile = DEFAULT_BEAM_CORE_PROFILE;
    this.maxHealth = 100;
    this.speedMultiplier = 1.0;
    this.beamDamageMultiplier = 1.0;
    this.beamRotationMultiplier = 1.0;
    this.beamWidthMultiplier = 1.0;
    this.dashCooldownReduction = 0;
    this.hasDoubleBeam = false;
    this.hasDischargeFlag = false;
    this.hasVoidBeamFlag = false;
    this.hasShieldBreakerFlag = false;
    this.criticalHitChance = 0;
    this.criticalHitMultiplier = 1.5; // Default is 1.5, not 2.0
    this.burnChance = 0;
    this.burnDamageMultiplier = 1.0;
    this.dischargeRadiusMultiplier = 1.0;
    this.healthRegenRate = 0;
    this.shardMultiplier = 1.0;
    this.recoilDamage = 0;
    this.effectChanceBonus = 0;
    this.targetingHoldBonus = 0;
    this.fireRateMultiplier = 1.0;
    this.focusFirePenaltyLevel = 0;
    this.emergencyProtocolsActive = false;
    this.emergencyHealingMultiplier = 1.0;
    this.berserkerProtocolActive = false;
    this.berserkerMaxBonus = 1.0;
    this.velocityMatrixActive = false;
    this.velocityMatrixSpeedBonus = 0.05;
    this.velocityMatrixDamageBonus = 0.05;
    this.shardSynthesisActive = false;
    this.shardSynthesisDuration = 2000;

    // Barrier charges reset on death but the purchase persists
    this.barrierCharged = this.barrierPurchased; // ready again on new run
    if (this.barrierRechargeTimer !== null) {
      clearTimeout(this.barrierRechargeTimer);
      this.barrierRechargeTimer = null;
    }

    // Shop-backed shard magnetism persists between runs. Run-card unlocks are
    // cleared above so a new run cannot inherit abilities it did not earn.
    if (this.hasShardMagnetismFlag) {
      this.shardMagnetismBonus = UPGRADE_EFFECTS.SHARD_MAGNETISM.UNLOCK_BONUS;
    } else {
      this.shardMagnetismBonus = 0;
    }

    this.beamSpeedMultiplier = 1.0;
  }

  /** Capture run-card state before applying a potentially multi-step effect. */
  captureUpgradeTransaction(): PlayerUpgradeTransactionSnapshot {
    return {
      beamCoreId: this.beamCoreId,
      beamMutationIds: [...this.beamMutationIds],
      maxHealth: this.maxHealth,
      speedMultiplier: this.speedMultiplier,
      dischargeRadiusMultiplier: this.dischargeRadiusMultiplier,
      beamWidthMultiplier: this.beamWidthMultiplier,
      healthRegenRate: this.healthRegenRate,
      criticalHitChance: this.criticalHitChance,
      criticalHitMultiplier: this.criticalHitMultiplier,
      shardMultiplier: this.shardMultiplier,
      beamDamageMultiplier: this.beamDamageMultiplier,
      beamRotationMultiplier: this.beamRotationMultiplier,
      beamSpeedMultiplier: this.beamSpeedMultiplier,
      hasDoubleBeam: this.hasDoubleBeam,
      dashCooldownReduction: this.dashCooldownReduction,
      burnChance: this.burnChance,
      burnDamageMultiplier: this.burnDamageMultiplier,
      recoilDamage: this.recoilDamage,
      shardMagnetismBonus: this.shardMagnetismBonus,
      effectChanceBonus: this.effectChanceBonus,
      targetingHoldBonus: this.targetingHoldBonus,
      fireRateMultiplier: this.fireRateMultiplier,
      focusFirePenaltyLevel: this.focusFirePenaltyLevel,
      emergencyProtocolsActive: this.emergencyProtocolsActive,
      emergencyHealingMultiplier: this.emergencyHealingMultiplier,
      berserkerProtocolActive: this.berserkerProtocolActive,
      berserkerMaxBonus: this.berserkerMaxBonus,
      velocityMatrixActive: this.velocityMatrixActive,
      velocityMatrixSpeedBonus: this.velocityMatrixSpeedBonus,
      velocityMatrixDamageBonus: this.velocityMatrixDamageBonus,
      shardSynthesisActive: this.shardSynthesisActive,
      shardSynthesisDuration: this.shardSynthesisDuration,
      hasShardMagnetismFlag: this.hasShardMagnetismFlag,
      hasDischargeFlag: this.hasDischargeFlag,
      hasVoidBeamFlag: this.hasVoidBeamFlag,
      hasShieldBreakerFlag: this.hasShieldBreakerFlag,
    };
  }

  /** Restore the exact pre-card state without replaying mutating upgrade methods. */
  restoreUpgradeTransaction(snapshot: PlayerUpgradeTransactionSnapshot): void {
    this.beamCoreId = snapshot.beamCoreId;
    this.beamMutationIds = [...snapshot.beamMutationIds];
    this.refreshResolvedBeamCoreProfile();
    this.maxHealth = snapshot.maxHealth;
    this.speedMultiplier = snapshot.speedMultiplier;
    this.dischargeRadiusMultiplier = snapshot.dischargeRadiusMultiplier;
    this.beamWidthMultiplier = snapshot.beamWidthMultiplier;
    this.healthRegenRate = snapshot.healthRegenRate;
    this.criticalHitChance = snapshot.criticalHitChance;
    this.criticalHitMultiplier = snapshot.criticalHitMultiplier;
    this.shardMultiplier = snapshot.shardMultiplier;
    this.beamDamageMultiplier = snapshot.beamDamageMultiplier;
    this.beamRotationMultiplier = snapshot.beamRotationMultiplier;
    this.beamSpeedMultiplier = snapshot.beamSpeedMultiplier;
    this.hasDoubleBeam = snapshot.hasDoubleBeam;
    this.dashCooldownReduction = snapshot.dashCooldownReduction;
    this.burnChance = snapshot.burnChance;
    this.burnDamageMultiplier = snapshot.burnDamageMultiplier;
    this.recoilDamage = snapshot.recoilDamage;
    this.shardMagnetismBonus = snapshot.shardMagnetismBonus;
    this.effectChanceBonus = snapshot.effectChanceBonus;
    this.targetingHoldBonus = snapshot.targetingHoldBonus;
    this.fireRateMultiplier = snapshot.fireRateMultiplier;
    this.focusFirePenaltyLevel = snapshot.focusFirePenaltyLevel;
    this.emergencyProtocolsActive = snapshot.emergencyProtocolsActive;
    this.emergencyHealingMultiplier = snapshot.emergencyHealingMultiplier;
    this.berserkerProtocolActive = snapshot.berserkerProtocolActive;
    this.berserkerMaxBonus = snapshot.berserkerMaxBonus;
    this.velocityMatrixActive = snapshot.velocityMatrixActive;
    this.velocityMatrixSpeedBonus = snapshot.velocityMatrixSpeedBonus;
    this.velocityMatrixDamageBonus = snapshot.velocityMatrixDamageBonus;
    this.shardSynthesisActive = snapshot.shardSynthesisActive;
    this.shardSynthesisDuration = snapshot.shardSynthesisDuration;
    this.hasShardMagnetismFlag = snapshot.hasShardMagnetismFlag;
    this.hasDischargeFlag = snapshot.hasDischargeFlag;
    this.hasVoidBeamFlag = snapshot.hasVoidBeamFlag;
    this.hasShieldBreakerFlag = snapshot.hasShieldBreakerFlag;
  }

  // ===== BEAM CORE =====
  hasBeamCore(): boolean {
    return this.beamCoreId !== null;
  }

  getBeamCoreId(): BeamCoreId | null {
    return this.beamCoreId;
  }

  getBeamCoreProfile(): BeamCoreProfile {
    return this.resolvedBeamCoreProfile;
  }

  selectBeamCore(coreId: BeamCoreId): void {
    if (this.beamCoreId !== null && this.beamCoreId !== coreId) {
      throw new Error(`Beam Core ${this.beamCoreId} is already bound for this run`);
    }
    this.beamCoreId = coreId;
    this.refreshResolvedBeamCoreProfile();
    this.debugLog.log(`Beam Core bound: ${getBeamCoreProfile(coreId).name}`, 'success', {
      source: 'player_upgrades',
      operation: 'beam_core_bound',
      coreId,
    });
  }

  getBeamMutationIds(): readonly BeamMutationId[] {
    return this.beamMutationIds;
  }

  evolveBeamCore(mutationId: BeamMutationId): void {
    if (this.beamMutationIds.includes(mutationId)) return;
    const mutation = BEAM_MUTATION_TUNINGS[mutationId];
    if (this.beamCoreId !== mutation.coreId) {
      throw new Error(`Mutation ${mutationId} is incompatible with Beam Core ${this.beamCoreId ?? 'unbound'}`);
    }
    this.beamMutationIds.push(mutationId);
    this.refreshResolvedBeamCoreProfile();
    this.debugLog.log(`Beam Core evolved: ${mutationId}`, 'success', {
      source: 'player_upgrades',
      operation: 'beam_core_evolved',
      coreId: this.beamCoreId,
      mutationId,
    });
  }

  private refreshResolvedBeamCoreProfile(): void {
    this.resolvedBeamCoreProfile = resolveMutatedBeamCoreProfile(this.beamCoreId, this.beamMutationIds);
  }

  // ===== MAX HEALTH =====
  getMaxHealth(): number {
    return Math.floor(this.maxHealth * this.ascensionService.getHealthBonus());
  }

  setMaxHealth(newMax: number): void {
    this.maxHealth = Math.max(1, newMax);
  }

  increaseMaxHealth(amount: number): void {
    this.maxHealth = Math.max(1, this.maxHealth + amount);
  }

  // ===== SPEED =====
  getSpeedMultiplier(): number {
    return this.speedMultiplier;
  }

  increaseSpeed(amount: number): void {
    this.speedMultiplier *= 1 + amount;
  }

  // ===== DISCHARGE =====
  getDischargeRadiusMultiplier(): number {
    return this.dischargeRadiusMultiplier;
  }

  increaseDischargeRadius(multiplier: number): void {
    this.dischargeRadiusMultiplier = Math.min(this.dischargeRadiusMultiplier * (1 + multiplier), 3.0);
  }

  // ===== BEAM WIDTH =====
  getBeamWidthMultiplier(): number {
    return this.beamWidthMultiplier;
  }

  increaseBeamWidth(multiplier: number): void {
    this.beamWidthMultiplier *= 1 + multiplier;
  }

  // ===== HEALTH REGEN =====
  getHealthRegenRate(): number {
    return this.healthRegenRate;
  }

  setHealthRegeneration(healthPerSecond: number): void {
    this.healthRegenRate = healthPerSecond;
  }

  // ===== CRITICAL HIT =====
  getCriticalHitChance(): number {
    return this.criticalHitChance;
  }

  setCriticalHitChance(chance: number): void {
    this.criticalHitChance = Math.min(1, Math.max(0, chance));
  }

  getCriticalHitMultiplier(): number {
    return this.criticalHitMultiplier;
  }

  setCriticalHitMultiplier(multiplier: number): void {
    this.criticalHitMultiplier = multiplier;
  }

  // ===== SHARD =====
  getShardMultiplier(): number {
    return this.shardMultiplier;
  }

  setShardMultiplier(multiplier: number): void {
    this.shardMultiplier = multiplier;
  }

  // ===== BEAM DAMAGE =====
  getBeamDamageMultiplier(): number {
    return this.beamDamageMultiplier;
  }

  increaseBeamDamage(percentage: number): void {
    this.beamDamageMultiplier *= 1 + percentage;
    this.debugLog.log(`⚡ Beam damage increased by ${(percentage * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      operation: 'beam_damage_upgrade',
      multiplierAfter: this.beamDamageMultiplier,
    });
  }

  // ===== BEAM ROTATION =====
  getBeamRotationMultiplier(): number {
    return this.beamRotationMultiplier;
  }

  increaseBeamRotationSpeed(percentage: number): void {
    this.beamRotationMultiplier *= 1 + percentage;
    this.debugLog.log(`🔄 Beam rotation speed increased by ${(percentage * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      operation: 'beam_rotation_upgrade',
      multiplierAfter: this.beamRotationMultiplier,
    });
  }

  // ===== BEAM SPEED =====
  getBeamSpeedMultiplier(): number {
    return this.beamSpeedMultiplier;
  }

  increaseBeamSpeed(percentage: number): void {
    this.beamSpeedMultiplier *= 1 + percentage;
    this.debugLog.log(`⚡ Beam speed increased by ${(percentage * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      operation: 'beam_speed_upgrade',
      multiplierAfter: this.beamSpeedMultiplier,
    });
  }

  // ===== DOUBLE BEAM =====
  getHasDoubleBeam(): boolean {
    return this.hasDoubleBeam;
  }

  unlockDoubleBeam(): void {
    this.hasDoubleBeam = true;
    this.debugLog.log('⚡⚡ Double beam unlocked!', 'info');
  }

  // ===== DASH COOLDOWN =====
  getDashCooldownReduction(): number {
    return this.dashCooldownReduction;
  }

  increaseDashEfficiency(percentage: number): void {
    this.dashCooldownReduction = Math.min(0.75, this.dashCooldownReduction + percentage);
    this.debugLog.log(`💨 Dash cooldown reduced by ${(percentage * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      operation: 'dash_cooldown_upgrade',
      totalReduction: this.dashCooldownReduction,
    });
  }

  // ===== BURN =====
  getBurnChance(): number {
    return this.burnChance;
  }

  addBurnChance(percentage: number): void {
    this.burnChance = Math.min(1, this.burnChance + percentage);
    this.debugLog.log(`🔥 Burn chance increased to ${(this.burnChance * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      operation: 'burn_chance_upgrade',
      burnChance: this.burnChance,
    });
  }

  getBurnDamageMultiplier(): number {
    return this.burnDamageMultiplier;
  }

  increaseBurnDamage(percentage: number): void {
    this.burnDamageMultiplier *= 1 + percentage;
    this.debugLog.log(`🔥 Burn damage increased by ${(percentage * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      operation: 'burn_damage_upgrade',
      multiplierAfter: this.burnDamageMultiplier,
    });
  }

  getBurnDamage(): number {
    return 5 * this.burnDamageMultiplier;
  }

  // ===== RECOIL =====
  getRecoilDamage(): number {
    return this.recoilDamage;
  }

  addRecoilDamage(percentage: number): void {
    this.recoilDamage += percentage * 10;
    this.debugLog.log(`🛡️ Recoil damage increased to ${this.recoilDamage}`, 'info', {
      source: 'player_upgrades',
      operation: 'recoil_damage_upgrade',
      recoilDamage: this.recoilDamage,
    });
  }

  // ===== SHARD MAGNETISM =====
  getShardMagnetismBonus(): number {
    return this.shardMagnetismBonus;
  }

  enhanceShardMagnetism(amount: number): void {
    this.shardMagnetismBonus += amount;
    this.debugLog.log(`🧲 Shard magnetism increased by ${amount}`, 'info', {
      source: 'player_upgrades',
      operation: 'shard_magnetism_upgrade',
      totalBonus: this.shardMagnetismBonus,
    });
  }

  // ===== EFFECT CHANCE =====
  getEffectChanceBonus(): number {
    return this.effectChanceBonus;
  }

  increaseEffectChance(percentage: number): void {
    this.effectChanceBonus += percentage;
    this.debugLog.log(`✨ Effect chance increased by ${(percentage * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      operation: 'effect_chance_upgrade',
      totalBonus: this.effectChanceBonus,
    });
  }

  // ===== TARGETING HOLD =====
  getTargetingHoldBonus(): number {
    return this.targetingHoldBonus;
  }

  increaseTargetingHoldDuration(count: number): void {
    this.targetingHoldBonus += count * 0.5;
    this.debugLog.log(`🎯 Targeting hold increased by ${count * 0.5} seconds`, 'info', {
      source: 'player_upgrades',
      operation: 'targeting_hold_upgrade',
      totalBonus: this.targetingHoldBonus,
    });
  }

  // ===== FIRE RATE =====
  getFireRateMultiplier(): number {
    return this.fireRateMultiplier;
  }

  increaseFireRate(percentage: number): void {
    this.fireRateMultiplier *= 1 + percentage;
    this.debugLog.log(`🔫 Fire rate increased by ${(percentage * 100).toFixed(0)}%`, 'info', {
      source: 'player_upgrades',
      multiplierAfter: this.fireRateMultiplier,
    });
  }

  // ===== FOCUS FIRE =====
  /** Speed multiplier during Focus Fire. Base: 0.80 (20% penalty), upgradeable to 0.95 (5% penalty). */
  getFocusFireSpeedMultiplier(): number {
    const cfg = FOCUS_FIRE_CONFIG.SPEED_PENALTY;
    const level = Math.min(this.focusFirePenaltyLevel, cfg.MAX_LEVEL);
    const penalty = Math.max(cfg.MIN, cfg.BASE - level * cfg.REDUCTION_PER_LEVEL);
    return 1 - penalty;
  }

  upgradeFocusFirePenalty(): void {
    if (this.focusFirePenaltyLevel >= 3) return;
    this.focusFirePenaltyLevel++;
    this.debugLog.log(`🎯 Focus Fire penalty reduced (level ${this.focusFirePenaltyLevel})`, 'info', {
      source: 'player_upgrades',
      speedMultiplier: this.getFocusFireSpeedMultiplier(),
    });
  }

  getFocusFirePenaltyLevel(): number {
    return this.focusFirePenaltyLevel;
  }

  // ===== EMERGENCY PROTOCOLS =====
  hasEmergencyProtocols(): boolean {
    return this.emergencyProtocolsActive;
  }

  getEmergencyHealingMultiplier(): number {
    return this.emergencyHealingMultiplier;
  }

  setEmergencyProtocols(enabled: boolean, multiplier: number = 1.5): void {
    this.emergencyProtocolsActive = enabled;
    if (enabled) {
      this.emergencyHealingMultiplier = multiplier;
    }
  }

  // ===== BERSERKER PROTOCOL =====
  hasBerserkerProtocol(): boolean {
    return this.berserkerProtocolActive;
  }

  getBerserkerMaxBonus(): number {
    return this.berserkerMaxBonus;
  }

  setBerserkerProtocol(enabled: boolean, maxBonus: number = 1.0): void {
    this.berserkerProtocolActive = enabled;
    if (enabled) {
      this.berserkerMaxBonus = maxBonus;
    }
  }

  // ===== VELOCITY MATRIX =====
  hasVelocityMatrix(): boolean {
    return this.velocityMatrixActive;
  }

  getVelocityMatrixBonuses(): { speedBonus: number; damageBonus: number } {
    return {
      speedBonus: this.velocityMatrixSpeedBonus,
      damageBonus: this.velocityMatrixDamageBonus,
    };
  }

  setVelocityMatrix(enabled: boolean, speedBonus: number = 0.05, damageBonus: number = 0.05): void {
    this.velocityMatrixActive = enabled;
    if (enabled) {
      this.velocityMatrixSpeedBonus = speedBonus;
      this.velocityMatrixDamageBonus = damageBonus;
    }
  }

  // ===== SHARD SYNTHESIS =====
  hasShardSynthesis(): boolean {
    return this.shardSynthesisActive;
  }

  getShardSynthesisDuration(): number {
    return this.shardSynthesisDuration;
  }

  setShardSynthesis(enabled: boolean, duration: number = 2000): void {
    this.shardSynthesisActive = enabled;
    if (enabled) {
      this.shardSynthesisDuration = duration;
      this.debugLog.log('💎 Shard Synthesis activated', 'info', {
        source: 'player_upgrades',
        operation: 'shard_synthesis_activated',
        duration: `${duration}ms`,
      });
    }
  }

  // ===== EMERGENCY BARRIER (shop: shield_generator) =====

  /**
   * Grant the barrier at the given shop level (1–3).
   * Called both at purchase time and during run-init restore.
   * Higher levels shorten the recharge: 30s − 5s × (level−1).
   */
  applyBarrierLevel(level: number): void {
    this.barrierPurchased = true;
    this.barrierLevel = Math.max(this.barrierLevel, level);
    this.barrierCharged = true; // ready immediately
    if (this.barrierRechargeTimer !== null) {
      clearTimeout(this.barrierRechargeTimer);
      this.barrierRechargeTimer = null;
    }
    this.debugLog.log(`🛡️ Emergency Barrier level ${this.barrierLevel} applied`, 'info');
  }

  hasBarrier(): boolean {
    return this.barrierPurchased;
  }

  isBarrierCharged(): boolean {
    return this.barrierCharged;
  }

  /**
   * Consume the barrier charge (absorbs one hit) and start the recharge timer.
   * The caller must call this when the player would have taken damage.
   */
  consumeBarrierCharge(): void {
    if (!this.barrierCharged) return;
    this.barrierCharged = false;
    // Recharge time: 30s at level 1, reduced by 5s per extra level (min 10s)
    const rechargeMs = Math.max(10_000, (30 - (this.barrierLevel - 1) * 5) * 1_000);
    this.barrierRechargeTimer = setTimeout(() => {
      this.barrierCharged = true;
      this.barrierRechargeTimer = null;
      this.debugLog.log('🛡️ Emergency Barrier recharged', 'info');
    }, rechargeMs);
    this.debugLog.log(`🛡️ Emergency Barrier absorbed a hit — recharging in ${rechargeMs / 1000}s`, 'info');
  }

  // ===== UNLOCK METHODS =====
  getHasShardMagnetism(): boolean {
    return this.hasShardMagnetismFlag;
  }

  unlockShardMagnetism(): void {
    this.hasShardMagnetismFlag = true;
    this.shardMagnetismBonus = UPGRADE_EFFECTS.SHARD_MAGNETISM.UNLOCK_BONUS;
    this.debugLog.log('🧲 Shard magnetism unlocked!', 'info');
  }

  getHasDischarge(): boolean {
    return this.hasDischargeFlag;
  }

  unlockDischarge(): void {
    this.hasDischargeFlag = true;
    this.debugLog.log('💥 Discharge ability unlocked!', 'info');
  }

  getHasVoidBeam(): boolean {
    return this.hasVoidBeamFlag;
  }

  unlockVoidBeam(): void {
    this.hasVoidBeamFlag = true;
    this.debugLog.log('🌌 Void beam unlocked!', 'info');
  }

  getHasShieldBreaker(): boolean {
    return this.hasShieldBreakerFlag;
  }

  unlockShieldBreaker(): void {
    this.hasShieldBreakerFlag = true;
    this.debugLog.log('🔨 Shield breaker unlocked!', 'info');
  }
}
