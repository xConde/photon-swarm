import { ENEMY_DEFINITIONS } from './enemy-definitions';
import { EnemyType } from '../../core/models/enemy.model';
import { ENEMY_STATS } from '@photon/config/constants/enemy/enemy-stats.config';

describe('ENEMY_DEFINITIONS', () => {
  it('exposes a guide entry for every shipped EnemyType — no silent gaps for the player to discover blind', () => {
    const definedTypes = new Set(ENEMY_DEFINITIONS.map((d) => d.type));
    const shippedTypes: EnemyType[] = [
      EnemyType.Basic,
      EnemyType.Spitter,
      EnemyType.Tank,
      EnemyType.Swarm,
      EnemyType.Thug,
      EnemyType.Sniper,
      EnemyType.Disruptor,
      EnemyType.Sentinel,
      EnemyType.Boss,
    ];

    shippedTypes.forEach((t) => {
      expect(definedTypes.has(t)).withContext(`missing guide entry for ${t}`).toBeTrue();
    });
  });

  it('orders entries by minLevel so the guide reads as a progression', () => {
    for (let i = 1; i < ENEMY_DEFINITIONS.length; i++) {
      expect(ENEMY_DEFINITIONS[i].minLevel)
        .withContext(`${ENEMY_DEFINITIONS[i].type} at index ${i}`)
        .toBeGreaterThanOrEqual(ENEMY_DEFINITIONS[i - 1].minLevel);
    }
  });

  it('every entry carries a non-empty identity, tell, and counter', () => {
    ENEMY_DEFINITIONS.forEach((d) => {
      expect(d.name).withContext(d.type).toBeTruthy();
      expect(d.description.length).withContext(d.type).toBeGreaterThan(20);
      expect(d.role.length).withContext(d.type).toBeGreaterThan(3);
      expect(d.tell.length).withContext(d.type).toBeGreaterThan(15);
      expect(d.counter.length).withContext(d.type).toBeGreaterThan(15);
    });
  });

  it('every entry has a positive minLevel, health, and xpValue', () => {
    ENEMY_DEFINITIONS.forEach((d) => {
      expect(d.minLevel).withContext(d.type).toBeGreaterThan(0);
      expect(d.health).withContext(d.type).toBeGreaterThan(0);
      expect(d.xpValue).withContext(d.type).toBeGreaterThan(0);
    });
  });

  it('contains no duplicate enemy types', () => {
    const types = ENEMY_DEFINITIONS.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
  });

  describe('stats stay in sync with ENEMY_STATS', () => {
    // Pin ALL nine guide entries to the canonical ENEMY_STATS config so a tuning
    // pass in enemy-stats.config breaks this spec instead of silently lying to the
    // player. Every HP value in the guide is now sourced directly from ENEMY_STATS.
    const pinned: Array<{ type: EnemyType; configKey: keyof typeof ENEMY_STATS }> = [
      { type: EnemyType.Basic, configKey: 'basic' },
      { type: EnemyType.Spitter, configKey: 'spitter' },
      { type: EnemyType.Tank, configKey: 'tank' },
      { type: EnemyType.Swarm, configKey: 'swarm' },
      { type: EnemyType.Thug, configKey: 'thug' },
      { type: EnemyType.Sniper, configKey: 'sniper' },
      { type: EnemyType.Disruptor, configKey: 'disruptor' },
      { type: EnemyType.Sentinel, configKey: 'sentinel' },
      { type: EnemyType.Boss, configKey: 'boss' },
    ];

    pinned.forEach(({ type, configKey }) => {
      it(`pin enemy guide HP against ENEMY_STATS to catch drift: ${type} matches ENEMY_STATS.${configKey}.HEALTH`, () => {
        const entry = ENEMY_DEFINITIONS.find((d) => d.type === type)!;
        expect(entry.health).toBe(ENEMY_STATS[configKey].HEALTH);
      });
    });
  });

  it('Swarm speed label is Fast (120 px/s is the fastest base speed)', () => {
    const swarm = ENEMY_DEFINITIONS.find((d) => d.type === EnemyType.Swarm)!;
    expect(swarm.speed).toBe('Fast');
  });

  it('no em-dashes in any player-facing guide strings', () => {
    ENEMY_DEFINITIONS.forEach((d) => {
      expect(d.description).withContext(d.type).not.toContain('—');
      expect(d.name).withContext(d.type).not.toContain('—');
      expect(d.tell).withContext(d.type).not.toContain('—');
      expect(d.counter).withContext(d.type).not.toContain('—');
    });
  });
});
