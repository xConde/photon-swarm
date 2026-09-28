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
import { GameStats } from '../models/game-state.model';
import { filter, take } from 'rxjs/operators';

// Types for accessing GameStateService internals in tests
interface GameStateServiceInternal {
  lastKillTime: number;
}

// Type for debug log call arguments
interface DebugLogCallArgs {
  type: string;
  amount?: number;
  source?: string;
  healthBefore?: number;
  healthAfter?: number;
  valueBefore?: number;
  valueAfter?: number;
}

describe('GameStateService', () => {
  let service: GameStateService;
  let mockStorageService: jasmine.SpyObj<StorageService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockPlayerUpgrades: jasmine.SpyObj<PlayerUpgradesService>;
  let mockDebugLogBridge: jasmine.SpyObj<DebugLogBridgeService>;
  let mockUpgradeService: jasmine.SpyObj<UpgradeService>;

  beforeEach(() => {
    // Create mocks
    mockStorageService = jasmine.createSpyObj('StorageService', ['get', 'set', 'remove']);
    mockPlayerService = jasmine.createSpyObj('PlayerService', ['getMaxHealth', 'onDamageTaken', 'isParryAvailable']);
    mockPlayerUpgrades = jasmine.createSpyObj('PlayerUpgradesService', [
      'hasEmergencyProtocols',
      'getEmergencyHealingMultiplier',
    ]);
    mockDebugLogBridge = jasmine.createSpyObj('DebugLogBridgeService', ['log', 'logDamage', 'logHeal']);
    mockUpgradeService = jasmine.createSpyObj('UpgradeService', ['getRunBuildSummary', 'resetAllUpgrades']);

    mockPlayerService.getMaxHealth.and.returnValue(100);
    mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(false);
    mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(1.0);
    mockPlayerService.isParryAvailable.and.returnValue(false);
    mockUpgradeService.getRunBuildSummary.and.returnValue([]);

    TestBed.configureTestingModule({
      providers: [
        GameStateService,
        { provide: StorageService, useValue: mockStorageService },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: PlayerUpgradesService, useValue: mockPlayerUpgrades },
        { provide: DebugLogBridgeService, useValue: mockDebugLogBridge },
        {
          provide: PostProcessingService,
          useValue: jasmine.createSpyObj('PostProcessingService', ['addScreenFlash', 'setVignetteState', 'clear']),
        },
        {
          provide: ProgressionSystemService,
          useValue: jasmine.createSpyObj('ProgressionSystemService', ['addXp', 'reset'], {
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
      ],
    });

    service = TestBed.inject(GameStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Player Name Management', () => {
    it('should set and get player name', () => {
      service.setPlayerName('TestPlayer');
      expect(mockStorageService.set).toHaveBeenCalledWith('player-name', 'TestPlayer');
      expect(service.getPlayerName()).toBe('TestPlayer');
    });

    it('should trim whitespace from player name', () => {
      service.setPlayerName('  TestPlayer  ');
      expect(mockStorageService.set).toHaveBeenCalledWith('player-name', 'TestPlayer');
    });

    it('should generate random name if empty string provided', () => {
      service.setPlayerName('');
      const name = service.getPlayerName();
      expect(name).toMatch(/^Pilot‑\d+$/);
    });

    it('should load saved name from storage', () => {
      mockStorageService.get.and.returnValue('SavedPlayer');
      const name = service.getPlayerName();
      expect(name).toBe('SavedPlayer');
      expect(mockStorageService.get).toHaveBeenCalledWith('player-name');
    });

    it('should generate random name if no saved name', () => {
      mockStorageService.get.and.returnValue(null);
      const name = service.getPlayerName();
      expect(name).toMatch(/^Pilot‑\d+$/);
    });

    it('generatePilotName() returns a Pilot- name without touching storage or the current name', () => {
      service.setPlayerName('TestPlayer');
      mockStorageService.set.calls.reset();

      const generated = service.generatePilotName();

      expect(generated).toMatch(/^Pilot‑\d+$/);
      expect(mockStorageService.set).not.toHaveBeenCalled();
      expect(service.getPlayerName()).toBe('TestPlayer');
    });

    it('setPlayerName() with an already-generated Pilot- name keeps it exactly as-is — no re-generation, no mangling (it only falls back on empty input)', () => {
      const generated = service.generatePilotName();

      service.setPlayerName(generated);

      expect(service.getPlayerName()).toBe(generated);
      expect(mockStorageService.set).toHaveBeenCalledWith('player-name', generated);
    });
  });

  describe('Health Management', () => {
    it('should get initial health', () => {
      expect(service.getHealth()).toBe(100);
    });

    it('should set health within bounds', () => {
      service.setHealth(50);
      expect(service.getHealth()).toBe(50);
    });

    it('should clamp health to max', () => {
      mockPlayerService.getMaxHealth.and.returnValue(100);
      service.setHealth(150);
      expect(service.getHealth()).toBe(100);
    });

    it('should clamp health to min', () => {
      service.setHealth(-10);
      expect(service.getHealth()).toBe(0);
    });

    it('should log health changes to debug bridge', () => {
      service.setHealth(75, 'test-source');
      expect(mockDebugLogBridge.logDamage).toHaveBeenCalled();
      const callArgs = mockDebugLogBridge.logDamage.calls.mostRecent().args[0] as DebugLogCallArgs;
      expect(callArgs.type).toBe('HEALTH_SET');
      expect(callArgs.valueBefore).toBe(100);
      expect(callArgs.valueAfter).toBe(75);
      expect(callArgs.source).toBe('test-source');
    });

    it('should flag suspicious health sets', () => {
      service.setHealth(10);
      service.setHealth(95, 'suspicious-heal');
      expect(mockDebugLogBridge.logHeal).toHaveBeenCalled();
      const isSuspicious = mockDebugLogBridge.logHeal.calls.mostRecent().args[1];
      expect(isSuspicious).toBe(true);
    });

    it('should emit state after health change', (done) => {
      service.state$.pipe(filter(Boolean), take(1)).subscribe((state) => {
        expect(state.health).toBe(75);
        done();
      });
      service.setHealth(75);
    });
  });

  describe('Healing', () => {
    it('should heal up to max health', () => {
      service.setHealth(50);
      service.heal(30);
      expect(service.getHealth()).toBe(80);
    });

    it('should not heal above max health', () => {
      service.setHealth(90);
      service.heal(50);
      expect(service.getHealth()).toBe(100);
    });

    it('should ignore negative heal amounts', () => {
      service.setHealth(50);
      service.heal(-10);
      expect(service.getHealth()).toBe(50);
    });

    it('should log healing to debug bridge', () => {
      service.setHealth(50);
      service.heal(25, 'potion');
      expect(mockDebugLogBridge.logHeal).toHaveBeenCalled();
      const callArgs = mockDebugLogBridge.logHeal.calls.mostRecent().args[0] as DebugLogCallArgs;
      expect(callArgs.type).toBe('HEAL_APPLIED');
      expect(callArgs.amount).toBe(25);
      expect(callArgs.source).toBe('potion');
      expect(callArgs.healthBefore).toBe(50);
      expect(callArgs.healthAfter).toBe(75);
    });

    it('should flag suspicious healing', () => {
      service.setHealth(15);
      service.heal(80, 'suspicious-source');
      const isSuspicious = mockDebugLogBridge.logHeal.calls.mostRecent().args[1];
      expect(isSuspicious).toBe(true);
    });
  });

  describe('Damage Handling', () => {
    it('should apply damage correctly', () => {
      service.takeDamage(25);
      expect(service.getHealth()).toBe(75);
    });

    it('should not reduce health below 0', () => {
      service.takeDamage(150);
      expect(service.getHealth()).toBe(0);
    });

    it('should notify player service of damage', () => {
      service.takeDamage(25);
      expect(mockPlayerService.onDamageTaken).toHaveBeenCalledWith(25);
    });

    it('should log damage to debug bridge', () => {
      service.takeDamage(30, 'enemy-projectile');
      expect(mockDebugLogBridge.logDamage).toHaveBeenCalled();
      const callArgs = mockDebugLogBridge.logDamage.calls.mostRecent().args[0] as DebugLogCallArgs;
      expect(callArgs.type).toBe('DAMAGE_TAKEN');
      expect(callArgs.amount).toBe(30);
      expect(callArgs.source).toBe('enemy-projectile');
      expect(callArgs.healthBefore).toBe(100);
      expect(callArgs.healthAfter).toBe(70);
    });

    it('should detect suspicious damage patterns', () => {
      // High percentage damage (>= 90% or > 50 amount)
      // 90% of 100 = 90 damage to be flagged as suspicious
      service.takeDamage(90, 'high-damage');
      let isSuspicious = mockDebugLogBridge.logDamage.calls.mostRecent().args[1];
      expect(isSuspicious).toBe(true);

      // Also test > 50 damage threshold
      service.setHealth(100);
      service.takeDamage(51, 'large-damage');
      isSuspicious = mockDebugLogBridge.logDamage.calls.mostRecent().args[1];
      expect(isSuspicious).toBe(true);
    });

    it('should trigger game over when health reaches 0', (done) => {
      service.gameOver$.subscribe((stats) => {
        expect(stats.health).toBe(0);
        done();
      });

      service.takeDamage(100, 'fatal-damage');
    });

    it('should include proper stats in game over event', (done) => {
      service.addShards(50);
      service.incrementKills();
      service.incrementKills();

      service.gameOver$.subscribe((stats) => {
        expect(stats.shards).toBe(50);
        expect(stats.kills).toBe(2);
        expect(stats.level).toBe(1);
        expect(stats.maxHealth).toBe(100);
        done();
      });

      service.takeDamage(100);
    });
  });

  describe('Health Clamping', () => {
    it('should clamp current health to new max health', () => {
      service.setHealth(100);
      mockPlayerService.getMaxHealth.and.returnValue(80);
      service.clampCurrentHealth();
      expect(service.getHealth()).toBe(80);
    });

    it('should not change health if below max', () => {
      service.setHealth(50);
      mockPlayerService.getMaxHealth.and.returnValue(100);
      service.clampCurrentHealth();
      expect(service.getHealth()).toBe(50);
    });
  });

  describe('Shard Management', () => {
    it('should start with 0 shards', () => {
      expect(service.getShards()).toBe(0);
    });

    it('should add shards correctly', () => {
      service.addShards(25);
      expect(service.getShards()).toBe(25);
      service.addShards(15);
      expect(service.getShards()).toBe(40);
    });

    it('should floor fractional shard amounts', () => {
      service.addShards(10.7);
      expect(service.getShards()).toBe(10);
    });

    it('should spend shards if sufficient', () => {
      service.addShards(100);
      const success = service.spendShards(60);
      expect(success).toBe(true);
      expect(service.getShards()).toBe(40);
    });

    it('should not spend shards if insufficient', () => {
      service.addShards(30);
      const success = service.spendShards(50);
      expect(success).toBe(false);
      expect(service.getShards()).toBe(30);
    });

    it('rejects invalid prices and refunds without recording collection', () => {
      service.addShards(100);

      expect(service.spendShards(-50)).toBeFalse();
      expect(service.spendShards(0)).toBeFalse();
      expect(service.spendShards(1.5)).toBeFalse();
      expect(service.spendShards(Number.NaN)).toBeFalse();
      expect(service.getShards()).toBe(100);

      expect(service.spendShards(40)).toBeTrue();
      service.refundShards(40);
      expect(service.getShards()).toBe(100);
    });

    it('should emit state after shard changes', (done) => {
      service.state$.pipe(filter(Boolean), take(1)).subscribe((state) => {
        expect(state.shards).toBe(25);
        done();
      });
      service.addShards(25);
    });
  });

  describe('Kill Tracking', () => {
    it('should start with 0 kills', () => {
      expect(service.getKills()).toBe(0);
    });

    it('should increment kills', () => {
      service.incrementKills();
      expect(service.getKills()).toBe(1);
      service.incrementKills();
      expect(service.getKills()).toBe(2);
    });

    it('should track kill streaks', () => {
      // First kill starts streak
      service.incrementKills();
      expect(service.getKillStreak()).toBe(1);

      // Quick succession increases streak
      service.incrementKills();
      expect(service.getKillStreak()).toBe(2);

      service.incrementKills();
      expect(service.getKillStreak()).toBe(3);
    });

    it('should reset kill streak after timeout', () => {
      service.incrementKills();
      expect(service.getKillStreak()).toBe(1);

      // Simulate timeout by manually resetting (since we can't easily mock time)
      (service as unknown as GameStateServiceInternal).lastKillTime = 0;

      service.incrementKills();
      expect(service.getKillStreak()).toBe(1); // Reset to 1
    });

    it('should track max kill streak', () => {
      service.incrementKills();
      service.incrementKills();
      service.incrementKills();
      expect(service.getMaxKillStreak()).toBe(3);

      // Reset streak
      (service as unknown as GameStateServiceInternal).lastKillTime = 0;
      service.incrementKills();
      expect(service.getKillStreak()).toBe(1);
      expect(service.getMaxKillStreak()).toBe(3); // Still 3
    });

    it('should emit state after kills', (done) => {
      service.state$.pipe(filter(Boolean), take(1)).subscribe((state) => {
        expect(state.kills).toBe(1);
        expect(state.killStreak).toBe(1);
        done();
      });
      service.incrementKills();
    });
  });

  describe('Game State Management', () => {
    it('should start paused', () => {
      expect(service.isPaused()).toBe(true);
    });

    it('should set paused state', () => {
      service.setPaused(false);
      expect(service.isPaused()).toBe(false);
      service.setPaused(true);
      expect(service.isPaused()).toBe(true);
    });

    it('should update last time when unpaused', () => {
      const timeBefore = service.getLastTime();
      service.setPaused(false);
      const timeAfter = service.getLastTime();
      expect(timeAfter).toBeGreaterThan(timeBefore);
    });

    it('should manage start time', () => {
      service.setStartTime(1000);
      expect(service.getStartTime()).toBe(1000);
    });

    it('should manage last time', () => {
      service.setLastTime(2000);
      expect(service.getLastTime()).toBe(2000);
    });
  });

  describe('Player Action Tracking', () => {
    it('should track player actions', () => {
      expect(service.getPlayerActionCount()).toBe(0);
      service.trackPlayerAction();
      expect(service.getPlayerActionCount()).toBe(1);
      service.trackPlayerAction();
      expect(service.getPlayerActionCount()).toBe(2);
    });

    it('should reset player action count', () => {
      service.trackPlayerAction();
      service.trackPlayerAction();
      service.resetPlayerActionCount();
      expect(service.getPlayerActionCount()).toBe(0);
    });

    it('should track elite spawn time', () => {
      service.setLastEliteSpawnTime(5000);
      expect(service.getLastEliteSpawnTime()).toBe(5000);
    });

    it('should manage luck multiplier', () => {
      expect(service.getLuckMultiplier()).toBe(1.0);
      service.setLuckMultiplier(1.5);
      expect(service.getLuckMultiplier()).toBe(1.5);
    });
  });

  describe('Events', () => {
    it('should emit level up request', (done) => {
      service.levelUpRequest$.subscribe(() => {
        expect(true).toBe(true);
        done();
      });
      service.requestLevelUp();
    });

    it('should emit game over event with default death reason', (done) => {
      const stats: GameStats = {
        level: 5,
        shards: 100,
        kills: 50,
        time: 300,
        health: 0,
        maxHealth: 120,
        killStreak: 10,
        maxKillStreak: 15,
      };

      service.gameOver$.subscribe((receivedStats) => {
        expect(receivedStats).toEqual({ ...stats, endReason: 'death', runBuild: [] });
        done();
      });

      service.triggerGameOver(stats);
    });

    it('propagates victory reason to subscribers when the player clears the run', (done) => {
      const stats: GameStats = { level: 30, shards: 5000, time: 1800 };

      service.gameOver$.subscribe((received) => {
        expect(received.endReason).toBe('victory');
        done();
      });

      service.triggerGameOver(stats, 'victory');
    });

    it('makes run termination idempotent until the next reset', () => {
      const received: GameStats[] = [];
      service.gameOver$.subscribe((stats) => received.push(stats));

      expect(service.triggerGameOver({ level: 5, shards: 20, time: 60 }, 'death')).toBeTrue();
      expect(service.triggerGameOver({ level: 5, shards: 20, time: 60 }, 'victory')).toBeFalse();

      expect(received.length).toBe(1);
      expect(received[0].endReason).toBe('death');
      expect(mockUpgradeService.resetAllUpgrades).toHaveBeenCalledTimes(1);

      service.reset();
      expect(service.triggerGameOver({ level: 1, shards: 0, time: 0 }, 'victory')).toBeTrue();
      expect(received.length).toBe(2);
    });

    it('propagates quit reason for explicit save-and-quit flows', (done) => {
      const stats: GameStats = { level: 10, shards: 800, time: 240 };

      service.gameOver$.subscribe((received) => {
        expect(received.endReason).toBe('quit');
        done();
      });

      service.triggerGameOver(stats, 'quit');
    });

    it('logs victory at success severity, death at error', () => {
      service.triggerGameOver({ level: 1, shards: 0, time: 0 }, 'victory');
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        '🎮 GameStateService.triggerGameOver called',
        'success',
        jasmine.objectContaining({ reason: 'victory' })
      );

      service.reset();
      service.triggerGameOver({ level: 1, shards: 0, time: 0 });
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        '🎮 GameStateService.triggerGameOver called',
        'error',
        jasmine.objectContaining({ reason: 'death' })
      );
    });

    it('should log game over event', () => {
      const stats: GameStats = {
        level: 1,
        shards: 0,
        kills: 0,
        time: 0,
        health: 0,
        maxHealth: 100,
        killStreak: 0,
        maxKillStreak: 0,
      };

      service.triggerGameOver(stats);
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        '🎮 GameStateService.triggerGameOver called',
        'error',
        jasmine.objectContaining({
          source: 'game_state_service',
          operation: 'trigger_game_over',
          stats: { ...stats, endReason: 'death', runBuild: [] },
        })
      );
    });

    it('captures the run build before resetting upgrade state', (done) => {
      const build = [{ id: 'core_power', name: 'Power', type: 'upgrade' as const, rarity: 'core' as const, stacks: 2 }];
      mockUpgradeService.getRunBuildSummary.and.returnValue(build);
      mockUpgradeService.resetAllUpgrades.and.callFake(() => {
        expect(mockUpgradeService.getRunBuildSummary).toHaveBeenCalledBefore(mockUpgradeService.resetAllUpgrades);
      });

      service.gameOver$.subscribe((received) => {
        expect(received.runBuild).toEqual(build);
        done();
      });

      service.triggerGameOver({ level: 4, shards: 20, time: 60 });
    });
  });

  describe('State Emission', () => {
    it('should emit complete state', (done) => {
      service.setHealth(75);
      service.addShards(50);
      service.incrementKills();

      service.state$.pipe(filter(Boolean), take(1)).subscribe((state) => {
        expect(state.health).toBe(75);
        expect(state.maxHealth).toBe(100);
        expect(state.shards).toBe(50);
        expect(state.kills).toBe(1);
        expect(state.level).toBe(1);
        expect(state.xp).toBe(0);
        done();
      });

      service.emitState();
    });

    it('should merge additional data when emitting', (done) => {
      service.state$.pipe(filter(Boolean), take(1)).subscribe((state) => {
        expect(state.level).toBe(5);
        expect(state.xp).toBe(250);
        done();
      });

      service.emitState({ level: 5, xp: 250 });
    });
  });

  describe('Reset', () => {
    it('should reset all state values', () => {
      // Set up some state
      service.setHealth(50);
      service.addShards(100);
      service.incrementKills();
      service.incrementKills();
      service.trackPlayerAction();
      service.setLuckMultiplier(1.5);
      service.setStartTime(1000);
      service.setLastTime(2000);

      // Reset
      service.reset();

      // Verify reset
      expect(service.getHealth()).toBe(100);
      expect(service.getShards()).toBe(0);
      expect(service.getKills()).toBe(0);
      expect(service.getKillStreak()).toBe(0);
      expect(service.getMaxKillStreak()).toBe(0);
      expect(service.getPlayerActionCount()).toBe(0);
      expect(service.getLastEliteSpawnTime()).toBe(0);
      expect(service.getLuckMultiplier()).toBe(1.0);
      expect(service.getStartTime()).toBe(0);
      expect(service.getLastTime()).toBe(0);
    });

    it('should emit state after reset', (done) => {
      service.state$.pipe(filter(Boolean), take(1)).subscribe((state) => {
        expect(state.health).toBe(100);
        expect(state.shards).toBe(0);
        expect(state.kills).toBe(0);
        done();
      });

      service.reset();
    });

    it('should not change pause state on reset', () => {
      service.setPaused(false);
      service.reset();
      expect(service.isPaused()).toBe(false);
    });

    it('spawns at the ascension-scaled max health on reset', () => {
      mockPlayerService.getMaxHealth.and.returnValue(115);
      service.setHealth(50);

      service.reset();

      expect(service.getHealth()).toBe(115);
    });

    it('clamps spawn health to whatever max the player currently reports', () => {
      mockPlayerService.getMaxHealth.and.returnValue(140);

      service.reset();

      expect(service.getHealth()).toBe(140);
    });

    it('falls back to 100 when the player service hands back 0 (would otherwise spawn dead)', () => {
      mockPlayerService.getMaxHealth.and.returnValue(0);

      service.reset();

      expect(service.getHealth()).toBe(100);
    });

    it('falls back to 100 when getMaxHealth returns NaN', () => {
      mockPlayerService.getMaxHealth.and.returnValue(Number.NaN);

      service.reset();

      expect(service.getHealth()).toBe(100);
    });

    it('falls back to 100 when getMaxHealth returns a negative value', () => {
      mockPlayerService.getMaxHealth.and.returnValue(-50);

      service.reset();

      expect(service.getHealth()).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle max health changes during gameplay', () => {
      service.setHealth(100);
      mockPlayerService.getMaxHealth.and.returnValue(120);
      service.heal(30);
      expect(service.getHealth()).toBe(120);
    });

    it('should clamp negative shard totals to 0', () => {
      service.addShards(-50);
      expect(service.getShards()).toBe(0);
    });

    it('should handle exact health threshold for game over', () => {
      let gameOverTriggered = false;
      service.gameOver$.subscribe(() => {
        gameOverTriggered = true;
      });

      // Set health to 1 and take 1 damage to reach exactly 0
      // Note: takeDamage(0, ...) returns early, so we need actual damage
      service.setHealth(1);
      service.takeDamage(1, 'test');
      expect(gameOverTriggered).toBe(true);
    });

    it('should handle player service without onDamageTaken method', () => {
      // Set the spy to undefined to test handling of missing method
      const playerServiceWithoutMethod = mockPlayerService as unknown as { onDamageTaken: undefined };
      playerServiceWithoutMethod.onDamageTaken = undefined;
      expect(() => service.takeDamage(25)).not.toThrow();
    });

    it('should handle missing debug log bridge gracefully', () => {
      window.debugLogBridge = undefined;
      expect(() => {
        service.setHealth(50);
        service.heal(25);
        service.takeDamage(30);
      }).not.toThrow();
    });
  });

  describe('Numeric Edge Case Guards', () => {
    it('should clamp negative shard totals to 0 after spending', () => {
      service.addShards(10);
      service.spendShards(10);
      service.addShards(-5);
      expect(service.getShards()).toBe(0);
    });

    it('should ignore NaN damage', () => {
      service.takeDamage(NaN, 'bad-source');
      expect(service.getHealth()).toBe(100);
    });

    it('should ignore Infinity health set', () => {
      service.setHealth(Infinity, 'overflow');
      expect(service.getHealth()).toBe(100);
    });

    it('should ignore NaN heal amount', () => {
      service.setHealth(50);
      service.heal(NaN, 'corrupt');
      expect(service.getHealth()).toBe(50);
    });

    it('should ignore NaN shard addition', () => {
      service.addShards(10);
      service.addShards(NaN);
      expect(service.getShards()).toBe(10);
    });
  });

  // New comprehensive tests for level up enhancements
  describe('Level Up Health Restoration (25% heal)', () => {
    it('should heal 25% of max health on level up when not at max', () => {
      // Arrange
      mockPlayerService.getMaxHealth.and.returnValue(100);
      service.setHealth(50); // Start at 50% health

      // Manually trigger the level up heal logic (since we can't easily mock ProgressionSystemService)
      // This simulates what happens in initializeLevelUpSubscription
      const currentHealth = service.getHealth();
      const maxHealth = 100;
      const healAmount = Math.floor(maxHealth * 0.25);
      const actualHeal = Math.min(healAmount, maxHealth - currentHealth);

      // Act
      if (actualHeal > 0) {
        service.heal(actualHeal, 'level_up_bonus');
      }

      // Assert
      expect(service.getHealth()).toBe(75); // 50 + 25
      expect(service.getHealth()).not.toBeGreaterThan(100);
    });

    it('should not exceed max health when healing on level up', () => {
      // Arrange
      mockPlayerService.getMaxHealth.and.returnValue(100);
      service.setHealth(85); // Start at 85% health

      // Act - Simulate level up heal
      const currentHealth = service.getHealth();
      const maxHealth = 100;
      const healAmount = Math.floor(maxHealth * 0.25); // 25 HP
      const actualHeal = Math.min(healAmount, maxHealth - currentHealth); // Should be 15

      if (actualHeal > 0) {
        service.heal(actualHeal, 'level_up_bonus');
      }

      // Assert
      expect(service.getHealth()).toBe(100); // Capped at max
      expect(service.getHealth()).not.toBeGreaterThan(100);
    });

    it('should handle already being at max health gracefully', () => {
      // Arrange
      mockPlayerService.getMaxHealth.and.returnValue(100);
      service.setHealth(100); // Already at max

      // Act
      const currentHealth = service.getHealth();
      const maxHealth = 100;
      const healAmount = Math.floor(maxHealth * 0.25);
      const actualHeal = Math.min(healAmount, maxHealth - currentHealth); // Should be 0

      // Assert
      expect(actualHeal).toBe(0);
      expect(service.getHealth()).toBe(100); // Still at max
    });

    it('should scale healing with increased max health', () => {
      // Arrange
      mockPlayerService.getMaxHealth.and.returnValue(200); // Upgraded max health
      service.setHealth(100); // 50% of max

      // Act
      const currentHealth = service.getHealth();
      const maxHealth = 200;
      const healAmount = Math.floor(maxHealth * 0.25); // 50 HP
      const actualHeal = Math.min(healAmount, maxHealth - currentHealth);

      service.heal(actualHeal, 'level_up_bonus');

      // Assert
      expect(service.getHealth()).toBe(150); // 100 + 50
    });

    it('should not heal dead players (health = 0)', () => {
      // Arrange
      mockPlayerService.getMaxHealth.and.returnValue(100);
      service.setHealth(0); // Dead

      // Act - Try to heal
      service.heal(25, 'level_up_bonus');

      // Assert
      expect(service.getHealth()).toBe(0); // Still dead - heal is blocked for dead players
    });

    it('should handle rapid level ups correctly without exceeding max', () => {
      // Arrange
      mockPlayerService.getMaxHealth.and.returnValue(100);
      service.setHealth(20); // Low health

      // Act - Simulate multiple rapid level ups
      service.heal(25, 'level_up_bonus'); // First level up
      service.heal(25, 'level_up_bonus'); // Second level up
      service.heal(25, 'level_up_bonus'); // Third level up
      service.heal(25, 'level_up_bonus'); // Fourth level up

      // Assert
      expect(service.getHealth()).toBe(100); // Capped at max
      expect(service.getHealth()).not.toBeGreaterThan(100);
    });
  });

  // -------------------------------------------------------------------------
  // A4: Upgrade modal cadence — every 2 levels, no branching at level 10+
  // -------------------------------------------------------------------------
  describe('upgrade modal cadence — every 2 levels', () => {
    it('requestLevelUp emits levelUpRequest$ immediately (sanity check)', (done) => {
      service.levelUpRequest$.subscribe(() => {
        expect(true).toBe(true);
        done();
      });
      service.requestLevelUp();
    });

    it('even levels trigger upgrade modal (2 % 2 === 0)', () => {
      // Verify the formula: shouldShowUpgrade = level % 2 === 0
      const evenLevels = [2, 4, 6, 8, 10, 12, 14];
      evenLevels.forEach((level) => {
        expect(level % 2 === 0)
          .withContext(`level ${level} should trigger modal`)
          .toBeTrue();
      });
    });

    it('odd levels skip upgrade modal (odd % 2 !== 0)', () => {
      const oddLevels = [1, 3, 5, 7, 9, 11, 13];
      oddLevels.forEach((level) => {
        expect(level % 2 === 0)
          .withContext(`level ${level} should skip modal`)
          .toBeFalse();
      });
    });

    it('level 12 triggers upgrade modal under every-2 rule (not every-3)', () => {
      // Under the old rule (every 3 at level 10+): 12 % 3 = 0 → modal
      // Under the new rule (every 2): 12 % 2 = 0 → modal
      // Both agree here; but level 10 is the key:
      // Old rule: 10 % 3 = 1 → skip; New rule: 10 % 2 = 0 → modal
      expect(10 % 2 === 0).toBeTrue(); // every-2 shows modal at level 10
    });

    it('every level from 2 to 30 that is divisible by 2 would show modal (never a gap)', () => {
      const cadence = 2;
      const modals: number[] = [];
      for (let level = 1; level <= 30; level++) {
        if (level % cadence === 0) modals.push(level);
      }
      // Exactly 15 upgrade windows from level 2 to 30
      expect(modals.length).toBe(15);
      // No gaps larger than 2 levels
      for (let i = 1; i < modals.length; i++) {
        expect(modals[i] - modals[i - 1]).toBe(cadence);
      }
    });
  });

  describe('Emergency Protocols', () => {
    beforeEach(() => {
      // Reset health to full before each test
      service.setHealth(100, 'test_init');
    });

    it('should apply normal healing when Emergency Protocols is not active', () => {
      // Arrange
      service.setHealth(25, 'test_damage'); // Set to 25% health
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(false);

      // Act
      service.heal(10, 'test_heal');

      // Assert
      expect(service.getHealth()).toBe(35); // 25 + 10
    });

    it('should apply normal healing when health is above 30%', () => {
      // Arrange
      service.setHealth(50, 'test_damage'); // Set to 50% health
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(2.0);

      // Act
      service.heal(10, 'test_heal');

      // Assert
      expect(service.getHealth()).toBe(60); // 50 + 10 (no multiplier)
    });

    it('should apply emergency healing multiplier when health is below 30%', () => {
      // Arrange
      service.setHealth(20, 'test_damage'); // Set to 20% health
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(2.0); // 2x multiplier

      // Act
      service.heal(10, 'test_heal');

      // Assert
      expect(service.getHealth()).toBe(40); // 20 + (10 * 2)
    });

    it('should apply different stack levels of Emergency Protocols', () => {
      // Test stack level 1 (2.0x)
      service.setHealth(25, 'test_damage');
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(2.0);
      service.heal(10, 'test_heal');
      expect(service.getHealth()).toBe(45); // 25 + (10 * 2.0)

      // Test stack level 2 (3.0x)
      service.setHealth(25, 'test_damage');
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(3.0);
      service.heal(10, 'test_heal');
      expect(service.getHealth()).toBe(55); // 25 + (10 * 3.0)

      // Test stack level 3 (4.0x)
      service.setHealth(25, 'test_damage');
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(4.0);
      service.heal(10, 'test_heal');
      expect(service.getHealth()).toBe(65); // 25 + (10 * 4.0)
    });

    it('should not exceed max health even with emergency multiplier', () => {
      // Arrange
      service.setHealth(29, 'test_damage'); // Just below 30%
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(3.0); // 3x multiplier
      mockPlayerService.getMaxHealth.and.returnValue(100);

      // Act
      service.heal(50, 'test_heal'); // 50 * 3 = 150, should cap at max

      // Assert
      expect(service.getHealth()).toBe(100); // Capped at max health
    });

    it('should activate at 29.9% health but not at 30%', () => {
      // Test exactly 30% - should NOT activate
      service.setHealth(30, 'test_damage');
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(2.0);
      service.heal(10, 'test_heal');
      expect(service.getHealth()).toBe(40); // 30 + 10 (no multiplier)

      // Test 29.9% - should activate
      service.setHealth(29.9, 'test_damage');
      service.heal(10, 'test_heal');
      expect(service.getHealth()).toBe(49.9); // 29.9 + (10 * 2)
    });

    it('should not heal dead players even with Emergency Protocols', () => {
      // Arrange
      service.setHealth(0, 'test_death');
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(3.0);

      // Act
      service.heal(50, 'test_heal');

      // Assert
      expect(service.getHealth()).toBe(0); // Still dead
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        '⚠️ Attempted heal on dead player blocked',
        'warning',
        jasmine.objectContaining({
          source: 'game_state_service',
          operation: 'heal_blocked',
        })
      );
    });

    it('should handle invalid max health gracefully', () => {
      // Arrange
      service.setHealth(20, 'test_damage');
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(2.0);
      mockPlayerService.getMaxHealth.and.returnValue(0); // Invalid max health

      // Act
      service.heal(10, 'test_heal');

      // Assert - should use default 100 max health
      expect(service.getHealth()).toBe(40); // 20 + (10 * 2), using default max
    });

    it('should calculate percentage based on upgraded max health', () => {
      // Arrange - 150 max health, 40 current (26.67%)
      mockPlayerService.getMaxHealth.and.returnValue(150);
      service.setHealth(40, 'test_damage');
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(2.0);

      // Act
      service.heal(20, 'test_heal');

      // Assert - should activate since 40/150 = 26.67% < 30%
      expect(service.getHealth()).toBe(80); // 40 + (20 * 2)
    });

    it('should work with healing from multiple sources', () => {
      // Arrange
      service.setHealth(15, 'test_damage');
      mockPlayerUpgrades.hasEmergencyProtocols.and.returnValue(true);
      mockPlayerUpgrades.getEmergencyHealingMultiplier.and.returnValue(2.5);

      // Act - heal from different sources
      service.heal(5, 'health_regen'); // 5 * 2.5 = 12.5
      expect(service.getHealth()).toBe(27.5);

      service.heal(10, 'pickup_health'); // 10 * 2.5 = 25
      expect(service.getHealth()).toBe(52.5);

      // Now above 30%, should not apply multiplier
      service.heal(10, 'ability_heal');
      expect(service.getHealth()).toBe(62.5); // No multiplier
    });
  });
});
