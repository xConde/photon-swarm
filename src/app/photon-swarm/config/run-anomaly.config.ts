import type { UpgradeOption } from '../core/models/upgrade.model';

/**
 * Irreversible sector contracts. Each option changes both sides of the combat
 * equation so the player chooses the ecology of the remainder of the run.
 */
export const RUN_ANOMALY_OPTIONS: readonly UpgradeOption[] = [
  {
    id: 'anomaly_predators_moon',
    name: "Predator's Moon",
    designation: 'ORBIT / PURSUIT',
    description: 'A hunting satellite accelerates every signal in the sector.',
    signature: '+30% XP and +18% movement speed',
    tradeoff: 'Enemies arrive 25% faster and move 10% faster',
    effect: (game) => {
      game.increaseExperienceGain('anomaly_predators_moon', 1.3);
      game.increaseMovementSpeed(0.18);
      game.applyRunPressure({ spawnTempo: 1.25, enemySpeed: 1.1 }, 'anomaly_predators_moon');
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'anomaly',
    buildTags: ['mobility'],
  },
  {
    id: 'anomaly_glass_orbit',
    name: 'Glass Orbit',
    designation: 'FIELD / VOLATILE',
    description: 'Every weapon crosses the same brittle amplification plane.',
    signature: '+40% beam damage',
    tradeoff: 'Enemy attacks deal 35% more damage',
    effect: (game) => {
      game.increaseBeamDamage(0.4);
      game.applyRunPressure({ enemyDamage: 1.35 }, 'anomaly_glass_orbit');
    },
    type: 'upgrade',
    rarity: 'legendary',
    category: 'anomaly',
    buildTags: ['beam', 'kinetic'],
  },
  {
    id: 'anomaly_iron_choir',
    name: 'Iron Choir',
    designation: 'SIGNAL / FORTIFY',
    description: 'A low hymn teaches every hull in range how to endure.',
    signature: '+50 max HP and +4 HP per second',
    tradeoff: 'Enemies gain 35% health and appear as elites 40% more often',
    effect: (game, _count, phase) => {
      if (phase === 'restore') game.player.increaseMaxHealth(50);
      else game.increaseMaxHealth(50);
      game.player.setHealthRegeneration(game.player.getHealthRegenRate() + 4);
      game.applyRunPressure({ enemyHealth: 1.35, eliteFrequency: 1.4 }, 'anomaly_iron_choir');
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'anomaly',
    buildTags: ['aegis'],
  },
  {
    id: 'anomaly_carrion_bloom',
    name: 'Carrion Bloom',
    designation: 'HARVEST / OVERGROW',
    description: 'Salvage organisms multiply around the wake of crowded battles.',
    signature: 'Collected shards are worth 75% more',
    tradeoff: 'Formations contain 30% more enemies and deploy 12% faster',
    effect: (game) => {
      const player = game.getPlayerService();
      player.setShardMultiplier(player.getShardMultiplier() * 1.75);
      game.applyRunPressure({ waveSize: 1.3, spawnTempo: 1.12 }, 'anomaly_carrion_bloom');
    },
    type: 'upgrade',
    rarity: 'legendary',
    category: 'anomaly',
    buildTags: ['shard', 'thermal'],
  },
  {
    id: 'anomaly_duelists_dark',
    name: "Duelist's Dark",
    designation: 'VOID / SINGLE COMBAT',
    description: 'The field devours lesser signatures and feeds what remains.',
    signature: '+35% beam damage and +20% beam tracking',
    tradeoff: 'Fewer enemies, but each gains 65% health and 25% damage',
    effect: (game) => {
      game.increaseBeamDamage(0.35);
      game.increaseBeamRotationSpeed(0.2);
      game.applyRunPressure({ waveSize: 0.72, enemyHealth: 1.65, enemyDamage: 1.25 }, 'anomaly_duelists_dark');
    },
    type: 'upgrade',
    rarity: 'legendary',
    category: 'anomaly',
    buildTags: ['beam', 'void'],
  },
  {
    id: 'anomaly_fever_wake',
    name: 'Fever Wake',
    designation: 'REACTOR / REDLINE',
    description: 'Heat trails behind every moving body and refuses to dissipate.',
    signature: '+25% fire rate and +22% movement speed',
    tradeoff: 'Enemies move 30% faster and deal 15% more damage',
    effect: (game) => {
      game.increaseFireRate(0.25);
      game.increaseMovementSpeed(0.22);
      game.applyRunPressure({ enemySpeed: 1.3, enemyDamage: 1.15 }, 'anomaly_fever_wake');
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'anomaly',
    buildTags: ['mobility', 'discharge'],
  },
];
