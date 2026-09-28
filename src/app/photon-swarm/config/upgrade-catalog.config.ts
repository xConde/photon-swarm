import { CORE_UPGRADE_EFFECTS, percentage, UPGRADE_EFFECTS } from '@photon/config/game-constants';
import type { GameEngineService } from '../core/engine/game-engine.service';
import type { UpgradeEffectPhase, UpgradeOption } from '../core/models/upgrade.model';
import { BEAM_CORE_IDS, BEAM_CORE_PROFILES } from './beam-core.config';
import { BEAM_MUTATION_OPTIONS } from './beam-mutation.config';
import { RUN_ANOMALY_OPTIONS } from './run-anomaly.config';
import { RUN_RELIC_OPTIONS } from './run-relic.config';
import { RUN_ROUTE_OPTIONS } from './run-route.config';

const pct = percentage;

function increaseMaxHealthForPhase(
  game: GameEngineService,
  amount: number,
  phase: UpgradeEffectPhase | undefined
): void {
  if (phase === 'restore') {
    game.player.increaseMaxHealth(amount);
    return;
  }
  game.increaseMaxHealth(amount);
}

/** Authored run rewards. Runtime eligibility and transactions live in UpgradeService. */
export const UPGRADE_CATALOG: UpgradeOption[] = [
  ...BEAM_CORE_IDS.map((coreId): UpgradeOption => {
    const core = BEAM_CORE_PROFILES[coreId];
    return {
      id: `beam_core_${coreId}`,
      name: core.name,
      designation: core.designation,
      description: core.description,
      signature: core.signature,
      tradeoff: core.tradeoff,
      buildTags: [...core.tags],
      exclusiveGroup: 'beam-core',
      category: 'beam-core',
      icon: coreId === 'lance' ? 'ph-arrow-up-right' : coreId === 'prism' ? 'ph-triangle' : 'ph-lightning',
      effect: (game) => game.selectBeamCore(coreId),
      type: 'upgrade',
      rarity: 'core',
    };
  }),
  ...BEAM_MUTATION_OPTIONS,
  ...RUN_RELIC_OPTIONS,
  ...RUN_ROUTE_OPTIONS,
  ...RUN_ANOMALY_OPTIONS,
  /* CORE ─────────────────────────────────────────────────────────────── */
  /* Simple, impactful upgrades with icon + word + short flavor text       */
  /* These form ~40% of the upgrade pool, balanced with uncommon tier      */
  {
    id: 'core_speed',
    name: 'Speed',
    description: 'Thruster output increased',
    icon: 'ph-lightning',
    effect: (g, c = 1) => {
      g.increaseMovementSpeed(pct(CORE_UPGRADE_EFFECTS.SPEED.INCREASE_PERCENT));
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`⚡ Speed: +${CORE_UPGRADE_EFFECTS.SPEED.INCREASE_PERCENT}%`, 'success', {
          source: 'upgrade_service',
          operation: 'core_speed',
          stacks: c,
        });
      }
    },
    type: 'upgrade',
    rarity: 'core',
  },
  {
    id: 'core_power',
    name: 'Power',
    description: 'Beam energy amplified',
    icon: 'ph-crosshair',
    effect: (g, c = 1) => {
      g.increaseBeamDamage(pct(CORE_UPGRADE_EFFECTS.POWER.INCREASE_PERCENT));
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`💥 Power: +${CORE_UPGRADE_EFFECTS.POWER.INCREASE_PERCENT}%`, 'success', {
          source: 'upgrade_service',
          operation: 'core_power',
          stacks: c,
        });
      }
    },
    type: 'upgrade',
    rarity: 'core',
  },
  {
    id: 'core_shield',
    name: 'Shield',
    description: 'Hull reinforcement installed',
    icon: 'ph-shield',
    effect: (g, c = 1, phase) => {
      increaseMaxHealthForPhase(g, CORE_UPGRADE_EFFECTS.SHIELD.INCREASE_AMOUNT, phase);
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`🛡️ Shield: +${CORE_UPGRADE_EFFECTS.SHIELD.INCREASE_AMOUNT} HP`, 'success', {
          source: 'upgrade_service',
          operation: 'core_shield',
          stacks: c,
        });
      }
    },
    type: 'upgrade',
    rarity: 'core',
  },
  {
    id: 'core_magnet',
    name: 'Magnet',
    description: 'Collection field expanded',
    icon: 'ph-magnet',
    effect: (g, c = 1) => {
      g.enhanceShardMagnetism(CORE_UPGRADE_EFFECTS.MAGNET.INCREASE_RANGE);
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`🧲 Magnet: +${CORE_UPGRADE_EFFECTS.MAGNET.INCREASE_RANGE} range`, 'success', {
          source: 'upgrade_service',
          operation: 'core_magnet',
          stacks: c,
        });
      }
    },
    type: 'upgrade',
    rarity: 'core',
  },

  /* UNCOMMON ─────────────────────────────────────────────────────────── */
  /* Advanced upgrades promoted from Common tier with 2.5-3x buffs        */
  {
    id: 'health_regen',
    name: 'Nanite Repair System',
    description: 'Advanced nanites repair your shield at +8 HP/sec with instant 60 HP heal.',
    effect: (g, _c = 1, phase) => {
      // BUFFED 2.5x: 3 → 8 HP per second health regeneration
      const currentRegen = g.player.getHealthRegenRate();
      g.player.setHealthRegeneration(currentRegen + 8);

      // BUFFED 2.5x: 25 → 60 HP instant heal bonus
      if (phase !== 'restore') {
        const currentHealth = g.getPlayerHealth();
        const maxHealth = g.getPlayerMaxHealth();
        if (currentHealth < maxHealth) {
          const healAmount = Math.min(60, maxHealth - currentHealth);
          g.heal(healAmount, 'nanite_repair_system_bonus');
        }
      }
    },
    type: 'upgrade',
    rarity: 'uncommon', // Promoted from common to uncommon (Advanced tier)
  },
  {
    id: 'fire_rate_boost',
    name: 'Rapid Capacitors',
    description: 'Overclocked weapon systems cycle much faster (+25% fire rate).',
    effect: (g, c = 1) => {
      // BUFFED 2.5x: 10% → 25% fire rate
      g.increaseFireRate(pct(25));

      if (window.debugLogBridge) {
        window.debugLogBridge.log(`⚡ Rapid Capacitors: +25% fire rate`, 'success', {
          source: 'upgrade_service',
          operation: 'fire_rate_boost',
          stacks: c,
          fireRateBonus: '+25%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'uncommon', // Promoted from common to uncommon (Advanced tier)
  },
  {
    id: 'dash_efficiency',
    name: 'Phase Boosters',
    description: 'Dash recharges much faster and covers more ground (+50%).',
    effect: (g, c = 1) => {
      // BUFFED 2.5x: 20% → 50% dash efficiency
      g.increaseDashEfficiency(pct(50));

      if (window.debugLogBridge) {
        window.debugLogBridge.log(`💨 Phase Boosters: +50% dash efficiency`, 'success', {
          source: 'upgrade_service',
          operation: 'dash_efficiency',
          stacks: c,
          efficiencyBonus: '+50%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'uncommon', // Promoted from common to uncommon (Advanced tier)
  },
  /* =======================  UNCOMMON  ================================= */
  // NEW BRIDGE UPGRADES - Tier 2 connections to create paths
  {
    id: 'kinetic_amplifier',
    name: 'Kinetic Amplifier',
    description: 'Beam power amplified. +8% beam damage per stack.',
    effect: (g, c = 1) => {
      // BUFFED: Increased from +3% to +8% per stack for noticeable impact
      const damageBonus = 0.08;
      g.increaseBeamDamage(damageBonus);

      if (window.debugLogBridge) {
        window.debugLogBridge.log(`⚡ Kinetic Amplifier: +${(damageBonus * 100).toFixed(0)}% beam damage`, 'success', {
          source: 'upgrade_service',
          operation: 'kinetic_amplifier',
          stacks: c,
          damageBonus: `+${(damageBonus * 100).toFixed(0)}%`,
        });
      }
    },
    type: 'upgrade',
    rarity: 'uncommon',
    prerequisites: ['core_speed'],
    hiddenEffect: 'Speed is power.',
  },
  {
    id: 'emergency_protocols',
    name: 'Emergency Protocols',
    description: 'Critical systems engage when shields fail (+100% healing below 30% HP, +20 instant heal).',
    effect: (g, c = 1, phase) => {
      // Apply emergency healing boost through PlayerService
      const healingMultiplier = 1.0 + 1.0 * c; // Base healing + 100% per stack
      const player = g.getPlayerService();
      if (player) {
        player.setEmergencyProtocols(true, healingMultiplier);
      }

      // Grant immediate heal as a safety net
      const healAmount = 20;
      if (phase !== 'restore') {
        const currentHealth = g.getPlayerHealth();
        const maxHealth = g.getPlayerMaxHealth();
        if (currentHealth < maxHealth) {
          g.heal(Math.min(healAmount, maxHealth - currentHealth), 'emergency_protocols_instant');
        }
      }

      if (window.debugLogBridge) {
        window.debugLogBridge.log(
          `🚨 Emergency Protocols: +${(c * 100).toFixed(0)}% healing below 30% HP, +${healAmount} instant heal`,
          'success',
          {
            source: 'upgrade_service',
            operation: 'emergency_protocols',
            stacks: c,
            healingMultiplier: `${((healingMultiplier - 1) * 100).toFixed(0)}%`,
            instantHeal: healAmount,
          }
        );
      }
    },
    type: 'upgrade',
    rarity: 'uncommon',
    prerequisites: ['health_regen'],
  },
  {
    id: 'beam_damage',
    name: 'Photon Amplifier',
    description: 'Beam cuts deeper through enemies.',
    effect: (g, c = 1) =>
      g.increaseBeamDamage(
        c > 1
          ? pct(UPGRADE_EFFECTS.BEAM_DAMAGE.SUBSEQUENT_UPGRADE_PERCENT)
          : pct(UPGRADE_EFFECTS.BEAM_DAMAGE.FIRST_UPGRADE_PERCENT)
      ),
    type: 'upgrade',
    rarity: 'uncommon',
  },
  {
    id: 'beam_rotation',
    name: 'Gyroscopic Matrix',
    description: 'Beam sweeps faster.',
    effect: (g, c = 1) =>
      g.increaseBeamRotationSpeed(
        c > 1
          ? pct(UPGRADE_EFFECTS.BEAM_ROTATION.SUBSEQUENT_UPGRADE_PERCENT)
          : pct(UPGRADE_EFFECTS.BEAM_ROTATION.FIRST_UPGRADE_PERCENT)
      ),
    type: 'upgrade',
    rarity: 'uncommon',
    prerequisites: ['beam_damage'], // Connect to beam path
  },
  {
    id: 'beam_speed',
    name: 'Tachyon Infusion',
    description: 'Beam instantly reaches targets and sweeps faster.',
    effect: (g, c = 1) => {
      // BUFFED: Now also increases beam rotation speed for better sweeping
      g.increaseBeamSpeed(pct(30)); // Increased from 15% to 30%
      g.increaseBeamRotationSpeed(pct(10)); // Added rotation bonus

      // Log the upgrade
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`⚡ Tachyon Infusion: +30% beam speed, +10% rotation`, 'success', {
          source: 'upgrade_service',
          operation: 'tachyon_infusion_upgrade',
          stacks: c,
          speedBonus: 30,
          rotationBonus: 10,
          note: 'Beam now travels and sweeps faster',
        });
      }
    },
    type: 'upgrade',
    rarity: 'uncommon',
  },

  /* =======================  RARE  ===================================== */
  // NEW PATH EXTENSIONS - Tier 3 upgrades that deepen build paths
  {
    id: 'velocity_matrix',
    name: 'Velocity Matrix',
    description:
      'Kills grant +5% speed (up to 50%, 3s). Speed converts to bonus damage (up to +100%). Also grants +5% speed and +5% damage.',
    effect: (g, c = 1) => {
      // BUFFED: Increased from 5% to 10% for noticeable feedback loop
      // Bidirectional scaling: damage increases speed, speed increases damage
      const speedBonus = 0.1 * c; // 10% speed per kill (buffed from 5%)
      const damageBonus = 0.1 * c; // 10% damage per movement (buffed from 5%)

      // Enable velocity matrix through PlayerService
      const player = g.getPlayerService();
      if (player) {
        player.setVelocityMatrix(true, speedBonus, damageBonus);
      }

      // Also apply immediate flat bonuses for instant impact
      g.increaseMovementSpeed(pct(5)); // 5% base speed boost
      g.increaseBeamDamage(pct(5)); // 5% base damage boost

      // Log the upgrade
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`🌀 Velocity Matrix: Speed ↔ Damage feedback loop activated`, 'success', {
          source: 'upgrade_service',
          operation: 'velocity_matrix',
          stacks: c,
          speedPerKill: `${(speedBonus * 100).toFixed(0)}%`,
          damagePerMovement: `${(damageBonus * 100).toFixed(0)}%`,
          baseBonus: '+5% speed and damage',
          mechanics: 'Kills boost speed, movement boosts damage',
        });
      }
    },
    type: 'upgrade',
    rarity: 'rare',
    prerequisites: ['kinetic_amplifier'],
  },
  {
    id: 'surgical_precision',
    name: 'Surgical Precision',
    description: 'Target enemy weak points for critical damage.',
    effect: (g, c = 1) => {
      // Enable critical hit zones on enemies
      const critChance = 0.15 * c; // 15% base crit chance per stack
      const critMultiplier = 1.5 + 0.25 * c; // 1.5x-2.25x damage

      // Use PlayerService methods for proper integration with damage calculation
      const player = g.getPlayerService();
      if (player) {
        player.setCriticalHitChance(critChance);
        player.setCriticalHitMultiplier(critMultiplier);
      }

      // Log the upgrade
      if (window.debugLogBridge) {
        window.debugLogBridge.log(
          `🎯 Surgical Precision: ${(critChance * 100).toFixed(0)}% crit for ${critMultiplier}x damage`,
          'success',
          {
            source: 'upgrade_service',
            operation: 'surgical_precision',
            stacks: c,
            critChance: `${(critChance * 100).toFixed(0)}%`,
            critDamage: `${critMultiplier}x`,
          }
        );
      }
    },
    type: 'upgrade',
    rarity: 'rare',
    prerequisites: ['beam_rotation'],
  },
  {
    id: 'double_beam',
    name: 'Dual Beam System',
    description: 'Fire two beams simultaneously.',
    effect: (g) => g.unlockDoubleBeam(),
    type: 'upgrade',
    rarity: 'rare',
    prerequisites: ['beam_damage'],
  },
  {
    id: 'burn_chance',
    name: 'Thermal Inducer',
    description: 'Beam can ignite enemies.',
    effect: (g) => g.addBurnChance(pct(UPGRADE_EFFECTS.BURN_CHANCE.INCREASE_PERCENT)),
    type: 'upgrade',
    rarity: 'rare',
    prerequisites: ['beam_damage'],
  },
  {
    id: 'glass_cannon',
    name: 'Unstable Core',
    description: 'Beam damage +30%, max HP -30%.',
    effect: (g) => {
      g.increaseBeamDamage(pct(UPGRADE_EFFECTS.GLASS_CANNON.BEAM_DAMAGE_INCREASE_PERCENT));
      const currentMax = g.player.getMaxHealth();
      g.player.increaseMaxHealth(-Math.floor(currentMax * pct(UPGRADE_EFFECTS.GLASS_CANNON.MAX_HP_REDUCTION_PERCENT)));
      g.clampCurrentHealth();
    },
    type: 'upgrade',
    rarity: 'rare',
    prerequisites: ['beam_damage'],
  },

  /* =======================  EPIC  ===================================== */
  // NEW CAPSTONE UPGRADES - Tier 4 build definers
  {
    id: 'berserker_protocol',
    name: 'Berserker Protocol',
    description: 'Lower health means higher damage (up to +100% at 1 HP).',
    effect: (g, c = 1) => {
      // Enable berserker protocol with dynamic damage scaling
      const maxBonus = 1.0 * c; // 100% max bonus per stack
      const player = g.getPlayerService();
      if (player) {
        player.setBerserkerProtocol(true, maxBonus);
      }

      // Log the upgrade
      if (window.debugLogBridge) {
        const healthPercent = g.getPlayerHealth() / g.getPlayerMaxHealth();
        const currentBonus = (1 - healthPercent) * maxBonus;

        window.debugLogBridge.log(`💀 Berserker Protocol: Damage scales inversely with health`, 'success', {
          source: 'upgrade_service',
          operation: 'berserker_protocol',
          stacks: c,
          maxBonus: `+${(maxBonus * 100).toFixed(0)}% at 1 HP`,
          currentBonus: `+${(currentBonus * 100).toFixed(0)}%`,
          note: 'Damage updates dynamically based on health',
        });
      }
    },
    type: 'upgrade',
    rarity: 'epic',
    prerequisites: ['glass_cannon'],
  },
  {
    id: 'discharge',
    name: 'Nova Discharge',
    description: 'Right-click unleashes a devastating nova.',
    effect: (g) => g.unlockDischarge(),
    type: 'upgrade',
    rarity: 'epic',
  },
  {
    id: 'burn_damage',
    name: 'Plasma Infuser',
    description: 'Burn deals more damage per tick.',
    effect: (g, c = 1) =>
      g.increaseBurnDamage(
        c > 1
          ? pct(UPGRADE_EFFECTS.BURN_DAMAGE.SUBSEQUENT_UPGRADE_PERCENT)
          : pct(UPGRADE_EFFECTS.BURN_DAMAGE.FIRST_UPGRADE_PERCENT)
      ),
    type: 'upgrade',
    rarity: 'epic',
    prerequisites: ['burn_chance'],
  },
  {
    id: 'burn_spread',
    name: 'Wildfire Protocol',
    description: 'Burns spread to nearby enemies.',
    effect: (g, c = 1) => {
      g.enableBurnSpread();
      if (c > 1) {
        g.setBurnSpreadChance(UPGRADE_EFFECTS.BURN_SPREAD.CHANCE_PER_TICK + 0.1 * (c - 1));
      }
    },
    type: 'upgrade',
    rarity: 'epic',
    prerequisites: ['burn_damage'],
  },
  {
    id: 'void_beam',
    name: 'Void Energy Infusion',
    description: 'Beam tears spacetime, causing implosions. Beam damage +10%.',
    effect: (g) => {
      g.unlockVoidBeam();
      g.increaseBeamDamage(pct(UPGRADE_EFFECTS.VOID_BEAM.SYNERGY_BEAM_DAMAGE_PERCENT));
    },
    type: 'upgrade',
    rarity: 'epic',
    prerequisites: ['beam_damage', 'burn_chance'],
  },

  /* =======================  LEGENDARY  ================================ */
  {
    id: 'cataclysm_core',
    name: 'Cataclysm Core',
    description: 'Crystallized hull. +75 HP, beam damage +40%, fire rate +15%.',
    icon: 'ph-atom',
    effect: (g, _c = 1, phase) => {
      increaseMaxHealthForPhase(g, 75, phase);
      g.increaseBeamDamage(pct(40));
      g.increaseFireRate(pct(15));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☢ Cataclysm Core engaged', 'success', {
          source: 'upgrade_service',
          operation: 'cataclysm_core',
          hp: 75,
          damageBonus: '+40%',
          fireRateBonus: '+15%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'legendary',
    prerequisites: ['berserker_protocol'],
  },
  {
    id: 'pyriphlegethon',
    name: 'Pyriphlegethon',
    description: 'River of fire ignites the swarm. Burn damage +75%, spread chance +25%.',
    icon: 'ph-flame',
    effect: (g) => {
      g.increaseBurnDamage(pct(75));
      g.enableBurnSpread();
      g.setBurnSpreadChance(UPGRADE_EFFECTS.BURN_SPREAD.CHANCE_PER_TICK + 0.25);
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔥 Pyriphlegethon unleashed', 'success', {
          source: 'upgrade_service',
          operation: 'pyriphlegethon',
          burnDamageBonus: '+75%',
          spreadChanceFloor: '+25%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'legendary',
    prerequisites: ['burn_spread', 'void_beam'],
  },
  {
    id: 'aegis_prime',
    name: 'Aegis Prime',
    description: 'Reinforced hull, restored stride. +100 HP, heals 50, dash efficiency +25%.',
    icon: 'ph-shield-star',
    effect: (g, _c = 1, phase) => {
      increaseMaxHealthForPhase(g, 100, phase);
      if (phase !== 'restore') {
        g.heal(50, 'aegis_prime');
      }
      g.increaseDashEfficiency(pct(25));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🛡 Aegis Prime online', 'success', {
          source: 'upgrade_service',
          operation: 'aegis_prime',
          hp: 100,
          heal: 50,
          dashEfficiencyBonus: '+25%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'legendary',
    prerequisites: ['emergency_protocols'],
  },
  {
    id: 'mach_reactor',
    name: 'Mach Reactor',
    description: 'The hull becomes a missile. Speed +30%, fire rate +25%, beam damage +20%.',
    icon: 'ph-rocket-launch',
    effect: (g) => {
      g.increaseMovementSpeed(pct(30));
      g.increaseFireRate(pct(25));
      g.increaseBeamDamage(pct(20));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🚀 Mach Reactor ignited', 'success', {
          source: 'upgrade_service',
          operation: 'mach_reactor',
          speedBonus: '+30%',
          fireRateBonus: '+25%',
          damageBonus: '+20%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'legendary',
    prerequisites: ['velocity_matrix'],
  },
  {
    id: 'beam_singularity',
    name: 'Beam Singularity',
    description: 'The beam tears the void itself. Rotation +50%, damage +30%, speed +50%.',
    icon: 'ph-spiral',
    effect: (g) => {
      g.increaseBeamRotationSpeed(pct(50));
      g.increaseBeamDamage(pct(30));
      g.increaseBeamSpeed(pct(50));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🌀 Beam Singularity collapsed', 'success', {
          source: 'upgrade_service',
          operation: 'beam_singularity',
          rotationBonus: '+50%',
          damageBonus: '+30%',
          speedBonus: '+50%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'legendary',
    prerequisites: ['surgical_precision'],
  },
  {
    id: 'starforge_nova',
    name: 'Starforge Nova',
    description: 'Twin discharges, doubled. Discharge unlocked, double beam unlocked, beam damage +25%.',
    icon: 'ph-sun-dim',
    effect: (g) => {
      g.unlockDischarge();
      g.unlockDoubleBeam();
      g.increaseBeamDamage(pct(25));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☀ Starforge Nova online', 'success', {
          source: 'upgrade_service',
          operation: 'starforge_nova',
          unlocks: ['discharge', 'double_beam'],
          damageBonus: '+25%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'legendary',
    prerequisites: ['double_beam', 'discharge'],
  },

  /* =======================  BLESSINGS  ================================ */
  /* Positive risk-reward picks. Surface alongside curses in the upgrade   */
  /* modal - severity tunes the visual weight (low/medium/high), not the   */
  /* draw odds (blessings + curses share the cur-pool at weight 1).        */
  {
    id: 'astral_aegis',
    name: 'Astral Aegis',
    description: 'A momentary stellar veil. +50 HP, heals 30.',
    icon: 'ph-shield-check',
    effect: (g, _c = 1, phase) => {
      increaseMaxHealthForPhase(g, 50, phase);
      if (phase !== 'restore') {
        g.heal(30, 'astral_aegis');
      }
      if (window.debugLogBridge) {
        window.debugLogBridge.log('✦ Astral Aegis bestowed', 'success', {
          source: 'upgrade_service',
          operation: 'astral_aegis',
          hp: 50,
          heal: 30,
        });
      }
    },
    type: 'blessing',
    rarity: 'blessing',
    severity: 'low',
  },
  {
    id: 'quickening',
    name: 'Quickening',
    description: 'Reactors hum hotter. Speed +15%, dash efficiency +10%.',
    icon: 'ph-wind',
    effect: (g) => {
      g.increaseMovementSpeed(pct(15));
      g.increaseDashEfficiency(pct(10));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('✦ Quickening bestowed', 'success', {
          source: 'upgrade_service',
          operation: 'quickening',
          speedBonus: '+15%',
          dashEfficiencyBonus: '+10%',
        });
      }
    },
    type: 'blessing',
    rarity: 'blessing',
    severity: 'low',
  },
  {
    id: 'magnetars_touch',
    name: "Magnetar's Touch",
    description: 'Shards drift toward you from across the field. Magnetism +200.',
    icon: 'ph-magnet',
    effect: (g) => {
      g.enhanceShardMagnetism(200);
      if (window.debugLogBridge) {
        window.debugLogBridge.log('✦ Magnetar grant', 'success', {
          source: 'upgrade_service',
          operation: 'magnetars_touch',
          magnetismRangeBonus: 200,
        });
      }
    },
    type: 'blessing',
    rarity: 'blessing',
    severity: 'medium',
  },
  {
    id: 'verdant_ward',
    name: 'Verdant Ward',
    description: 'Restorative bloom. +25 HP, heals 50.',
    icon: 'ph-plant',
    effect: (g, _c = 1, phase) => {
      increaseMaxHealthForPhase(g, 25, phase);
      if (phase !== 'restore') {
        g.heal(50, 'verdant_ward');
      }
      if (window.debugLogBridge) {
        window.debugLogBridge.log('✦ Verdant Ward bestowed', 'success', {
          source: 'upgrade_service',
          operation: 'verdant_ward',
          hp: 25,
          heal: 50,
        });
      }
    },
    type: 'blessing',
    rarity: 'blessing',
    severity: 'medium',
  },
  {
    id: 'solar_flare',
    name: 'Solar Flare',
    description: 'A bright burst of stellar fury. Beam damage +15%, fire rate +10%.',
    icon: 'ph-sun',
    effect: (g) => {
      g.increaseBeamDamage(pct(15));
      g.increaseFireRate(pct(10));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('✦ Solar Flare bestowed', 'success', {
          source: 'upgrade_service',
          operation: 'solar_flare',
          damageBonus: '+15%',
          fireRateBonus: '+10%',
        });
      }
    },
    type: 'blessing',
    rarity: 'blessing',
    severity: 'high',
  },

  /* =======================  CURSES  =================================== */
  /* Risk-reward picks with mandatory negative cost. Single-pick (see       */
  /* MAX_STACKS) so stacking them can't compound HP loss into instant       */
  /* death. Severity tunes visual weight and signals the magnitude of the   */
  /* trade - high severity = bigger reward AND bigger cost.                 */
  {
    id: 'vulnerability',
    name: 'Shield Fracture',
    description: 'Take +50% damage, firing rate +30%.',
    effect: (g) => {
      g.applyVulnerabilityCurse();
      g.increaseFireRate(pct(UPGRADE_EFFECTS.VULNERABILITY_CURSE.FIRE_RATE_INCREASE_PERCENT));
    },
    type: 'curse',
    rarity: 'curse',
    severity: 'high',
  },
  {
    id: 'aether_drain',
    name: 'Aether Drain',
    description: 'Hull seeps energy. -15 HP, beam damage +15%.',
    icon: 'ph-drop',
    effect: (g) => {
      g.player.increaseMaxHealth(-15);
      g.clampCurrentHealth();
      g.increaseBeamDamage(pct(15));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☠ Aether Drain inflicted', 'warning', {
          source: 'upgrade_service',
          operation: 'aether_drain',
          hpCost: -15,
          damageGain: '+15%',
        });
      }
    },
    type: 'curse',
    rarity: 'curse',
    severity: 'low',
  },
  {
    id: 'hollow_hull',
    name: 'Hollow Hull',
    description: 'Plating thins for thrust. -25 HP, fire rate +20%.',
    icon: 'ph-circle-dashed',
    effect: (g) => {
      g.player.increaseMaxHealth(-25);
      g.clampCurrentHealth();
      g.increaseFireRate(pct(20));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☠ Hollow Hull inflicted', 'warning', {
          source: 'upgrade_service',
          operation: 'hollow_hull',
          hpCost: -25,
          fireRateGain: '+20%',
        });
      }
    },
    type: 'curse',
    rarity: 'curse',
    severity: 'medium',
  },
  {
    id: 'burning_marrow',
    name: 'Burning Marrow',
    description: 'Pyrosis from within. -20 HP, burn damage +30%.',
    icon: 'ph-fire',
    effect: (g) => {
      g.player.increaseMaxHealth(-20);
      g.clampCurrentHealth();
      g.increaseBurnDamage(pct(30));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☠ Burning Marrow inflicted', 'warning', {
          source: 'upgrade_service',
          operation: 'burning_marrow',
          hpCost: -20,
          burnDamageGain: '+30%',
        });
      }
    },
    type: 'curse',
    rarity: 'curse',
    severity: 'medium',
  },
  {
    id: 'glass_veil',
    name: 'Glass Veil',
    description: 'Spectral fragility. -50 HP, beam damage +40%.',
    icon: 'ph-crack',
    effect: (g) => {
      g.player.increaseMaxHealth(-50);
      g.clampCurrentHealth();
      g.increaseBeamDamage(pct(40));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☠ Glass Veil inflicted', 'warning', {
          source: 'upgrade_service',
          operation: 'glass_veil',
          hpCost: -50,
          damageGain: '+40%',
        });
      }
    },
    type: 'curse',
    rarity: 'curse',
    severity: 'high',
  },
  // Variety curses (Phase 4 QA close-out). The four above all trade HP for
  // offense; these two break the single-axis pattern with a speed-cost and
  // an unlock-upside, respectively.
  {
    id: 'sluggish_reactor',
    name: 'Sluggish Reactor',
    description: 'Heavy-cycle weapon spool. Speed -25%, beam damage +35%.',
    icon: 'ph-gauge',
    effect: (g) => {
      g.increaseMovementSpeed(pct(-25));
      g.increaseBeamDamage(pct(35));
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☠ Sluggish Reactor inflicted', 'warning', {
          source: 'upgrade_service',
          operation: 'sluggish_reactor',
          speedCost: '-25%',
          damageGain: '+35%',
        });
      }
    },
    type: 'curse',
    rarity: 'curse',
    severity: 'medium',
  },
  {
    id: 'phantom_echo',
    name: 'Phantom Echo',
    description: 'Soul split into a twin beam. -30 HP, Double Beam unlocked.',
    icon: 'ph-line-segments',
    effect: (g) => {
      g.player.increaseMaxHealth(-30);
      g.clampCurrentHealth();
      g.unlockDoubleBeam();
      if (window.debugLogBridge) {
        window.debugLogBridge.log('☠ Phantom Echo inflicted', 'warning', {
          source: 'upgrade_service',
          operation: 'phantom_echo',
          hpCost: -30,
          unlock: 'double_beam',
        });
      }
    },
    type: 'curse',
    rarity: 'curse',
    severity: 'high',
  },

  /* =======================  ADDITIONAL RARE  =========================== */
  {
    id: 'shield_breaker',
    name: 'Shield Breaker Protocol',
    description: 'Halves Sentinel shield block (80%→40%); beam +15%.',
    effect: (g, c = 1) => {
      // BUFFED: Increased beam bonus from 10% to 15%
      g.unlockShieldBreaker();
      g.increaseBeamDamage(pct(15)); // Buffed from 10% to 15%

      // Log the upgrade
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`🔨 Shield Breaker: Sentinel block 80%→40%, +15% beam`, 'success', {
          source: 'upgrade_service',
          operation: 'shield_breaker',
          stacks: c,
          sentinelShieldReduction: '80%→40%',
          beamBonus: '+15%',
        });
      }
    },
    type: 'upgrade',
    rarity: 'rare',
  },
];
