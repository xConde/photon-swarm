import type { UpgradeOption } from '../core/models/upgrade.model';

export const RUN_RELIC_OPTIONS: readonly UpgradeOption[] = [
  {
    id: 'relic_mobius_lens',
    name: 'Möbius Lens',
    designation: 'OPTIC / IMPOSSIBLE',
    description: 'The emitter exits on both sides of the hull at once.',
    signature: 'Unlock Double Beam immediately',
    tradeoff: 'Eighteen percent less beam damage',
    effect: (game) => {
      game.unlockDoubleBeam();
      game.increaseBeamDamage(-0.18);
    },
    type: 'upgrade',
    rarity: 'legendary',
    category: 'relic',
    buildTags: ['beam', 'void'],
  },
  {
    id: 'relic_ashheart',
    name: 'Ashheart',
    designation: 'REACTOR / CINDER',
    description: 'A warm dead star beats faster when the beam sets something alight.',
    signature: '+25% burn chance and +40% burn damage',
    tradeoff: 'Twenty max HP sacrificed',
    effect: (game, _count, phase) => {
      game.player.increaseMaxHealth(-20);
      if (phase !== 'restore') game.clampCurrentHealth();
      game.addBurnChance(0.25);
      game.increaseBurnDamage(0.4);
    },
    type: 'upgrade',
    rarity: 'legendary',
    category: 'relic',
    buildTags: ['thermal'],
  },
  {
    id: 'relic_pilgrim_gyro',
    name: 'Pilgrim Gyro',
    designation: 'NAV / UNMOOR',
    description: 'It remembers a destination the ship has never visited.',
    signature: '+45% beam tracking and +18% movement',
    tradeoff: 'No defensive yield',
    effect: (game) => {
      game.increaseBeamRotationSpeed(0.45);
      game.increaseMovementSpeed(0.18);
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'relic',
    buildTags: ['beam', 'mobility'],
  },
  {
    id: 'relic_shard_crown',
    name: 'Shard Crown',
    designation: 'REGALIA / HUNGER',
    description: 'Every fragment arrives heavier than when it left the enemy.',
    signature: 'Collected shards are worth fifty percent more',
    tradeoff: 'Fifteen max HP sacrificed',
    effect: (game, _count, phase) => {
      const player = game.getPlayerService();
      player.setShardMultiplier(player.getShardMultiplier() * 1.5);
      game.player.increaseMaxHealth(-15);
      if (phase !== 'restore') game.clampCurrentHealth();
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'relic',
    buildTags: ['shard', 'void'],
  },
  {
    id: 'relic_null_mantle',
    name: 'Null Mantle',
    designation: 'HULL / ABSENCE',
    description: 'Blackglass around the emitter lets the beam occupy forbidden space.',
    signature: 'Unlock Void Beam and widen the beam by 35%',
    tradeoff: 'Ten percent less movement speed',
    effect: (game) => {
      game.unlockVoidBeam();
      game.getPlayerService().increaseBeamWidth(0.35);
      game.increaseMovementSpeed(-0.1);
    },
    type: 'upgrade',
    rarity: 'legendary',
    category: 'relic',
    buildTags: ['beam', 'void'],
  },
  {
    id: 'relic_storm_bottle',
    name: 'Storm Bottle',
    designation: 'CAPACITOR / WEATHER',
    description: 'A captured electrical front strains against its cracked container.',
    signature: 'Unlock Discharge and increase its radius by 50%',
    tradeoff: 'Fifteen max HP sacrificed',
    effect: (game, _count, phase) => {
      game.unlockDischarge();
      game.getPlayerService().increaseDischargeRadius(0.5);
      game.player.increaseMaxHealth(-15);
      if (phase !== 'restore') game.clampCurrentHealth();
    },
    type: 'upgrade',
    rarity: 'legendary',
    category: 'relic',
    buildTags: ['discharge'],
  },
  {
    id: 'relic_reactive_carapace',
    name: 'Reactive Carapace',
    designation: 'PLATE / RETALIATE',
    description: 'The hull stores each impact and answers through the beam.',
    signature: '+45 max HP and heavy recoil damage',
    tradeoff: 'No offensive gain until struck',
    effect: (game, _count, phase) => {
      if (phase === 'restore') game.player.increaseMaxHealth(45);
      else game.increaseMaxHealth(45);
      game.addRecoilDamage(0.8);
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'relic',
    buildTags: ['aegis'],
  },
  {
    id: 'relic_glass_garden',
    name: 'Glass Garden',
    designation: 'NANITE / BLOOM',
    description: 'Repair crystals grow across the hull whenever combat quiets.',
    signature: '+6 HP per second regeneration',
    tradeoff: 'Twelve percent less beam damage',
    effect: (game) => {
      game.player.setHealthRegeneration(game.player.getHealthRegenRate() + 6);
      game.increaseBeamDamage(-0.12);
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'relic',
    buildTags: ['aegis'],
  },
  {
    id: 'relic_choir_engine',
    name: 'Choir Engine',
    designation: 'DRIVE / CHORUS',
    description: 'A ring of tiny engines fires in rhythm with every weapon cycle.',
    signature: '+35% projectile fire rate and +20% beam speed',
    tradeoff: 'Fifteen percent less beam damage',
    effect: (game) => {
      game.increaseFireRate(0.35);
      game.increaseBeamSpeed(0.2);
      game.increaseBeamDamage(-0.15);
    },
    type: 'upgrade',
    rarity: 'epic',
    category: 'relic',
    buildTags: ['kinetic', 'mobility'],
  },
] as const;
