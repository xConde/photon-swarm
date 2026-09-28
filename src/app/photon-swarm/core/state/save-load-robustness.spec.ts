/**
 * Save/Load Robustness Tests
 *
 * Covers edge cases NOT in save-game.adapter.spec.ts:
 *   - Full round-trip fidelity
 *   - Missing/partial fields → graceful defaults (null)
 *   - Corrupted JSON → graceful null
 *   - Wrong data types → graceful null
 *   - Extra unknown fields → silently ignored
 *   - Storage throwing → graceful null
 *   - Empty storage → null (no crashes)
 *   - Version mismatch → null
 *   - Checkpoint round-trip fidelity
 *   - Checkpoint validation edge cases
 *   - Player name round-trip and edge cases
 *   - hasSave / hasCheckpoint delegation
 *   - getSaveTimestamp accuracy
 */

import { TestBed } from '@angular/core/testing';
import { SaveGameAdapter } from './save-game.adapter';
import { StorageService } from '../../services/storage.service';
import { EnemySnapshot, PlayerSnapshot, RunCheckpoint, SaveGameData } from '../models/save-game.model';
import { EnemyType } from '../models/enemy.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal valid SaveGameData that passes isValidSaveData(). */
function minimalSave(overrides: Partial<SaveGameData> = {}): SaveGameData {
  return {
    version: 1,
    seed: 'seed-abc',
    timestamp: 1_700_000_000_000,
    player: {
      name: 'Hero',
      x: 400,
      y: 300,
      health: 80,
      maxHealth: 100,
      shards: 5,
      xp: 120,
      level: 3,
    },
    enemies: [],
    ...overrides,
  };
}

/** Builds a minimal valid RunCheckpoint. */
function minimalCheckpoint(overrides: Partial<RunCheckpoint> = {}): RunCheckpoint {
  return {
    version: 1,
    timestamp: 1_700_000_000_000,
    health: 75,
    maxHealth: 100,
    level: 4,
    xp: 250,
    shards: 12,
    kills: 30,
    upgrades: { speed: 2, damage: 1 },
    timePlayed: 180,
    playerName: 'Hero',
    ...overrides,
  };
}

/** Builds a full EnemySnapshot. */
function makeEnemy(id: string): EnemySnapshot {
  return {
    id,
    type: EnemyType.Basic,
    x: 100,
    y: 200,
    health: 40,
    maxHealth: 50,
    vx: 1.5,
    vy: -0.5,
    behaviorPattern: 'chase',
  };
}

// ---------------------------------------------------------------------------
// Spy factory — simulates StorageService backed by an in-memory map.
// ---------------------------------------------------------------------------

