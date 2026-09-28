/**
 * game-state-transitions.spec.ts
 *
 * Tests the FSM-like lifecycle transitions of GameStateService:
 *   idle → playing → paused → playing → dead → restarted
 *
 * The companion file game-state.service.spec.ts covers unit-level
 * operations (name management, shard math, kill streaks, debug logging,
 * Emergency Protocols, etc.).  This file covers state-machine transitions
 * and cross-cutting invariants that only manifest when multiple operations
 * are sequenced together.
 */

import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameStateService } from './game-state.service';
import { StorageService } from '../../services/storage.service';
import { PlayerService } from '../player/player.service';
import { PlayerUpgradesService } from '../player/player-upgrades.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { PostProcessingService } from '../effects/post-processing.service';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { UpgradeService } from '../../services/upgrade.service';
import { CurseService } from '../../services/curse.service';
import { AudioService } from '../audio/audio.service';
import { AchievementService } from '../../services/achievement.service';
import { SaveGameAdapter } from './save-game.adapter';
import { DifficultyService } from '../../services/difficulty.service';
import { GameState } from '../models/game-state.model';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build the full provider array expected by GameStateService. */
function buildProviders(
  mockPlayerService: jasmine.SpyObj<PlayerService>,
  mockPlayerUpgrades: jasmine.SpyObj<PlayerUpgradesService>,
  mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>
): Provider[] {
  const mockUpgradeService = jasmine.createSpyObj('UpgradeService', [
    'getUpgrades',
    'reset',
    'resetAllUpgrades',
    'getUpgradesForSave',
    'loadUpgradesFromSave',
    'getRunBuildSummary',
  ]);
  mockUpgradeService.getRunBuildSummary.and.returnValue([]);

  return [
    GameStateService,
    { provide: StorageService, useValue: jasmine.createSpyObj('StorageService', ['get', 'set', 'remove']) },
    { provide: PlayerService, useValue: mockPlayerService },
    { provide: PlayerUpgradesService, useValue: mockPlayerUpgrades },
    { provide: DebugLogBridgeService, useValue: mockDebugLog },
    {
      provide: PostProcessingService,
      useValue: jasmine.createSpyObj('PostProcessingService', ['addScreenFlash', 'setVignetteState', 'clear']),
    },
    {
      provide: ProgressionSystemService,
      useValue: jasmine.createSpyObj('ProgressionSystemService', ['addXp', 'reset', 'setLevel', 'setXp'], {
        level: 1,
        xp: 0,
        ascensionLevel: 0,
        levelUp$: { subscribe: () => ({ unsubscribe: () => {} }) },
      }),
    },
    {
      provide: UpgradeService,
      useValue: mockUpgradeService,
    },
    {
      provide: CurseService,
      useValue: jasmine.createSpyObj('CurseService', [
        'getDifficultyMultiplier',
        'getActiveCurses',
        'reset',
        'resetAllCurses',
      ]),
    },
    {
      provide: AudioService,
      useValue: jasmine.createSpyObj('AudioService', [
        'playBeamFire',
        'playEnemyDeath',
        'playEliteDeath',
        'playShardCollect',
        'playDamageTaken',
        'playLevelUp',
        'playComboTier',
        'playBossBurst',
        'destroy',
      ]),
    },
    {
      provide: AchievementService,
      useValue: jasmine.createSpyObj('AchievementService', [
        'recordDamageTaken',
        'recordShardsCollected',
        'recordTimeSurvived',
        'recordRunComplete',
        'resetRunState',
      ]),
    },
    {
      provide: SaveGameAdapter,
      useValue: jasmine.createSpyObj('SaveGameAdapter', ['saveCheckpoint', 'clearCheckpoint', 'save', 'load']),
    },
    {
      provide: DifficultyService,
      useValue: jasmine.createSpyObj('DifficultyService', ['getDifficulty'], {
        /* no properties needed */
      }),
    },
  ];
}

// ─── suite ────────────────────────────────────────────────────────────────────

