import type { UpgradeOption } from '../core/models/upgrade.model';

export const RUN_ROUTE_OPTIONS: readonly UpgradeOption[] = [
  {
    id: 'route_azure_bastion',
    name: 'Azure Bastion',
    designation: 'ROUTE 02 / PROTECTORATE',
    description: 'Chart the Asteroid Belt and accept Azure escort protocols for the run.',
    signature: 'Defensive formations, tougher guardians, +30 max HP',
    tradeoff: 'Eight percent less movement speed',
    effect: (game, _count, phase) => {
      game.chooseRunRoute(2, 2, phase !== 'restore');
      if (phase === 'restore') game.player.increaseMaxHealth(30);
      else game.increaseMaxHealth(30);
      game.increaseMovementSpeed(-0.08);
    },
    type: 'upgrade',
    rarity: 'rare',
    category: 'route',
    exclusiveGroup: 'run-route',
    buildTags: ['aegis', 'kinetic'],
  },
  {
    id: 'route_verdant_rift',
    name: 'Verdant Rift Dive',
    designation: 'ROUTE 03 / SWARM',
    description: 'Descend through the Void Rift under Verdant passage and hunt at close pressure.',
    signature: 'Faster, stranger encounters, +25% beam damage',
    tradeoff: 'Fifteen max HP sacrificed',
    effect: (game, _count, phase) => {
      game.chooseRunRoute(3, 3, phase !== 'restore');
      game.player.increaseMaxHealth(-15);
      if (phase !== 'restore') game.clampCurrentHealth();
      game.increaseBeamDamage(0.25);
    },
    type: 'upgrade',
    rarity: 'rare',
    category: 'route',
    exclusiveGroup: 'run-route',
    buildTags: ['void', 'mobility'],
  },
] as const;