function makeStorageSpy(): jasmine.SpyObj<StorageService> {
  const store = new Map<string, unknown>();

  const spy = jasmine.createSpyObj<StorageService>('StorageService', ['get', 'set', 'remove']);

  spy.set.and.callFake(<T>(key: string, value: T): boolean => {
    store.set(key, value);
    return true;
  });

  spy.get.and.callFake(<T>(key: string): T | null => {
    return store.has(key) ? (store.get(key) as T) : null;
  });

  spy.remove.and.callFake((key: string): void => {
    store.delete(key);
  });

  // Expose the store so individual tests can inspect or seed it.
  (spy as unknown as { _store: Map<string, unknown> })._store = store;

  return spy;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SaveGameAdapter – robustness', () => {
  let adapter: SaveGameAdapter;
  let storageSpy: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    storageSpy = makeStorageSpy();

    TestBed.configureTestingModule({
      providers: [SaveGameAdapter, { provide: StorageService, useValue: storageSpy }],
    });

    adapter = TestBed.inject(SaveGameAdapter);

    // Silence debugLogBridge calls so tests don't throw on missing window property.
    (window as unknown as Record<string, unknown>)['debugLogBridge'] = undefined;
  });

  // =========================================================================
  // 1. Full round-trip — all fields preserved
  // =========================================================================

  describe('round-trip fidelity', () => {
    it('restores all required player fields after save → load', () => {
      const original = minimalSave();
      adapter.save(original);
      const loaded = adapter.load();

      expect(loaded).not.toBeNull();
      const player = loaded!.player;
      expect(player.name).toBe('Hero');
      expect(player.x).toBe(400);
      expect(player.y).toBe(300);
      expect(player.health).toBe(80);
      expect(player.maxHealth).toBe(100);
      expect(player.shards).toBe(5);
      expect(player.xp).toBe(120);
      expect(player.level).toBe(3);
    });

    it('restores enemy array with all fields intact', () => {
      const enemy1 = makeEnemy('e-1');
      const enemy2 = makeEnemy('e-2');
      const original = minimalSave({ enemies: [enemy1, enemy2] });

      adapter.save(original);
      const loaded = adapter.load();

      expect(loaded!.enemies.length).toBe(2);
      expect(loaded!.enemies[0]).toEqual(jasmine.objectContaining({ id: 'e-1', type: EnemyType.Basic, vx: 1.5 }));
      expect(loaded!.enemies[1]).toEqual(jasmine.objectContaining({ id: 'e-2', behaviorPattern: 'chase' }));
    });

    it('preserves optional player fields (ascensionLevel, currentClass, upgrades)', () => {
      const original = minimalSave({
        player: {
          name: 'Hero',
          x: 0,
          y: 0,
          health: 100,
          maxHealth: 100,
          shards: 0,
          xp: 0,
          level: 1,
          ascensionLevel: 2,
          currentClass: 'Sentinel',
          unlockedTraits: ['rapid-fire', 'shield-burst'],
          persistentUpgrades: { skin_gold: 1 },
          currentRunUpgrades: { damage: 3 },
        },
      });

      adapter.save(original);
      const loaded = adapter.load();

      expect(loaded!.player.ascensionLevel).toBe(2);
      expect(loaded!.player.currentClass).toBe('Sentinel');
      expect(loaded!.player.unlockedTraits).toEqual(['rapid-fire', 'shield-burst']);
      expect(loaded!.player.persistentUpgrades).toEqual({ skin_gold: 1 });
      expect(loaded!.player.currentRunUpgrades).toEqual({ damage: 3 });
    });

    it('preserves optional worldHash and meta fields', () => {
      const original = minimalSave({
        worldHash: 'abc123hash',
        meta: {
          survivalTime: 300,
          survivalPhase: 'mid',
          currentStage: 2,
          stageProgress: 0.6,
          unlockedStages: [1, 2],
          kills: 55,
          maxKillStreak: 8,
          resinCurrency: 15,
          gameStartTime: 1_700_000_000_000,
        },
      });

      adapter.save(original);
      const loaded = adapter.load();

      expect(loaded!.worldHash).toBe('abc123hash');
      expect(loaded!.meta!.survivalPhase).toBe('mid');
      expect(loaded!.meta!.kills).toBe(55);
    });

    it('overwrites timestamp with current time on save', () => {
      const before = Date.now();
      adapter.save(minimalSave({ timestamp: 0 }));
      const after = Date.now();

      const loaded = adapter.load();
      expect(loaded!.timestamp).toBeGreaterThanOrEqual(before);
      expect(loaded!.timestamp).toBeLessThanOrEqual(after);
    });

    it('always persists version = 1', () => {
      adapter.save(minimalSave());
      const loaded = adapter.load();
      expect(loaded!.version).toBe(1);
    });
  });

  // =========================================================================
  // 2. Missing / partial fields → returns null
  // =========================================================================

  describe('missing required fields', () => {
    it('returns null when player is absent', () => {
      const bad = { version: 1, seed: 'x', timestamp: Date.now(), enemies: [] } as unknown as SaveGameData;
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when seed is absent', () => {
      const bad = {
        version: 1,
        timestamp: Date.now(),
        player: { name: 'x', x: 0, y: 0, health: 1, maxHealth: 1, shards: 0, xp: 0, level: 1 },
        enemies: [],
      } as unknown as SaveGameData;
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when timestamp is absent', () => {
      const bad = {
        version: 1,
        seed: 'x',
        player: { name: 'x', x: 0, y: 0, health: 1, maxHealth: 1, shards: 0, xp: 0, level: 1 },
        enemies: [],
      } as unknown as SaveGameData;
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when enemies array is absent', () => {
      const bad = {
        version: 1,
        seed: 'x',
        timestamp: Date.now(),
        player: { name: 'x', x: 0, y: 0, health: 1, maxHealth: 1, shards: 0, xp: 0, level: 1 },
      } as unknown as SaveGameData;
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when player.name is missing', () => {
      const bad = minimalSave({
        player: { x: 0, y: 0, health: 1, maxHealth: 1, shards: 0, xp: 0, level: 1 } as unknown as PlayerSnapshot,
      });
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('clears storage when loaded data is invalid', () => {
      const bad = { version: 1, seed: 'x', timestamp: Date.now(), enemies: [] } as unknown as SaveGameData;
      storageSpy.get.and.returnValue(bad);
      adapter.load();
      expect(storageSpy.remove).toHaveBeenCalledWith('save-v2');
    });
  });

  // =========================================================================
  // 3. Corrupted / non-object data
  // =========================================================================

  describe('corrupted data', () => {
    it('returns null when storage returns a plain string', () => {
      storageSpy.get.and.returnValue('not-an-object');
      expect(adapter.load()).toBeNull();
    });

    it('returns null when storage returns a number', () => {
      storageSpy.get.and.returnValue(42);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when storage returns null explicitly', () => {
      storageSpy.get.and.returnValue(null);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when storage returns an empty object', () => {
      storageSpy.get.and.returnValue({});
      expect(adapter.load()).toBeNull();
    });

    it('returns null when storage.get throws', () => {
      storageSpy.get.and.throwError('QuotaExceededError');
      expect(adapter.load()).toBeNull();
    });

    it('does not throw when storage.set throws', () => {
      storageSpy.set.and.throwError('QuotaExceededError');
      expect(() => adapter.save(minimalSave())).not.toThrow();
    });

    it('does not throw when storage.remove throws', () => {
      storageSpy.remove.and.throwError('SecurityError');
      expect(() => adapter.clear()).not.toThrow();
    });

    it('rejects enemy types outside the runtime enum before reconstruction', () => {
      const corruptedEnemy = { ...makeEnemy('bad-type'), type: 'unknown-enemy' as EnemyType };
      storageSpy.get.and.returnValue(minimalSave({ enemies: [corruptedEnemy] }));

      expect(adapter.load()).toBeNull();
      expect(storageSpy.remove).toHaveBeenCalledWith('save-v2');
    });

    it('rejects malformed optional meta and faction snapshots', () => {
      storageSpy.get.and.returnValue(
        minimalSave({
          meta: {
            survivalTime: 300,
            survivalPhase: 'mid',
            currentStage: 2,
            stageProgress: 0.5,
            unlockedStages: [1, 2],
            kills: 10,
            maxKillStreak: 3,
            resinCurrency: 0,
            gameStartTime: 100,
            factionStandings: [{ factionId: 1, standing: Number.NaN }],
          },
        })
      );

      expect(adapter.load()).toBeNull();
    });
  });

  // =========================================================================
  // 4. Wrong data types on required numeric / string fields
  // =========================================================================

  describe('wrong data types on required fields', () => {
    it('returns null when player.health is a string', () => {
      const bad = minimalSave({
        player: {
          name: 'Hero',
          x: 0,
          y: 0,
          health: '80' as unknown as number,
          maxHealth: 100,
          shards: 0,
          xp: 0,
          level: 1,
        },
      });
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when player.x is null', () => {
      const bad = minimalSave({
        player: {
          name: 'Hero',
          x: null as unknown as number,
          y: 0,
          health: 100,
          maxHealth: 100,
          shards: 0,
          xp: 0,
          level: 1,
        },
      });
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when player.level is boolean', () => {
      const bad = minimalSave({
        player: {
          name: 'Hero',
          x: 0,
          y: 0,
          health: 100,
          maxHealth: 100,
          shards: 0,
          xp: 0,
          level: true as unknown as number,
        },
      });
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when timestamp is a string', () => {
      const bad = { ...minimalSave(), timestamp: '2024-01-01' as unknown as number };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when enemies contains a non-object entry', () => {
      const bad = { ...minimalSave(), enemies: ['not-an-enemy'] as unknown as EnemySnapshot[] };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when an enemy is missing its id', () => {
      const bad = minimalSave({
        enemies: [{ type: 'basic', x: 0, y: 0, health: 10, maxHealth: 10 } as unknown as EnemySnapshot],
      });
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when an enemy health is a string', () => {
      const bad = minimalSave({
        enemies: [{ id: 'e1', type: EnemyType.Basic, x: 0, y: 0, health: 'full' as unknown as number, maxHealth: 10 }],
      });
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });
  });

  // =========================================================================
  // 5. Extra unknown fields → silently ignored
  // =========================================================================

  describe('extra unknown fields', () => {
    it('loads successfully when save has extra top-level fields', () => {
      const withExtra = { ...minimalSave(), unknownFutureField: 'ignored', anotherExtra: { nested: true } };
      storageSpy.get.and.returnValue(withExtra);
      const loaded = adapter.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.player.name).toBe('Hero');
    });

    it('loads successfully when player has extra fields', () => {
      const original = minimalSave({
        player: {
          name: 'Hero',
          x: 0,
          y: 0,
          health: 100,
          maxHealth: 100,
          shards: 0,
          xp: 0,
          level: 1,
          unknownPlayerField: 'xyz',
        } as unknown as PlayerSnapshot,
      });
      storageSpy.get.and.returnValue(original);
      expect(adapter.load()).not.toBeNull();
    });

    it('loads successfully when an enemy has extra fields', () => {
      const enemyWithExtra = { ...makeEnemy('e-99'), futureEnemyData: 42 };
      const original = minimalSave({ enemies: [enemyWithExtra] });
      storageSpy.get.and.returnValue(original);
      expect(adapter.load()).not.toBeNull();
    });
  });

  // =========================================================================
  // 6. Empty storage
  // =========================================================================

  describe('empty storage', () => {
    it('load() returns null when storage is empty', () => {
      storageSpy.get.and.returnValue(null);
      expect(adapter.load()).toBeNull();
    });

    it('hasSave() returns false when storage is empty', () => {
      storageSpy.get.and.returnValue(null);
      expect(adapter.hasSave()).toBeFalse();
    });

    it('getSaveTimestamp() returns null when storage is empty', () => {
      storageSpy.get.and.returnValue(null);
      expect(adapter.getSaveTimestamp()).toBeNull();
    });
  });

  // =========================================================================
  // 7. Version mismatch
  // =========================================================================

  describe('version mismatch', () => {
    it('returns null when save version is 0', () => {
      const bad = { ...minimalSave(), version: 0 };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when save version is 2 (future)', () => {
      const bad = { ...minimalSave(), version: 2 };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });

    it('returns null when save version is a string', () => {
      const bad = { ...minimalSave(), version: '1' as unknown as number };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.load()).toBeNull();
    });
  });

  // =========================================================================
  // 8. hasSave / loadGameState delegation
  // =========================================================================

  describe('hasSave and loadGameState', () => {
    it('hasSave() returns true after saving valid data', () => {
      adapter.save(minimalSave());
      expect(adapter.hasSave()).toBeTrue();
    });

    it('hasSave() returns false after clear()', () => {
      adapter.save(minimalSave());
      adapter.clear();
      expect(adapter.hasSave()).toBeFalse();
    });

    it('loadGameState() returns true when valid save exists', () => {
      adapter.save(minimalSave());
      expect(adapter.loadGameState()).toBeTrue();
    });

    it('loadGameState() returns false when no save exists', () => {
      storageSpy.get.and.returnValue(null);
      expect(adapter.loadGameState()).toBeFalse();
    });
  });

  // =========================================================================
  // 9. getSaveTimestamp
  // =========================================================================

  describe('getSaveTimestamp', () => {
    it('returns a timestamp close to now after saving', () => {
      const before = Date.now();
      adapter.save(minimalSave());
      const after = Date.now();
      const ts = adapter.getSaveTimestamp();
      expect(ts).not.toBeNull();
      expect(ts!).toBeGreaterThanOrEqual(before);
      expect(ts!).toBeLessThanOrEqual(after);
    });
  });

  // =========================================================================
  // 10. save() skips invalid data
  // =========================================================================

  describe('save() with invalid data', () => {
    it('returns false when the storage layer rejects the write', () => {
      storageSpy.set.and.returnValue(false);
      expect(adapter.save(minimalSave())).toBeFalse();
    });

    it('does not call storage.set when player is missing', () => {
      const bad = { version: 1, seed: 'x', timestamp: Date.now(), enemies: [] } as unknown as SaveGameData;
      adapter.save(bad);
      expect(storageSpy.set).not.toHaveBeenCalled();
    });

    it('does not call storage.set when enemies is not an array', () => {
      const bad = { ...minimalSave(), enemies: null as unknown as EnemySnapshot[] };
      adapter.save(bad);
      expect(storageSpy.set).not.toHaveBeenCalled();
    });

    it('does not call storage.set when player.name is empty string', () => {
      const bad = minimalSave({
        player: { name: '', x: 0, y: 0, health: 100, maxHealth: 100, shards: 0, xp: 0, level: 1 },
      });
      adapter.save(bad);
      expect(storageSpy.set).not.toHaveBeenCalled();
    });

    it('rejects invalid player economy and upgrade values', () => {
      adapter.save(
        minimalSave({
          player: { ...minimalSave().player, shards: -1 },
        })
      );
      expect(storageSpy.set).not.toHaveBeenCalled();

      adapter.save(
        minimalSave({
          player: { ...minimalSave().player, currentRunUpgrades: { beam_damage: 1.5 } },
        })
      );
      expect(storageSpy.set).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 11. Checkpoint round-trip
  // =========================================================================

  describe('checkpoint round-trip', () => {
    it('restores all checkpoint fields after saveCheckpoint → loadCheckpoint', () => {
      const original = minimalCheckpoint();
      adapter.saveCheckpoint(original);
      const loaded = adapter.loadCheckpoint();

      expect(loaded).not.toBeNull();
      expect(loaded!.health).toBe(75);
      expect(loaded!.maxHealth).toBe(100);
      expect(loaded!.level).toBe(4);
      expect(loaded!.xp).toBe(250);
      expect(loaded!.shards).toBe(12);
      expect(loaded!.kills).toBe(30);
      expect(loaded!.upgrades).toEqual({ speed: 2, damage: 1 });
      expect(loaded!.timePlayed).toBe(180);
      expect(loaded!.playerName).toBe('Hero');
    });

    it('overwrites checkpoint timestamp with current time on save', () => {
      const before = Date.now();
      adapter.saveCheckpoint(minimalCheckpoint({ timestamp: 0 }));
      const after = Date.now();

      const loaded = adapter.loadCheckpoint();
      expect(loaded!.timestamp).toBeGreaterThanOrEqual(before);
      expect(loaded!.timestamp).toBeLessThanOrEqual(after);
    });

    it('hasCheckpoint() returns true after saving a valid checkpoint', () => {
      adapter.saveCheckpoint(minimalCheckpoint());
      expect(adapter.hasCheckpoint()).toBeTrue();
    });

    it('hasCheckpoint() returns false after clearCheckpoint()', () => {
      adapter.saveCheckpoint(minimalCheckpoint());
      adapter.clearCheckpoint();
      expect(adapter.hasCheckpoint()).toBeFalse();
    });

    it('returns false when the storage layer rejects the checkpoint write', () => {
      storageSpy.set.and.returnValue(false);

      expect(adapter.saveCheckpoint(minimalCheckpoint())).toBeFalse();
    });
  });

  // =========================================================================
  // 12. Checkpoint validation edge cases
  // =========================================================================

  describe('checkpoint validation', () => {
    it('returns null when checkpoint version mismatches', () => {
      const bad = { ...minimalCheckpoint(), version: 99 };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.loadCheckpoint()).toBeNull();
    });

    it('returns null when checkpoint health is a string', () => {
      const bad = { ...minimalCheckpoint(), health: 'full' as unknown as number };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.loadCheckpoint()).toBeNull();
    });

    it('returns null when checkpoint playerName is missing', () => {
      const bad = { ...minimalCheckpoint(), playerName: undefined as unknown as string };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.loadCheckpoint()).toBeNull();
    });

    it('returns null when checkpoint upgrades is null', () => {
      const bad = { ...minimalCheckpoint(), upgrades: null as unknown as Record<string, number> };
      storageSpy.get.and.returnValue(bad);
      expect(adapter.loadCheckpoint()).toBeNull();
    });

    it('rejects negative and non-finite checkpoint economy values', () => {
      storageSpy.get.and.returnValue({ ...minimalCheckpoint(), shards: -1 });
      expect(adapter.loadCheckpoint()).toBeNull();

      storageSpy.get.and.returnValue({ ...minimalCheckpoint(), xp: Number.POSITIVE_INFINITY });
      expect(adapter.loadCheckpoint()).toBeNull();
    });

    it('rejects array-shaped or fractional upgrade counts', () => {
      storageSpy.get.and.returnValue({ ...minimalCheckpoint(), upgrades: [] as unknown as Record<string, number> });
      expect(adapter.loadCheckpoint()).toBeNull();

      storageSpy.get.and.returnValue({ ...minimalCheckpoint(), upgrades: { beam_damage: 1.5 } });
      expect(adapter.loadCheckpoint()).toBeNull();
    });

    it('rejects malformed faction standings', () => {
      storageSpy.get.and.returnValue(
        minimalCheckpoint({ factionStandings: [{ factionId: 1, standing: Number.POSITIVE_INFINITY }] })
      );

      expect(adapter.loadCheckpoint()).toBeNull();
      expect(storageSpy.remove).toHaveBeenCalledWith('run-checkpoint');
    });

    it('returns null when checkpoint is a plain string', () => {
      storageSpy.get.and.returnValue('corrupted');
      expect(adapter.loadCheckpoint()).toBeNull();
    });

    it('clears checkpoint storage when data is invalid', () => {
      const bad = { ...minimalCheckpoint(), health: 'bad' as unknown as number };
      storageSpy.get.and.returnValue(bad);
      adapter.loadCheckpoint();
      expect(storageSpy.remove).toHaveBeenCalledWith('run-checkpoint');
    });

    it('does not throw when clearCheckpoint storage.remove throws', () => {
      storageSpy.remove.and.throwError('StorageError');
      expect(() => adapter.clearCheckpoint()).not.toThrow();
    });
  });

  // =========================================================================
  // 13. Player name round-trip
  // =========================================================================

  describe('player name', () => {
    it('round-trips player name correctly', () => {
      adapter.savePlayerName('Cosmonaut');
      expect(adapter.loadPlayerName()).toBe('Cosmonaut');
    });

    it('trims whitespace when saving player name', () => {
      adapter.savePlayerName('  Hero  ');
      expect(storageSpy.set).toHaveBeenCalledWith('player-name', 'Hero');
    });

    it('saves empty string when name is whitespace only', () => {
      adapter.savePlayerName('   ');
      expect(storageSpy.set).toHaveBeenCalledWith('player-name', '');
    });

    it('returns null when no player name is stored', () => {
      storageSpy.get.and.returnValue(null);
      expect(adapter.loadPlayerName()).toBeNull();
    });

    it('clearPlayerName() removes the stored name', () => {
      adapter.savePlayerName('Hero');
      adapter.clearPlayerName();
      expect(storageSpy.remove).toHaveBeenCalledWith('player-name');
    });

    it('does not throw when loadPlayerName storage.get throws', () => {
      storageSpy.get.and.throwError('SecurityError');
      expect(() => adapter.loadPlayerName()).not.toThrow();
      expect(adapter.loadPlayerName()).toBeNull();
    });

    it('does not throw when savePlayerName storage.set throws', () => {
      storageSpy.set.and.throwError('QuotaExceededError');
      expect(() => adapter.savePlayerName('Hero')).not.toThrow();
    });

    it('does not throw when clearPlayerName storage.remove throws', () => {
      storageSpy.remove.and.throwError('StorageError');
      expect(() => adapter.clearPlayerName()).not.toThrow();
    });
  });

  // =========================================================================
  // 14. clearGameState delegation
  // =========================================================================

  describe('clearGameState', () => {
    it('removes save data via clear()', () => {
      adapter.save(minimalSave());
      adapter.clearGameState();
      expect(adapter.hasSave()).toBeFalse();
    });

    it('does not throw even if storage.remove throws', () => {
      storageSpy.remove.and.throwError('StorageError');
      expect(() => adapter.clearGameState()).not.toThrow();
    });
  });

  // =========================================================================
  // 15. Storage key isolation — correct keys used
  // =========================================================================

  describe('storage key isolation', () => {
    it('save() writes to "save-v2" key', () => {
      adapter.save(minimalSave());
      expect(storageSpy.set).toHaveBeenCalledWith('save-v2', jasmine.any(Object));
    });

    it('clear() removes from "save-v2" key', () => {
      adapter.clear();
      expect(storageSpy.remove).toHaveBeenCalledWith('save-v2');
    });

    it('savePlayerName() writes to "player-name" key', () => {
      adapter.savePlayerName('Ace');
      expect(storageSpy.set).toHaveBeenCalledWith('player-name', 'Ace');
    });

    it('saveCheckpoint() writes to "run-checkpoint" key', () => {
      adapter.saveCheckpoint(minimalCheckpoint());
      expect(storageSpy.set).toHaveBeenCalledWith('run-checkpoint', jasmine.any(Object));
    });

    it('clearCheckpoint() removes from "run-checkpoint" key', () => {
      adapter.clearCheckpoint();
      expect(storageSpy.remove).toHaveBeenCalledWith('run-checkpoint');
    });
  });
});