describe('GameStateService — FSM Transitions', () => {
  let service: GameStateService;
  let mockPlayer: jasmine.SpyObj<PlayerService>;
  let mockUpgrades: jasmine.SpyObj<PlayerUpgradesService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    mockPlayer = jasmine.createSpyObj('PlayerService', ['getMaxHealth', 'onDamageTaken', 'isParryAvailable']);
    mockUpgrades = jasmine.createSpyObj('PlayerUpgradesService', [
      'hasEmergencyProtocols',
      'getEmergencyHealingMultiplier',
    ]);
    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log', 'logDamage', 'logHeal']);

    mockPlayer.getMaxHealth.and.returnValue(100);
    mockUpgrades.hasEmergencyProtocols.and.returnValue(false);
    mockUpgrades.getEmergencyHealingMultiplier.and.returnValue(1.0);
    mockPlayer.isParryAvailable.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: buildProviders(mockPlayer, mockUpgrades, mockDebugLog),
    });

    service = TestBed.inject(GameStateService);
  });

  // ── 1. Initial state ────────────────────────────────────────────────────────

  describe('1 — Initial state after service creation', () => {
    it('starts paused', () => {
      expect(service.isPaused()).toBe(true);
    });

    it('starts with full health (100)', () => {
      expect(service.getHealth()).toBe(100);
    });

    it('starts with zero shards', () => {
      expect(service.getShards()).toBe(0);
    });

    it('starts with zero kills', () => {
      expect(service.getKills()).toBe(0);
    });

    it('starts with startTime = 0', () => {
      expect(service.getStartTime()).toBe(0);
    });

    it('starts with lastTime = 0', () => {
      expect(service.getLastTime()).toBe(0);
    });

    it('starts with luck multiplier = 1.0', () => {
      expect(service.getLuckMultiplier()).toBe(1.0);
    });

    it('signal state is null before first emitState call', () => {
      // State signal is null on construction — only populated after first emit
      expect(service.state()).toBeNull();
    });
  });

  // ── 2. Game start initializes state ─────────────────────────────────────────

  describe('2 — Game start initializes all state properly', () => {
    it('unpausing the game clears the paused flag', () => {
      service.setPaused(false);
      expect(service.isPaused()).toBe(false);
    });

    it('setting startTime records the game start time', () => {
      const t = Date.now();
      service.setStartTime(t);
      expect(service.getStartTime()).toBe(t);
    });

    it('emitState after start populates signal with correct health and shards', () => {
      service.setPaused(false);
      service.setStartTime(Date.now());
      service.emitState();

      const s = service.state() as GameState;
      expect(s).not.toBeNull();
      expect(s.health).toBe(100);
      expect(s.shards).toBe(0);
      expect(s.level).toBe(1);
    });

    it('observable state$ mirrors signal state after emitState', (done) => {
      service.emitState();
      service.state$.subscribe((s) => {
        if (s) {
          expect(s.health).toBe(service.state()!.health);
          done();
        }
      });
    });
  });

  // ── 3. Pause / resume toggles ────────────────────────────────────────────────

  describe('3 — Pause / resume toggles', () => {
    it('game is paused by default', () => {
      expect(service.isPaused()).toBe(true);
    });

    it('setPaused(false) unpauses and records lastTime', () => {
      service.setPaused(false);
      expect(service.isPaused()).toBe(false);
      expect(service.getLastTime()).toBeGreaterThan(0);
    });

    it('setPaused(true) pauses without modifying lastTime', () => {
      service.setPaused(false);
      const lastTime = service.getLastTime();
      service.setPaused(true);
      expect(service.isPaused()).toBe(true);
      expect(service.getLastTime()).toBe(lastTime);
    });

    it('toggling pause multiple times is idempotent to final value', () => {
      service.setPaused(false);
      service.setPaused(true);
      service.setPaused(false);
      service.setPaused(true);
      expect(service.isPaused()).toBe(true);
    });

    it('pausing does not alter health, shards, or kills', () => {
      service.addShards(50);
      service.incrementKills();
      service.setPaused(true);
      service.setPaused(false);

      expect(service.getHealth()).toBe(100);
      expect(service.getShards()).toBe(50);
      expect(service.getKills()).toBe(1);
    });
  });

  // ── 4. takeDamage — reduces health, respects immunity (dead player block) ───

  describe('4 — takeDamage respects dead-player immunity', () => {
    it('reduces health by the damage amount', () => {
      service.takeDamage(30);
      expect(service.getHealth()).toBe(70);
    });

    it('health never goes below 0 from single hit', () => {
      service.takeDamage(999);
      expect(service.getHealth()).toBe(0);
    });

    it('blocks damage when player is already at 0 HP', () => {
      service.takeDamage(100); // kill
      const healthAfterDeath = service.getHealth();
      service.takeDamage(50); // should be blocked
      expect(service.getHealth()).toBe(healthAfterDeath);
    });

    it('zero damage is ignored and does not change health', () => {
      service.takeDamage(0);
      expect(service.getHealth()).toBe(100);
    });

    it('negative damage is ignored', () => {
      service.takeDamage(-10);
      expect(service.getHealth()).toBe(100);
    });

    it('NaN damage is ignored', () => {
      service.takeDamage(NaN);
      expect(service.getHealth()).toBe(100);
    });

    it('notifies player service on valid damage', () => {
      service.takeDamage(25);
      expect(mockPlayer.onDamageTaken).toHaveBeenCalledWith(25);
    });

    it('does not notify player service on blocked damage (dead player)', () => {
      service.takeDamage(100); // kill
      mockPlayer.onDamageTaken.calls.reset();
      service.takeDamage(25); // blocked
      expect(mockPlayer.onDamageTaken).not.toHaveBeenCalled();
    });
  });

  // ── 5. Player death triggers correct state transition ────────────────────────

  describe('5 — Player death triggers correct state transition', () => {
    it('health reaches exactly 0 on lethal hit', (done) => {
      service.gameOver$.subscribe(() => {
        expect(service.getHealth()).toBe(0);
        done();
      });
      service.takeDamage(100);
    });

    it('gameOver$ emits with correct snapshot (shards, kills, level)', (done) => {
      service.addShards(75);
      service.incrementKills();
      service.incrementKills();
      service.incrementKills();

      service.gameOver$.subscribe((stats) => {
        expect(stats.shards).toBe(75);
        expect(stats.kills).toBe(3);
        expect(stats.level).toBe(1);
        expect(stats.health).toBe(0);
        done();
      });

      service.takeDamage(100);
    });

    it('setHealth cannot restore health after death (spawn_fix sources bypass this)', () => {
      service.takeDamage(100); // death
      service.setHealth(80, 'some_other_source');
      expect(service.getHealth()).toBe(0); // blocked
    });

    it('setHealth with player_spawn_fix source bypasses the dead-player block', () => {
      service.takeDamage(100); // death
      service.setHealth(100, 'player_spawn_fix');
      expect(service.getHealth()).toBe(100);
    });

    it('setHealth with spawn_sync source bypasses the dead-player block', () => {
      service.takeDamage(100); // death
      service.setHealth(50, 'spawn_sync');
      expect(service.getHealth()).toBe(50);
    });

    it('setHealth with upgrade rollback source restores pre-transaction health after a fatal effect', () => {
      service.takeDamage(100);
      service.setHealth(75, 'upgrade_transaction_rollback');
      expect(service.getHealth()).toBe(75);
    });

    it('heal() is blocked when player is dead', () => {
      service.takeDamage(100); // death
      service.heal(50, 'pickup');
      expect(service.getHealth()).toBe(0);
    });

    it('gameOver$ emits exactly once per death (not multiple times)', () => {
      let count = 0;
      service.gameOver$.subscribe(() => count++);
      service.takeDamage(100);
      expect(count).toBe(1);
    });
  });

  // ── 6. State reset on game restart clears ALL accumulated state ─────────────

  describe('6 — State reset on game restart clears ALL accumulated state', () => {
    beforeEach(() => {
      // Build up gameplay state before reset
      service.setPaused(false);
      service.setStartTime(Date.now());
      service.setLastTime(Date.now());
      service.addShards(200);
      service.incrementKills();
      service.incrementKills();
      service.incrementKills();
      service.takeDamage(40);
      service.trackPlayerAction();
      service.trackPlayerAction();
      service.setLuckMultiplier(2.5);
      service.setLastEliteSpawnTime(99999);
    });

    it('reset() restores health to 100', () => {
      service.reset();
      expect(service.getHealth()).toBe(100);
    });

    it('reset() restores health to the ascension-scaled max, not a hardcoded 100', () => {
      mockPlayer.getMaxHealth.and.returnValue(125);
      service.reset();
      expect(service.getHealth()).toBe(125);
    });

    it('reset() clears shards to 0', () => {
      service.reset();
      expect(service.getShards()).toBe(0);
    });

    it('reset() clears kills to 0', () => {
      service.reset();
      expect(service.getKills()).toBe(0);
    });

    it('reset() clears kill streak to 0', () => {
      service.reset();
      expect(service.getKillStreak()).toBe(0);
    });

    it('reset() clears max kill streak to 0', () => {
      service.reset();
      expect(service.getMaxKillStreak()).toBe(0);
    });

    it('reset() clears player action count to 0', () => {
      service.reset();
      expect(service.getPlayerActionCount()).toBe(0);
    });

    it('reset() clears startTime and lastTime to 0', () => {
      service.reset();
      expect(service.getStartTime()).toBe(0);
      expect(service.getLastTime()).toBe(0);
    });

    it('reset() restores luck multiplier to 1.0', () => {
      service.reset();
      expect(service.getLuckMultiplier()).toBe(1.0);
    });

    it('reset() resets eliteSpawnTime to 0', () => {
      service.reset();
      expect(service.getLastEliteSpawnTime()).toBe(0);
    });

    it('reset() does NOT change pause state (caller manages pause)', () => {
      // Was unpaused in beforeEach
      service.reset();
      expect(service.isPaused()).toBe(false);
    });

    it('reset() emits state reflecting clean values', () => {
      service.reset();
      // emitState() is synchronous — signal is updated immediately
      const s = service.state();
      expect(s).not.toBeNull();
      expect(s!.health).toBe(100);
      expect(s!.shards).toBe(0);
      expect(s!.kills).toBe(0);
    });

    it('reset() re-enables damage (previously dead player can take damage again)', () => {
      service.takeDamage(100); // kill
      service.reset();
      service.takeDamage(20);
      expect(service.getHealth()).toBe(80);
    });
  });

  // ── 7. Health clamping — never negative, never above max ────────────────────

  describe('7 — Health values clamp correctly', () => {
    it('setHealth clamps to 0 (never negative)', () => {
      service.setHealth(-999);
      expect(service.getHealth()).toBe(0);
    });

    it('setHealth clamps to maxHealth (never above max)', () => {
      mockPlayer.getMaxHealth.and.returnValue(100);
      service.setHealth(9999);
      expect(service.getHealth()).toBe(100);
    });

    it('heal() clamps result to maxHealth', () => {
      service.setHealth(95);
      service.heal(50);
      expect(service.getHealth()).toBe(100);
    });

    it('clampCurrentHealth reduces health when max decreases', () => {
      service.setHealth(100);
      mockPlayer.getMaxHealth.and.returnValue(60);
      service.clampCurrentHealth();
      expect(service.getHealth()).toBe(60);
    });

    it('clampCurrentHealth is a no-op when health is below max', () => {
      service.setHealth(40);
      mockPlayer.getMaxHealth.and.returnValue(100);
      service.clampCurrentHealth();
      expect(service.getHealth()).toBe(40);
    });

    it('health rounds to at most 2 decimal places', () => {
      service.setHealth(33.333333);
      const h = service.getHealth();
      const decimals = (h.toString().split('.')[1] ?? '').length;
      expect(decimals).toBeLessThanOrEqual(2);
    });

    it('Infinity health set is ignored', () => {
      service.setHealth(Infinity);
      expect(service.getHealth()).toBe(100);
    });

    it('NaN damage does not corrupt health', () => {
      service.takeDamage(NaN);
      expect(service.getHealth()).toBe(100);
    });

    it('NaN heal amount does not corrupt health', () => {
      service.setHealth(50);
      service.heal(NaN);
      expect(service.getHealth()).toBe(50);
    });

    it('getMaxHealth falls back to 100 when player returns 0', () => {
      mockPlayer.getMaxHealth.and.returnValue(0);
      expect(service.getMaxHealth()).toBe(100);
    });
  });

  // ── 8. Multiple rapid state changes do not corrupt state ────────────────────

  describe('8 — Multiple rapid state changes do not corrupt state', () => {
    it('many small damage hits accumulate correctly', () => {
      for (let i = 0; i < 9; i++) {
        service.takeDamage(5);
      }
      expect(service.getHealth()).toBe(55); // 100 - 9*5
    });

    it('many small heals cap at maxHealth', () => {
      service.setHealth(50);
      for (let i = 0; i < 20; i++) {
        service.heal(5);
      }
      expect(service.getHealth()).toBe(100);
    });

    it('interleaved damage and heal land at correct final value', () => {
      service.takeDamage(30); // 70
      service.heal(10); // 80
      service.takeDamage(20); // 60
      service.heal(5); // 65
      service.takeDamage(15); // 50
      expect(service.getHealth()).toBe(50);
    });

    it('rapid pause/unpause cycles do not corrupt health or shards', () => {
      service.addShards(100);
      for (let i = 0; i < 10; i++) {
        service.setPaused(i % 2 === 0);
      }
      expect(service.getHealth()).toBe(100);
      expect(service.getShards()).toBe(100);
    });

    it('many incrementKills calls accumulate correctly', () => {
      const N = 50;
      for (let i = 0; i < N; i++) {
        service.incrementKills();
      }
      expect(service.getKills()).toBe(N);
    });

    it('death followed by reset followed by new damage does not carry ghost state', () => {
      service.takeDamage(100); // kill
      service.reset();

      // Simulate a fresh run
      service.addShards(30);
      service.takeDamage(20);

      expect(service.getHealth()).toBe(80);
      expect(service.getShards()).toBe(30);
      expect(service.getKills()).toBe(0);
    });

    it('signal state accumulates multiple updates atomically (Sprint A8d — observable retired)', () => {
      service.takeDamage(10);
      service.addShards(50);
      service.incrementKills();
      service.heal(5);

      const signalState = service.state();
      expect(signalState).not.toBeNull();
      // Each mutator runs emitState() which writes to the signal; the
      // final read should reflect the cumulative effect.
      expect(signalState!.health).toBe(service.getHealth());
      expect(signalState!.shards).toBe(service.getShards());
      expect(signalState!.kills).toBe(service.getKills());
    });
  });
});
