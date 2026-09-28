import { Injectable } from '@angular/core';
import { GameEngineService } from '../core/engine/game-engine.service';
import { PlayerService } from '../core/player/player.service';
import { HANGAR_MODULE_TUNING, HangarModuleId } from '../config/hangar-module.config';
import { HangarLoadoutService } from './hangar-loadout.service';

/**
 * Mounts the single hangar module selected for the next deployment.
 *
 * The old shop stacked every purchased level into permanent power. Saved
 * levels are still treated as unlocks, but only the explicitly equipped
 * module is applied. That migration keeps purchases while restoring the
 * run itself as the main source of power.
 */
@Injectable({ providedIn: 'root' })
export class ShopUpgradeInitService {
  private applied = false;

  constructor(private readonly hangar: HangarLoadoutService) {}

  resetSession(): void {
    this.applied = false;
  }

  applyPersistedShopUpgrades(gameEngine: GameEngineService, player: PlayerService): void {
    if (this.applied) return;
    this.applied = true;

    const active = this.hangar.getSnapshot().activeModuleId;
    if (active === null || !this.hangar.isUnlocked(active)) return;

    this.applyModule(active, gameEngine, player);

    if (window.debugLogBridge) {
      window.debugLogBridge.log(`Hangar module mounted: ${active}`, 'info', {
        source: 'shop_upgrade_init',
        activeModule: active,
      });
    }
  }

  private applyModule(id: HangarModuleId, gameEngine: GameEngineService, player: PlayerService): void {
    const tuning = HANGAR_MODULE_TUNING;
    switch (id) {
      case 'max_health':
        gameEngine.increaseMaxHealth(tuning.maxHealth);
        break;
      case 'faster_reload':
        player.reduceDischargeTime(tuning.novaRechargeReduction);
        break;
      case 'speed_boost':
        player.increaseSpeed(tuning.movementSpeed);
        break;
      case 'magnetism_range':
        gameEngine.unlockShardMagnetism();
        gameEngine.enhanceShardMagnetism(tuning.magnetRange);
        break;
      case 'discharge_radius':
        player.increaseDischargeRadius(tuning.dischargeRadius);
        break;
      case 'beam_width':
        player.increaseBeamWidth(tuning.beamWidth);
        break;
      case 'health_regen':
        player.setHealthRegeneration(tuning.healthRegenPerSecond);
        break;
      case 'critical_hits':
        player.setCriticalHitChance(tuning.criticalHitChance);
        player.setCriticalHitMultiplier(tuning.criticalHitMultiplier);
        break;
      case 'double_points':
        player.setShardMultiplier(tuning.shardMultiplier);
        break;
      case 'shield_generator':
        gameEngine.applyEmergencyBarrierLevel(tuning.barrierLevel);
        break;
    }
  }
}
