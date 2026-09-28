import { TestBed } from '@angular/core/testing';
import { UpgradeService } from './upgrade.service';
import { GameEngineService } from '../core/engine/game-engine.service';
import { PlayerService } from '../core/player/player.service';
import { UpgradeOption } from '../core/models/upgrade.model';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { VisualFeedbackCoordinatorService } from '../core/services/visual-feedback-coordinator.service';
import { CameraShakeService } from '../core/effects/camera-shake.service';
import { PostProcessingService } from '../core/effects/post-processing.service';
import { CurseService } from './curse.service';

// Type for accessing UpgradeService internals in tests
interface UpgradeServiceInternal {
  upgradeOptions: UpgradeOption[];
}

describe('UpgradeService', () => {
  let service: UpgradeService;
  let mockGameEngine: jasmine.SpyObj<GameEngineService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let mockVisualFeedback: jasmine.SpyObj<VisualFeedbackCoordinatorService>;
  let mockCameraShake: jasmine.SpyObj<CameraShakeService>;
  let mockPostProcessing: jasmine.SpyObj<PostProcessingService>;
  let curseService: CurseService;

  beforeEach(() => {
    // Create comprehensive mocks
    mockPlayerService = jasmine.createSpyObj('PlayerService', [
      'increaseMaxHealth',
      'heal',
      'takeDamage',
      'getMaxHealth',
      'increaseMovementSpeed',
      'increaseBeamDamage',
      'increaseBeamRotationSpeed',
      'increaseTargetingHoldDuration',
      'increaseBeamSpeed',
      'increaseEffectChance',
      'increaseDashEfficiency',
      'increaseDischargeRadius',
      'increaseBeamWidth',
      'getCriticalHitChance',
      'getCriticalHitMultiplier',
      'setCriticalHitChance',
      'setCriticalHitMultiplier',
      'getShardMultiplier',
      'setShardMultiplier',
      'getHealthRegenRate',
      'setHealthRegenRate',
      'setHealthRegeneration',
      'getHasDoubleBeam',
      'setHasDoubleBeam',
      'isParryAvailable',
      'setVelocityMatrix',
      'setEmergencyProtocols',
      'setBerserkerProtocol',
    ]);

    mockPlayerService.getMaxHealth.and.returnValue(100);
    mockPlayerService.getCriticalHitChance.and.returnValue(0);
    mockPlayerService.getCriticalHitMultiplier.and.returnValue(1.5);
    mockPlayerService.getShardMultiplier.and.returnValue(1);
    mockPlayerService.getHealthRegenRate.and.returnValue(0);
    mockPlayerService.getHasDoubleBeam.and.returnValue(false);
    mockPlayerService.isParryAvailable.and.returnValue(false);

    // Create mock for DebugLogBridgeService
    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // Create mock for VisualFeedbackCoordinatorService
    mockVisualFeedback = jasmine.createSpyObj('VisualFeedbackCoordinatorService', ['showUpgrade']);

    // Create mock for CameraShakeService
    mockCameraShake = jasmine.createSpyObj('CameraShakeService', ['addShake']);

    // Create mock for PostProcessingService
    mockPostProcessing = jasmine.createSpyObj('PostProcessingService', ['addChromaticAberration']);

    // Create mock game engine with all required methods
    mockGameEngine = jasmine.createSpyObj('GameEngineService', [
      'enhanceShardMagnetism',
      'increaseMovementSpeed',
      'heal',
      'increaseBeamDamage',
      'increaseBeamRotationSpeed',
      'increaseTargetingHoldDuration',
      'increaseBeamSpeed',
      'increaseEffectChance',
      'increaseDashEfficiency',
      'increaseMaxHealth',
      'unlockDoubleBeam',
      'addBurnChance',
      'addRecoilDamage',
      'clampCurrentHealth',
      'unlockDischarge',
      'increaseBurnDamage',
      'unlockVoidBeam',
      'applyVulnerabilityCurse',
      'increaseFireRate',
      'unlockShieldBreaker',
      'takeDamage',
      'emitState',
      'getPlayerEntity',
      'getPlayerHealth',
      'getPlayerMaxHealth',
      'getPlayerService',
      'enableBurnSpread',
      'setBurnSpreadChance',
      'captureUpgradeTransaction',
      'restoreUpgradeTransaction',
      'selectBeamCore',
      'evolveBeamCore',
      'chooseRunRoute',
      'applyRunPressure',
      'increaseExperienceGain',
    ]);

    mockGameEngine.captureUpgradeTransaction.and.returnValue(
      {} as ReturnType<GameEngineService['captureUpgradeTransaction']>
    );

    // Set up player property on mock game engine
    Object.defineProperty(mockGameEngine, 'player', {
      value: mockPlayerService,
      writable: true,
    });

    // Set up mock return values for methods
    mockGameEngine.getPlayerEntity.and.returnValue(1);
    mockGameEngine.getPlayerHealth.and.returnValue(100);
    mockGameEngine.getPlayerMaxHealth.and.returnValue(100);
    mockGameEngine.getPlayerService.and.returnValue(mockPlayerService);

    TestBed.configureTestingModule({
      providers: [
        UpgradeService,
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: VisualFeedbackCoordinatorService, useValue: mockVisualFeedback },
        { provide: CameraShakeService, useValue: mockCameraShake },
        { provide: PostProcessingService, useValue: mockPostProcessing },
      ],
    });

    service = TestBed.inject(UpgradeService);
    curseService = TestBed.inject(CurseService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  getCurrentUpgrades / getCount / incCount / canStack / reset           */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('getCurrentUpgrades', () => {
    it('should return empty object initially', () => {
      const upgrades = service.getCurrentUpgrades();
      expect(Object.keys(upgrades).length).toBe(0);
    });

    it('should return a copy (not a reference) of the internal state', () => {
      service.incCount('core_speed');
      const upgrades = service.getCurrentUpgrades();
      upgrades['core_speed'] = 999; // mutate the copy
      expect(service.getCount('core_speed')).toBe(1); // original unchanged
    });
  });

  describe('incCount', () => {
    it('should increment and return the new value', () => {
      expect(service.incCount('core_speed')).toBe(1);
      expect(service.incCount('core_speed')).toBe(2);
      expect(service.incCount('core_speed')).toBe(3);
    });

    it('should respect max stacks when used via apply()', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'beam_rotation')!;
      // beam_rotation has max 5 stacks
      for (let i = 0; i < 5; i++) {
        service.apply(upgrade, mockGameEngine);
      }
      expect(service.getCount('beam_rotation')).toBe(5);

      // 6th apply should be blocked by canStack check in apply()
      service.apply(upgrade, mockGameEngine);
      expect(service.getCount('beam_rotation')).toBe(5);
    });
  });

  describe('canStack', () => {
    it('should return true when under max stacks', () => {
      expect(service.canStack('core_speed')).toBe(true);
      service.incCount('core_speed');
      expect(service.canStack('core_speed')).toBe(true); // 1 < 10
    });

    it('should return false at max stacks', () => {
      // beam_rotation has max 5 stacks
      for (let i = 0; i < 5; i++) {
        service.incCount('beam_rotation');
      }
      expect(service.canStack('beam_rotation')).toBe(false);
    });

    it('should cap additive chance upgrades before later picks become dead', () => {
      for (let i = 0; i < 5; i++) {
        service.incCount('burn_chance');
      }
      expect(service.canStack('burn_chance')).toBe(false);
    });
  });

  describe('getCount', () => {
    it('should return 0 for unknown upgrade IDs', () => {
      expect(service.getCount('non_existent_upgrade')).toBe(0);
    });

    it('should return correct value after increments', () => {
      service.incCount('core_power');
      service.incCount('core_power');
      expect(service.getCount('core_power')).toBe(2);
      expect(service.getCount('core_speed')).toBe(0);
    });
  });

  describe('resetCounts / resetAllUpgrades', () => {
    it('resetCounts should clear all upgrade counts', () => {
      service.incCount('core_speed');
      service.incCount('core_power');
      service.incCount('beam_damage');

      service.resetCounts();

      expect(service.getCount('core_speed')).toBe(0);
      expect(service.getCount('core_power')).toBe(0);
      expect(service.getCount('beam_damage')).toBe(0);
      expect(Object.keys(service.getCurrentUpgrades()).length).toBe(0);
    });

    it('resetAllUpgrades should clear all upgrade counts', () => {
      service.incCount('core_speed');
      service.incCount('burn_chance');

      service.resetAllUpgrades();

      expect(service.getCount('core_speed')).toBe(0);
      expect(service.getCount('burn_chance')).toBe(0);
      expect(Object.keys(service.getCurrentUpgrades()).length).toBe(0);
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  draw() basics                                                         */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('draw', () => {
    it('should return the requested number of options (or fewer if pool is small)', () => {
      const drawn = service.draw(3, false);
      expect(drawn.length).toBeLessThanOrEqual(3);
      expect(drawn.length).toBeGreaterThan(0);
    });

    it('should return no duplicates', () => {
      const drawn = service.draw(3, true);
      const ids = drawn.map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should open every run with the three distinct beam cores', () => {
      const drawn = service.draw(3, false);

      expect(drawn.length).toBe(3);
      expect(drawn.every((card) => card.category === 'beam-core')).toBeTrue();
      expect(new Set(drawn.map((card) => card.id)).size).toBe(3);
      expect(drawn.map((card) => card.id)).toContain('beam_core_lance');
      expect(drawn.map((card) => card.id)).toContain('beam_core_prism');
      expect(drawn.map((card) => card.id)).toContain('beam_core_arc');
    });

    it('should guarantee a reachable evolution after committing to a build path', () => {
      service.incCount('beam_core_lance');
      service.incCount('core_speed');

      const drawn = service.draw(3, false);

      expect(
        drawn.some((card) => card.category === 'mutation' || card.prerequisites?.some((id) => service.getCount(id) > 0))
      ).toBeTrue();
    });

    it('should surface only mutations compatible with the bound core', () => {
      service.incCount('beam_core_prism');

      const mutationIds = service.selectable.filter((card) => card.category === 'mutation').map((card) => card.id);

      expect(mutationIds).toContain('prism_thermal_bloom');
      expect(mutationIds).toContain('prism_convergence');
      expect(mutationIds).not.toContain('lance_needlepoint');
      expect(mutationIds).not.toContain('arc_relay_web');
    });

    it('should make first-stage core evolutions mutually exclusive', () => {
      service.incCount('beam_core_lance');
      service.incCount('lance_needlepoint');

      expect(service.selectable.some((card) => card.id === 'lance_hunters_pivot')).toBeFalse();
    });

    it('should reject a stale selection that conflicts with an owned branch card', () => {
      const lance = service.upgradeOptions.find((card) => card.id === 'beam_core_lance')!;
      const prism = service.upgradeOptions.find((card) => card.id === 'beam_core_prism')!;

      expect(service.apply(lance, mockGameEngine)).toBeTrue();
      expect(service.apply(prism, mockGameEngine)).toBeFalse();
      expect(service.getCount('beam_core_lance')).toBe(1);
      expect(service.getCount('beam_core_prism')).toBe(0);
      expect(mockGameEngine.selectBeamCore).toHaveBeenCalledTimes(1);
    });

    it('should reject direct application when a card prerequisite is missing', () => {
      const sunpiercer = service.upgradeOptions.find((card) => card.id === 'lance_sunpiercer')!;

      expect(service.apply(sunpiercer, mockGameEngine)).toBeFalse();
      expect(service.getCount('lance_sunpiercer')).toBe(0);
      expect(mockGameEngine.evolveBeamCore).not.toHaveBeenCalled();
    });

    it('should commit Storm Anchor after Arc and record the selected branch atomically', () => {
      const arc = service.upgradeOptions.find((card) => card.id === 'beam_core_arc')!;
      const stormAnchor = service.upgradeOptions.find((card) => card.id === 'arc_storm_anchor')!;

      expect(service.apply(arc, mockGameEngine)).toBeTrue();
      expect(service.apply(stormAnchor, mockGameEngine)).toBeTrue();

      expect(mockGameEngine.selectBeamCore).toHaveBeenCalledOnceWith('arc');
      expect(mockGameEngine.evolveBeamCore).toHaveBeenCalledOnceWith('arc_storm_anchor');
      expect(service.getCount('beam_core_arc')).toBe(1);
      expect(service.getCount('arc_storm_anchor')).toBe(1);
      expect(service.selectable.some((card) => card.id === 'arc_relay_web')).toBeFalse();
    });

    it('should unlock tagged apex evolutions through any matching support upgrade', () => {
      service.incCount('beam_core_lance');
      service.incCount('lance_needlepoint');
      expect(service.selectable.some((card) => card.id === 'lance_sunpiercer')).toBeFalse();

      service.incCount('burn_chance');

      expect(service.getActiveBuildTags().has('thermal')).toBeTrue();
      expect(service.selectable.some((card) => card.id === 'lance_sunpiercer')).toBeTrue();
    });

    it('should respect prerequisites — rare/epic upgrades excluded without prereqs', () => {
      service.resetCounts();

      // Draw many times and collect all drawn IDs
      const allDrawnIds = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const drawn = service.draw(3, false);
        drawn.forEach((u) => allDrawnIds.add(u.id));
      }

      // These require prerequisites that are NOT met
      expect(allDrawnIds.has('velocity_matrix')).toBe(false); // needs kinetic_amplifier
      expect(allDrawnIds.has('surgical_precision')).toBe(false); // needs beam_rotation
      expect(allDrawnIds.has('berserker_protocol')).toBe(false); // needs glass_cannon
      expect(allDrawnIds.has('burn_damage')).toBe(false); // needs burn_chance
      expect(allDrawnIds.has('burn_spread')).toBe(false); // needs burn_damage
    });

    it('should exclude maxed upgrades from the draw pool', () => {
      // Max out beam_rotation (max 5 stacks)
      for (let i = 0; i < 5; i++) {
        service.incCount('beam_rotation');
      }

      // Also give prereq so beam_rotation would normally be eligible
      service.incCount('beam_damage');

      // Draw many times and verify beam_rotation never appears
      for (let i = 0; i < 100; i++) {
        const drawn = service.draw(3, false);
        const ids = drawn.map((u) => u.id);
        expect(ids).not.toContain('beam_rotation');
      }
    });

    it('should return 0 options from an empty pool', () => {
      const originalOptions = service.upgradeOptions;
      const serviceInternal = service as unknown as UpgradeServiceInternal;
      serviceInternal.upgradeOptions = [];

      const drawn = service.draw(5, true);
      expect(drawn.length).toBe(0);

      serviceInternal.upgradeOptions = originalOptions;
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Build Path Integration Tests                                          */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Build Path: Speed (core_speed -> kinetic_amplifier -> velocity_matrix)', () => {
    it('should verify the prerequisite chain exists in the upgrade pool', () => {
      const coreSpeed = service.upgradeOptions.find((u) => u.id === 'core_speed')!;
      const kineticAmp = service.upgradeOptions.find((u) => u.id === 'kinetic_amplifier')!;
      const velMatrix = service.upgradeOptions.find((u) => u.id === 'velocity_matrix')!;

      expect(coreSpeed).toBeDefined();
      expect(kineticAmp).toBeDefined();
      expect(velMatrix).toBeDefined();

      // core_speed has no prerequisites
      expect(coreSpeed.prerequisites).toBeUndefined();
      // kinetic_amplifier requires core_speed
      expect(kineticAmp.prerequisites).toEqual(['core_speed']);
      // velocity_matrix requires kinetic_amplifier
      expect(velMatrix.prerequisites).toEqual(['kinetic_amplifier']);
    });

    it('should unlock kinetic_amplifier after taking core_speed', () => {
      service.resetCounts();

      // Before: kinetic_amplifier should not appear
      const selectableBefore = service.selectable.map((u) => u.id);
      expect(selectableBefore).not.toContain('kinetic_amplifier');

      // Take core_speed
      service.incCount('core_speed');

      // After: kinetic_amplifier should be selectable
      const selectableAfter = service.selectable.map((u) => u.id);
      expect(selectableAfter).toContain('kinetic_amplifier');
    });

    it('should unlock velocity_matrix only after taking kinetic_amplifier', () => {
      service.resetCounts();
      service.incCount('core_speed');

      // kinetic_amplifier taken but not yet — velocity_matrix locked
      let selectable = service.selectable.map((u) => u.id);
      expect(selectable).not.toContain('velocity_matrix');

      service.incCount('kinetic_amplifier');
      selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('velocity_matrix');
    });

    it('should apply the full speed path end-to-end', () => {
      const coreSpeed = service.upgradeOptions.find((u) => u.id === 'core_speed')!;
      const kineticAmp = service.upgradeOptions.find((u) => u.id === 'kinetic_amplifier')!;
      const velMatrix = service.upgradeOptions.find((u) => u.id === 'velocity_matrix')!;

      service.apply(coreSpeed, mockGameEngine);
      expect(mockGameEngine.increaseMovementSpeed).toHaveBeenCalledWith(0.15);

      service.apply(kineticAmp, mockGameEngine);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.08);

      service.apply(velMatrix, mockGameEngine);
      // velocity_matrix applies +5% base speed and +5% base damage
      expect(mockGameEngine.increaseMovementSpeed).toHaveBeenCalledWith(0.05);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.05);
      expect(mockPlayerService.setVelocityMatrix).toHaveBeenCalled();
    });
  });

  describe('Build Path: Beam (beam_damage -> beam_rotation -> surgical_precision -> double_beam/void_beam)', () => {
    it('should verify the prerequisite chain', () => {
      const beamDmg = service.upgradeOptions.find((u) => u.id === 'beam_damage')!;
      const beamRot = service.upgradeOptions.find((u) => u.id === 'beam_rotation')!;
      const surgical = service.upgradeOptions.find((u) => u.id === 'surgical_precision')!;
      const dblBeam = service.upgradeOptions.find((u) => u.id === 'double_beam')!;
      const voidBeam = service.upgradeOptions.find((u) => u.id === 'void_beam')!;

      // beam_damage has no prerequisites
      expect(beamDmg.prerequisites).toBeUndefined();
      expect(beamRot.prerequisites).toEqual(['beam_damage']);
      expect(surgical.prerequisites).toEqual(['beam_rotation']);
      expect(dblBeam.prerequisites).toEqual(['beam_damage']);
      // void_beam requires beam_damage OR burn_chance
      expect(voidBeam.prerequisites).toEqual(['beam_damage', 'burn_chance']);
    });

    it('should unlock beam_rotation and double_beam after beam_damage', () => {
      service.resetCounts();
      service.incCount('beam_damage');

      const selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('beam_rotation');
      expect(selectable).toContain('double_beam');
      expect(selectable).toContain('glass_cannon');
      expect(selectable).toContain('burn_chance');
    });

    it('should unlock surgical_precision after beam_rotation', () => {
      service.resetCounts();
      service.incCount('beam_damage');
      service.incCount('beam_rotation');

      const selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('surgical_precision');
    });

    it('void_beam should be unlockable via beam_damage alone (OR logic)', () => {
      service.resetCounts();
      service.incCount('beam_damage');

      const selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('void_beam');
    });

    it('void_beam should be unlockable via burn_chance alone (OR logic)', () => {
      service.resetCounts();
      // burn_chance requires beam_damage, so we must provide it
      service.incCount('beam_damage');
      service.incCount('burn_chance');

      const selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('void_beam');
    });

    it('should apply the full beam path end-to-end', () => {
      const beamDmg = service.upgradeOptions.find((u) => u.id === 'beam_damage')!;
      const beamRot = service.upgradeOptions.find((u) => u.id === 'beam_rotation')!;
      const surgical = service.upgradeOptions.find((u) => u.id === 'surgical_precision')!;

      service.apply(beamDmg, mockGameEngine);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.5); // first upgrade 50%

      service.apply(beamRot, mockGameEngine);
      expect(mockGameEngine.increaseBeamRotationSpeed).toHaveBeenCalledWith(0.38); // first upgrade 38%

      service.apply(surgical, mockGameEngine);
      expect(mockPlayerService.setCriticalHitChance).toHaveBeenCalledWith(0.15);
      expect(mockPlayerService.setCriticalHitMultiplier).toHaveBeenCalledWith(1.75);
    });
  });

  describe('Build Path: Burn (beam_damage -> burn_chance -> burn_damage -> burn_spread)', () => {
    it('should verify the prerequisite chain', () => {
      const burnChance = service.upgradeOptions.find((u) => u.id === 'burn_chance')!;
      const burnDmg = service.upgradeOptions.find((u) => u.id === 'burn_damage')!;
      const burnSpread = service.upgradeOptions.find((u) => u.id === 'burn_spread')!;

      expect(burnChance.prerequisites).toEqual(['beam_damage']);
      expect(burnDmg.prerequisites).toEqual(['burn_chance']);
      expect(burnSpread.prerequisites).toEqual(['burn_damage']);
    });

    it('should progressively unlock burn upgrades', () => {
      service.resetCounts();

      // burn_chance needs beam_damage
      let selectable = service.selectable.map((u) => u.id);
      expect(selectable).not.toContain('burn_chance');

      service.incCount('beam_damage');
      selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('burn_chance');
      expect(selectable).not.toContain('burn_damage');

      service.incCount('burn_chance');
      selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('burn_damage');
      expect(selectable).not.toContain('burn_spread');

      service.incCount('burn_damage');
      selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('burn_spread');
    });

    it('should apply the full burn path end-to-end', () => {
      const beamDmg = service.upgradeOptions.find((u) => u.id === 'beam_damage')!;
      const burnChance = service.upgradeOptions.find((u) => u.id === 'burn_chance')!;
      const burnDmg = service.upgradeOptions.find((u) => u.id === 'burn_damage')!;
      const burnSpread = service.upgradeOptions.find((u) => u.id === 'burn_spread')!;

      service.apply(beamDmg, mockGameEngine);
      service.apply(burnChance, mockGameEngine);
      expect(mockGameEngine.addBurnChance).toHaveBeenCalledWith(0.3); // 30%

      service.apply(burnDmg, mockGameEngine);
      expect(mockGameEngine.increaseBurnDamage).toHaveBeenCalledWith(1.0); // first upgrade 100%

      service.apply(burnSpread, mockGameEngine);
      expect(mockGameEngine.enableBurnSpread).toHaveBeenCalled();
    });
  });

  describe('Build Path: Glass Cannon (beam_damage -> glass_cannon -> berserker_protocol)', () => {
    it('should verify the prerequisite chain', () => {
      const glassCannon = service.upgradeOptions.find((u) => u.id === 'glass_cannon')!;
      const berserker = service.upgradeOptions.find((u) => u.id === 'berserker_protocol')!;

      expect(glassCannon.prerequisites).toEqual(['beam_damage']);
      expect(berserker.prerequisites).toEqual(['glass_cannon']);
    });

    it('should progressively unlock glass cannon path', () => {
      service.resetCounts();

      let selectable = service.selectable.map((u) => u.id);
      expect(selectable).not.toContain('glass_cannon');
      expect(selectable).not.toContain('berserker_protocol');

      service.incCount('beam_damage');
      selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('glass_cannon');
      expect(selectable).not.toContain('berserker_protocol');

      service.incCount('glass_cannon');
      selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('berserker_protocol');
    });

    it('should apply the full glass cannon path end-to-end', () => {
      const beamDmg = service.upgradeOptions.find((u) => u.id === 'beam_damage')!;
      const glassCannon = service.upgradeOptions.find((u) => u.id === 'glass_cannon')!;
      const berserker = service.upgradeOptions.find((u) => u.id === 'berserker_protocol')!;

      service.apply(beamDmg, mockGameEngine);
      service.apply(glassCannon, mockGameEngine);

      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.3); // 30%
      expect(mockPlayerService.increaseMaxHealth).toHaveBeenCalledWith(-30); // -30% of 100
      expect(mockGameEngine.clampCurrentHealth).toHaveBeenCalled();

      service.apply(berserker, mockGameEngine);
      expect(mockPlayerService.setBerserkerProtocol).toHaveBeenCalledWith(true, 1.0);
    });
  });

  describe('Build Path: Discharge (standalone)', () => {
    it('should have no prerequisites', () => {
      const discharge = service.upgradeOptions.find((u) => u.id === 'discharge')!;
      expect(discharge.prerequisites).toBeUndefined();
    });

    it('should always be selectable (when not maxed)', () => {
      service.resetCounts();
      const selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('discharge');
    });

    it('should apply discharge end-to-end', () => {
      const discharge = service.upgradeOptions.find((u) => u.id === 'discharge')!;
      service.apply(discharge, mockGameEngine);
      expect(mockGameEngine.unlockDischarge).toHaveBeenCalled();
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Prerequisite Logic Verification                                       */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Prerequisite Logic', () => {
    it('should use OR logic (any prerequisite owned is sufficient)', () => {
      // void_beam has prerequisites: ['beam_damage', 'burn_chance']
      service.resetCounts();

      // Neither prereq met
      let selectable = service.selectable.map((u) => u.id);
      expect(selectable).not.toContain('void_beam');

      // Only beam_damage met (OR => should be selectable)
      service.incCount('beam_damage');
      selectable = service.selectable.map((u) => u.id);
      expect(selectable).toContain('void_beam');
    });

    it('should verify all prerequisite IDs reference existing upgrades', () => {
      const allIds = new Set(service.upgradeOptions.map((u) => u.id));

      service.upgradeOptions.forEach((upgrade) => {
        if (upgrade.prerequisites) {
          upgrade.prerequisites.forEach((prereqId) => {
            expect(allIds.has(prereqId))
              .withContext(`Upgrade "${upgrade.id}" references non-existent prerequisite "${prereqId}"`)
              .toBe(true);
          });
        }
      });
    });

    it('should filter selectable to only upgrades (not curses)', () => {
      const selectable = service.selectable;
      selectable.forEach((u) => {
        expect(u.type).toBe('upgrade');
      });
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Upgrade Application Details                                           */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Upgrade Application', () => {
    it('should apply core speed upgrade', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'core_speed')!;
      service.apply(upgrade, mockGameEngine);

      expect(mockGameEngine.increaseMovementSpeed).toHaveBeenCalledWith(0.15);
      expect(service.getCount('core_speed')).toBe(1);
    });

    it('should apply core power upgrade with stacking', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'core_power')!;

      service.apply(upgrade, mockGameEngine);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.2);

      service.apply(upgrade, mockGameEngine);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledTimes(2);
      expect(mockGameEngine.increaseBeamDamage.calls.allArgs()).toEqual([[0.2], [0.2]]);

      expect(service.getCount('core_power')).toBe(2);
    });

    it('should apply core_shield upgrade', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'core_shield')!;
      service.apply(upgrade, mockGameEngine);
      expect(mockGameEngine.increaseMaxHealth).toHaveBeenCalledWith(35);
    });

    it('should apply health regeneration upgrade', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'health_regen')!;
      mockGameEngine.getPlayerHealth.and.returnValue(50);
      mockGameEngine.getPlayerMaxHealth.and.returnValue(100);

      service.apply(upgrade, mockGameEngine);

      expect(mockPlayerService.setHealthRegeneration).toHaveBeenCalledWith(8);
      expect(mockGameEngine.heal).toHaveBeenCalledWith(50, 'nanite_repair_system_bonus');
    });

    it('should apply beam damage with different first/subsequent values', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'beam_damage')!;

      service.apply(upgrade, mockGameEngine);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.5); // first: 50%

      service.apply(upgrade, mockGameEngine);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.38); // subsequent: 38%
    });

    it('should apply void beam with synergy bonus', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'void_beam')!;
      service.apply(upgrade, mockGameEngine);

      expect(mockGameEngine.unlockVoidBeam).toHaveBeenCalled();
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.1);
    });

    it('should unlock double beam system', () => {
      const upgrade = service.upgradeOptions.find((u) => u.id === 'double_beam')!;
      service.apply(upgrade, mockGameEngine);
      expect(mockGameEngine.unlockDoubleBeam).toHaveBeenCalled();
    });
  });

  describe('Curse Application', () => {
    it('should apply vulnerability curse with fire rate increase', () => {
      const curse = service.upgradeOptions.find((u) => u.id === 'vulnerability')!;
      service.apply(curse, mockGameEngine);

      expect(mockGameEngine.applyVulnerabilityCurse).toHaveBeenCalled();
      expect(mockGameEngine.increaseFireRate).toHaveBeenCalledWith(0.3);
      expect(curseService.hasCurse(curse.id)).toBeTrue();
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Upgrade Pool Structure                                                */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Upgrade Pool Structure', () => {
    it('should have all expected upgrade types', () => {
      expect(service.upgradeOptions.length).toBeGreaterThan(20);

      const upgradeTypes = service.upgradeOptions.map((u) => u.type);
      expect(upgradeTypes).toContain('upgrade');
      expect(upgradeTypes).toContain('curse');
    });

    it('should have correct rarity distribution', () => {
      const rarityCount = service.upgradeOptions.reduce(
        (acc, upgrade) => {
          acc[upgrade.rarity] = (acc[upgrade.rarity] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      expect(rarityCount['core']).toBeGreaterThan(0);
      expect(rarityCount['uncommon']).toBeGreaterThan(0);
      expect(rarityCount['rare']).toBeGreaterThan(0);
      expect(rarityCount['epic']).toBeGreaterThan(0);
    });

    it('should have 3 starter cores and 4 repeatable core-tier upgrades', () => {
      const coreUpgrades = service.upgradeOptions.filter((u) => u.rarity === 'core');
      expect(coreUpgrades.filter((u) => u.category === 'beam-core').length).toBe(3);
      expect(coreUpgrades.filter((u) => u.category !== 'beam-core').length).toBe(4);
    });

    it('core upgrades should have icon property', () => {
      const coreUpgrades = service.upgradeOptions.filter((u) => u.rarity === 'core');
      coreUpgrades.forEach((upgrade) => {
        expect(upgrade.icon).toBeDefined();
      });
    });

    it('all upgrade IDs should be unique', () => {
      const ids = service.upgradeOptions.map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Randomization & Shop Integration                                      */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Randomization & Shop', () => {
    it('keeps route commitments, relics, and anomalies out of ordinary level-up draws', () => {
      service.incCount('beam_core_arc');
      for (let i = 0; i < 100; i++) {
        const drawn = service.draw(3, false);
        expect(
          drawn.some((card) => card.category === 'route' || card.category === 'relic' || card.category === 'anomaly')
        ).toBeFalse();
      }
    });

    it('does not mix legacy curses or blessings into a default level-up draw', () => {
      service.incCount('beam_core_arc');

      for (let i = 0; i < 100; i++) {
        expect(service.draw(3).some((card) => card.type === 'curse' || card.type === 'blessing')).toBeFalse();
      }
    });

    it('offers both mutually exclusive route commitments before one is chosen', () => {
      const routes = service.getRunRouteOptions();

      expect(routes.map((route) => route.id)).toContain('route_azure_bastion');
      expect(routes.map((route) => route.id)).toContain('route_verdant_rift');

      service.incCount('route_azure_bastion');
      expect(service.getRunRouteOptions()).toEqual([]);
    });

    it('draws unique one-pick relics and guarantees one matching the current build', () => {
      service.incCount('beam_core_prism');

      const relics = service.drawRelics(3);

      expect(relics.length).toBe(3);
      expect(new Set(relics.map((relic) => relic.id)).size).toBe(3);
      expect(relics.every((relic) => relic.category === 'relic')).toBeTrue();
      expect(relics.some((relic) => relic.buildTags?.some((tag) => tag === 'beam' || tag === 'thermal'))).toBeTrue();

      service.incCount(relics[0].id);
      expect(service.drawRelics(9).some((relic) => relic.id === relics[0].id)).toBeFalse();
    });

    it('draws authored anomalies as unique one-pick sector contracts', () => {
      const anomalies = service.drawAnomalies(3);

      expect(anomalies.length).toBe(3);
      expect(new Set(anomalies.map((anomaly) => anomaly.id)).size).toBe(3);
      expect(anomalies.every((anomaly) => anomaly.category === 'anomaly')).toBeTrue();
      expect(anomalies.every((anomaly) => !!anomaly.signature && !!anomaly.tradeoff)).toBeTrue();

      service.incCount(anomalies[0].id);
      expect(service.getOwnedAnomalyCount()).toBe(1);
      expect(service.drawAnomalies(6).some((anomaly) => anomaly.id === anomalies[0].id)).toBeFalse();
    });

    it('commits both player power and world pressure when an anomaly is applied', () => {
      const anomaly = service.upgradeOptions.find((card) => card.id === 'anomaly_glass_orbit')!;

      expect(service.apply(anomaly, mockGameEngine)).toBeTrue();
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.4);
      expect(mockGameEngine.applyRunPressure).toHaveBeenCalledWith({ enemyDamage: 1.35 }, 'anomaly_glass_orbit');
      expect(service.getOwnedAnomalyCount()).toBe(1);
    });

    it('should weight core/uncommon higher than rare/epic', () => {
      const counts: Record<string, number> = {};
      const iterations = 3000;

      for (let i = 0; i < iterations; i++) {
        const drawn = service.draw(1, false);
        if (drawn.length > 0) {
          const rarity = drawn[0].rarity;
          counts[rarity] = (counts[rarity] || 0) + 1;
        }
      }

      expect((counts['core'] || 0) + (counts['uncommon'] || 0)).toBeGreaterThan(
        (counts['rare'] || 0) + (counts['epic'] || 0)
      );
    });

    it('getRandomUpgrades should exclude curses when withCurses=false', () => {
      const shopUpgrades = service.getRandomUpgrades(3, false);
      expect(shopUpgrades.every((u) => u.type === 'upgrade')).toBe(true);
    });

    it('curses getter should include only curses and blessings', () => {
      const curses = service.curses;
      expect(curses.length).toBeGreaterThan(0);
      expect(curses.every((u) => u.type === 'curse' || u.type === 'blessing')).toBe(true);
      expect(curses.some((c) => c.id === 'vulnerability')).toBe(true);
    });

    it('should handle drawing more upgrades than available', () => {
      const drawn = service.draw(1000, true);
      expect(drawn.length).toBeLessThanOrEqual(service.upgradeOptions.length);
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Save / Load                                                           */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Save / Load', () => {
    it('getUpgradesForSave should return a snapshot of current state', () => {
      service.incCount('core_speed');
      service.incCount('core_speed');
      service.incCount('beam_damage');

      const saved = service.getUpgradesForSave();
      expect(saved['core_speed']).toBe(2);
      expect(saved['beam_damage']).toBe(1);
    });

    it('loadUpgradesFromSave should restore saved state', () => {
      const savedState: Record<string, number> = {
        core_speed: 3,
        beam_damage: 2,
        burn_chance: 1,
      };

      service.loadUpgradesFromSave(savedState);

      expect(service.getCount('core_speed')).toBe(3);
      expect(service.getCount('beam_damage')).toBe(2);
      expect(service.getCount('burn_chance')).toBe(1);
      expect(service.getCount('core_power')).toBe(0);
    });

    it('loadUpgradesFromSave should clear previous state', () => {
      service.incCount('core_power');
      service.incCount('core_power');

      service.loadUpgradesFromSave({ core_speed: 1 });

      expect(service.getCount('core_power')).toBe(0);
      expect(service.getCount('core_speed')).toBe(1);
    });

    it('replays each saved stack as one incremental effect', () => {
      expect(service.reapplySavedUpgradeEffects(mockGameEngine, { core_power: 2 })).toBe(true);
      expect(mockGameEngine.increaseBeamDamage.calls.allArgs()).toEqual([[0.2], [0.2]]);
    });

    it('rebuilds persistent health effects without replaying one-shot healing', () => {
      mockGameEngine.getPlayerHealth.and.returnValue(25);
      mockGameEngine.getPlayerMaxHealth.and.returnValue(200);

      expect(
        service.reapplySavedUpgradeEffects(mockGameEngine, {
          core_shield: 1,
          health_regen: 1,
          emergency_protocols: 1,
          aegis_prime: 1,
          astral_aegis: 1,
          verdant_ward: 1,
        })
      ).toBe(true);

      expect(mockPlayerService.increaseMaxHealth.calls.allArgs()).toEqual([[35], [100], [50], [25]]);
      expect(mockPlayerService.setHealthRegeneration).toHaveBeenCalledWith(8);
      expect(mockPlayerService.setEmergencyProtocols).toHaveBeenCalledWith(true, 2);
      expect(mockGameEngine.increaseMaxHealth).not.toHaveBeenCalled();
      expect(mockGameEngine.heal).not.toHaveBeenCalled();
    });

    it('rolls back the entire checkpoint effect replay when a later stack fails', () => {
      const failingRestore: UpgradeOption = {
        id: 'failing_restore',
        name: 'Failing Restore',
        description: 'Fails on its second restored stack',
        type: 'upgrade',
        rarity: 'common',
        effect: (engine, stack) => {
          engine.increaseBeamDamage(0.1);
          if (stack === 2) throw new Error('restore failed');
        },
      };
      service.upgradeOptions.push(failingRestore);

      expect(service.reapplySavedUpgradeEffects(mockGameEngine, { core_power: 1, failing_restore: 2 })).toBeFalse();
      expect(mockGameEngine.increaseBeamDamage.calls.allArgs()).toEqual([[0.2], [0.1], [0.1]]);
      expect(mockGameEngine.restoreUpgradeTransaction).toHaveBeenCalledWith(
        mockGameEngine.captureUpgradeTransaction.calls.mostRecent().returnValue
      );
    });

    it('rebuilds the curse registry while replaying checkpoint effects', () => {
      expect(service.reapplySavedUpgradeEffects(mockGameEngine, { vulnerability: 1 })).toBeTrue();
      expect(curseService.hasCurse('vulnerability')).toBeTrue();
      expect(curseService.getSeverityCounts().high).toBe(1);
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Edge Cases                                                            */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Edge Cases', () => {
    it('should handle upgrades with no effect gracefully', () => {
      const customUpgrade: UpgradeOption = {
        id: 'test_upgrade',
        name: 'Test',
        description: 'Test upgrade',
        effect: () => {},
        type: 'upgrade',
        rarity: 'common',
      };

      expect(() => service.apply(customUpgrade, mockGameEngine)).not.toThrow();
    });

    it('rolls back partial engine mutations and does not commit a stack or feedback when an effect fails', () => {
      const brokenUpgrade: UpgradeOption = {
        id: 'broken_upgrade',
        name: 'Broken',
        description: 'Throws during application',
        effect: (engine) => {
          engine.increaseBeamDamage(0.5);
          throw new Error('broken effect');
        },
        type: 'upgrade',
        rarity: 'common',
      };

      expect(service.apply(brokenUpgrade, mockGameEngine)).toBe(false);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalledWith(0.5);
      expect(mockGameEngine.restoreUpgradeTransaction).toHaveBeenCalledWith(
        mockGameEngine.captureUpgradeTransaction.calls.mostRecent().returnValue
      );
      expect(service.getCount(brokenUpgrade.id)).toBe(0);
      expect(mockVisualFeedback.showUpgrade).not.toHaveBeenCalled();
    });

    it('keeps committed gameplay state when cosmetic feedback fails', () => {
      const upgrade: UpgradeOption = {
        id: 'feedback_failure',
        name: 'Feedback Failure',
        description: 'Valid gameplay effect',
        effect: (engine) => engine.increaseBeamDamage(0.25),
        type: 'upgrade',
        rarity: 'common',
      };
      mockVisualFeedback.showUpgrade.and.throwError('renderer unavailable');

      expect(service.apply(upgrade, mockGameEngine)).toBe(true);
      expect(service.getCount(upgrade.id)).toBe(1);
      expect(mockGameEngine.restoreUpgradeTransaction).not.toHaveBeenCalled();
    });

    it('caps pure ability unlocks at one meaningful pickup', () => {
      const doubleBeam = service.upgradeOptions.find((u) => u.id === 'double_beam')!;
      const discharge = service.upgradeOptions.find((u) => u.id === 'discharge')!;

      expect(service.apply(doubleBeam, mockGameEngine)).toBe(true);
      expect(service.apply(doubleBeam, mockGameEngine)).toBe(false);
      expect(service.apply(discharge, mockGameEngine)).toBe(true);
      expect(service.apply(discharge, mockGameEngine)).toBe(false);
      expect(mockGameEngine.unlockDoubleBeam).toHaveBeenCalledTimes(1);
      expect(mockGameEngine.unlockDischarge).toHaveBeenCalledTimes(1);
    });

    it('returns an immutable-style summary for end-of-run build review', () => {
      const corePower = service.upgradeOptions.find((u) => u.id === 'core_power')!;
      service.apply(corePower, mockGameEngine);
      service.apply(corePower, mockGameEngine);

      expect(service.getRunBuildSummary()).toEqual([
        jasmine.objectContaining({ id: 'core_power', name: 'Power', type: 'upgrade', rarity: 'core', stacks: 2 }),
      ]);
    });

    it('apply should block when canStack returns false', () => {
      // burn_spread has max 3 stacks
      const burnSpread = service.upgradeOptions.find((u) => u.id === 'burn_spread')!;

      for (let i = 0; i < 3; i++) {
        service.incCount('burn_spread');
      }
      expect(service.canStack('burn_spread')).toBe(false);

      // apply should not increment
      service.apply(burnSpread, mockGameEngine);
      expect(service.getCount('burn_spread')).toBe(3);
      expect(mockGameEngine.enableBurnSpread).not.toHaveBeenCalled();
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Legendary Capstones                                                   */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Legendary tier', () => {
    it('exposes at least one legendary in the pool so the tier is not hollow', () => {
      const legendaries = service.upgradeOptions.filter((u) => u.rarity === 'legendary');
      expect(legendaries.length).toBeGreaterThan(0);
    });

    it('cataclysm_core gates behind berserker_protocol so it requires the glass-cannon chain', () => {
      const cataclysm = service.upgradeOptions.find((u) => u.id === 'cataclysm_core')!;
      expect(cataclysm).toBeDefined();
      expect(cataclysm.rarity).toBe('legendary');
      expect(cataclysm.prerequisites).toEqual(['berserker_protocol']);
    });

    it('cataclysm_core applies HP, beam damage, and fire-rate bonuses when invoked', () => {
      const cataclysm = service.upgradeOptions.find((u) => u.id === 'cataclysm_core')!;
      service.apply(cataclysm, mockGameEngine);

      expect(mockGameEngine.increaseMaxHealth).toHaveBeenCalledWith(75);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
      expect(mockGameEngine.increaseFireRate).toHaveBeenCalled();
    });

    it('pyriphlegethon offers the burn-build capstone with OR prerequisites', () => {
      const pyri = service.upgradeOptions.find((u) => u.id === 'pyriphlegethon')!;
      expect(pyri).toBeDefined();
      expect(pyri.rarity).toBe('legendary');
      expect(pyri.prerequisites).toEqual(['burn_spread', 'void_beam']);
    });

    it('pyriphlegethon scales burn damage and forces wildfire spread to activate', () => {
      const pyri = service.upgradeOptions.find((u) => u.id === 'pyriphlegethon')!;
      service.apply(pyri, mockGameEngine);

      expect(mockGameEngine.increaseBurnDamage).toHaveBeenCalled();
      expect(mockGameEngine.enableBurnSpread).toHaveBeenCalled();
      expect(mockGameEngine.setBurnSpreadChance).toHaveBeenCalled();
    });

    it('legendaries cannot be stacked beyond a single pickup', () => {
      service.incCount('cataclysm_core');
      expect(service.canStack('cataclysm_core')).toBe(false);

      service.incCount('pyriphlegethon');
      expect(service.canStack('pyriphlegethon')).toBe(false);
    });

    it('legendaries are excluded from the draw pool until their prereqs are met', () => {
      service.resetCounts();

      const allDrawnIds = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const drawn = service.draw(3, false);
        drawn.forEach((u) => allDrawnIds.add(u.id));
      }

      expect(allDrawnIds.has('cataclysm_core')).toBe(false);
      expect(allDrawnIds.has('pyriphlegethon')).toBe(false);
      expect(allDrawnIds.has('aegis_prime')).toBe(false);
      expect(allDrawnIds.has('mach_reactor')).toBe(false);
    });

    it('aegis_prime is the survivor capstone gated by emergency_protocols', () => {
      const aegis = service.upgradeOptions.find((u) => u.id === 'aegis_prime')!;
      expect(aegis).toBeDefined();
      expect(aegis.rarity).toBe('legendary');
      expect(aegis.prerequisites).toEqual(['emergency_protocols']);

      service.apply(aegis, mockGameEngine);
      expect(mockGameEngine.increaseMaxHealth).toHaveBeenCalledWith(100);
      expect(mockGameEngine.heal).toHaveBeenCalledWith(50, 'aegis_prime');
      expect(mockGameEngine.increaseDashEfficiency).toHaveBeenCalled();
    });

    it('mach_reactor is the speed capstone gated by velocity_matrix', () => {
      const mach = service.upgradeOptions.find((u) => u.id === 'mach_reactor')!;
      expect(mach).toBeDefined();
      expect(mach.rarity).toBe('legendary');
      expect(mach.prerequisites).toEqual(['velocity_matrix']);

      service.apply(mach, mockGameEngine);
      expect(mockGameEngine.increaseMovementSpeed).toHaveBeenCalled();
      expect(mockGameEngine.increaseFireRate).toHaveBeenCalled();
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
    });

    it('beam_singularity is the precision-beam capstone gated by surgical_precision', () => {
      const bs = service.upgradeOptions.find((u) => u.id === 'beam_singularity')!;
      expect(bs).toBeDefined();
      expect(bs.rarity).toBe('legendary');
      expect(bs.prerequisites).toEqual(['surgical_precision']);

      service.apply(bs, mockGameEngine);
      expect(mockGameEngine.increaseBeamRotationSpeed).toHaveBeenCalled();
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
      expect(mockGameEngine.increaseBeamSpeed).toHaveBeenCalled();
    });

    it('starforge_nova unlocks both discharge and double beam, gated by either prereq', () => {
      const sn = service.upgradeOptions.find((u) => u.id === 'starforge_nova')!;
      expect(sn).toBeDefined();
      expect(sn.rarity).toBe('legendary');
      expect(sn.prerequisites).toEqual(['double_beam', 'discharge']);

      service.apply(sn, mockGameEngine);
      expect(mockGameEngine.unlockDischarge).toHaveBeenCalled();
      expect(mockGameEngine.unlockDoubleBeam).toHaveBeenCalled();
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
    });

    it('all six legendaries cap at one stack each', () => {
      ['cataclysm_core', 'pyriphlegethon', 'aegis_prime', 'mach_reactor', 'beam_singularity', 'starforge_nova'].forEach(
        (id) => {
          service.incCount(id);
          expect(service.canStack(id)).withContext(id).toBe(false);
        }
      );
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Blessings                                                             */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Blessings', () => {
    const blessingIds = ['astral_aegis', 'quickening', 'magnetars_touch', 'verdant_ward', 'solar_flare'];

    it('exposes at least five blessings so the tier is not hollow', () => {
      const blessings = service.upgradeOptions.filter((u) => u.type === 'blessing');
      expect(blessings.length).toBeGreaterThanOrEqual(5);
    });

    it('every blessing declares type=blessing, rarity=blessing, and a severity', () => {
      blessingIds.forEach((id) => {
        const card = service.upgradeOptions.find((u) => u.id === id)!;
        expect(card).withContext(id).toBeDefined();
        expect(card.type).withContext(id).toBe('blessing');
        expect(card.rarity).withContext(id).toBe('blessing');
        expect(['low', 'medium', 'high']).withContext(id).toContain(card.severity!);
      });
    });

    it('blessings have no prerequisites — always eligible when drawn', () => {
      blessingIds.forEach((id) => {
        const card = service.upgradeOptions.find((u) => u.id === id)!;
        expect(card.prerequisites).withContext(id).toBeUndefined();
      });
    });

    it('blessings flow through the curses getter (shared draw pool with curses)', () => {
      const cursesGetterIds = service.curses.map((u) => u.id);
      blessingIds.forEach((id) => {
        expect(cursesGetterIds).withContext(id).toContain(id);
      });
    });

    it('blessings do NOT appear in the selectable upgrade pool', () => {
      const selectableIds = service.selectable.map((u) => u.id);
      blessingIds.forEach((id) => {
        expect(selectableIds).withContext(id).not.toContain(id);
      });
    });

    it('astral_aegis applies an HP bump and an instant heal', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'astral_aegis')!;
      service.apply(card, mockGameEngine);
      expect(mockGameEngine.increaseMaxHealth).toHaveBeenCalledWith(50);
      expect(mockGameEngine.heal).toHaveBeenCalledWith(30, 'astral_aegis');
    });

    it('quickening boosts speed and dash efficiency', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'quickening')!;
      service.apply(card, mockGameEngine);
      expect(mockGameEngine.increaseMovementSpeed).toHaveBeenCalled();
      expect(mockGameEngine.increaseDashEfficiency).toHaveBeenCalled();
    });

    it('magnetars_touch enhances shard magnetism range', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'magnetars_touch')!;
      service.apply(card, mockGameEngine);
      expect(mockGameEngine.enhanceShardMagnetism).toHaveBeenCalledWith(200);
    });

    it('verdant_ward heals more than astral_aegis and adds less max HP — distinct trade', () => {
      const verdant = service.upgradeOptions.find((u) => u.id === 'verdant_ward')!;
      service.apply(verdant, mockGameEngine);
      expect(mockGameEngine.increaseMaxHealth).toHaveBeenCalledWith(25);
      expect(mockGameEngine.heal).toHaveBeenCalledWith(50, 'verdant_ward');
    });

    it('solar_flare scales beam damage and fire rate', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'solar_flare')!;
      service.apply(card, mockGameEngine);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
      expect(mockGameEngine.increaseFireRate).toHaveBeenCalled();
    });

    it('every blessing caps at one stack — never inherits the default 10 cap', () => {
      blessingIds.forEach((id) => {
        service.incCount(id);
        expect(service.canStack(id)).withContext(id).toBe(false);
      });
    });
  });

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Curse expansion (Phase 4)                                             */
  /* ─────────────────────────────────────────────────────────────────────── */

  describe('Curses', () => {
    const newCurseIds = [
      'aether_drain',
      'hollow_hull',
      'burning_marrow',
      'glass_veil',
      'sluggish_reactor',
      'phantom_echo',
    ];
    const allCurseIds = ['vulnerability', ...newCurseIds];

    it('exposes at least five curses so the risk-reward dimension is real', () => {
      const curses = service.upgradeOptions.filter((u) => u.type === 'curse');
      expect(curses.length).toBeGreaterThanOrEqual(5);
    });

    it('every new curse declares type=curse, rarity=curse, and a severity', () => {
      newCurseIds.forEach((id) => {
        const card = service.upgradeOptions.find((u) => u.id === id)!;
        expect(card).withContext(id).toBeDefined();
        expect(card.type).withContext(id).toBe('curse');
        expect(card.rarity).withContext(id).toBe('curse');
        expect(['low', 'medium', 'high']).withContext(id).toContain(card.severity!);
      });
    });

    it('every curse caps at one stack — including the pre-existing vulnerability', () => {
      allCurseIds.forEach((id) => {
        service.incCount(id);
        expect(service.canStack(id)).withContext(id).toBe(false);
      });
    });

    it('aether_drain subtracts HP and adds beam damage', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'aether_drain')!;
      service.apply(card, mockGameEngine);
      expect(mockPlayerService.increaseMaxHealth).toHaveBeenCalledWith(-15);
      expect(mockGameEngine.clampCurrentHealth).toHaveBeenCalled();
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
    });

    it('hollow_hull subtracts more HP and adds fire rate', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'hollow_hull')!;
      service.apply(card, mockGameEngine);
      expect(mockPlayerService.increaseMaxHealth).toHaveBeenCalledWith(-25);
      expect(mockGameEngine.increaseFireRate).toHaveBeenCalled();
    });

    it('burning_marrow subtracts HP and adds burn damage', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'burning_marrow')!;
      service.apply(card, mockGameEngine);
      expect(mockPlayerService.increaseMaxHealth).toHaveBeenCalledWith(-20);
      expect(mockGameEngine.increaseBurnDamage).toHaveBeenCalled();
    });

    it('glass_veil is the high-severity capstone — biggest HP cost and biggest damage gain', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'glass_veil')!;
      expect(card.severity).toBe('high');
      service.apply(card, mockGameEngine);
      expect(mockPlayerService.increaseMaxHealth).toHaveBeenCalledWith(-50);
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
    });

    it('sluggish_reactor trades speed for beam damage (variety: non-HP downside)', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'sluggish_reactor')!;
      expect(card).toBeDefined();
      expect(card.type).toBe('curse');
      service.apply(card, mockGameEngine);
      // No max-HP mutation — this curse intentionally breaks the HP-cost pattern.
      expect(mockPlayerService.increaseMaxHealth).not.toHaveBeenCalled();
      expect(mockGameEngine.increaseMovementSpeed).toHaveBeenCalled();
      expect(mockGameEngine.increaseBeamDamage).toHaveBeenCalled();
    });

    it('phantom_echo trades HP for an ability unlock rather than a stat boost', () => {
      const card = service.upgradeOptions.find((u) => u.id === 'phantom_echo')!;
      expect(card).toBeDefined();
      expect(card.type).toBe('curse');
      service.apply(card, mockGameEngine);
      expect(mockPlayerService.increaseMaxHealth).toHaveBeenCalledWith(-30);
      expect(mockGameEngine.unlockDoubleBeam).toHaveBeenCalled();
    });

    it('curse tier now spans more than one risk-reward axis (HP-cost + speed-cost + unlock-trade)', () => {
      // Sanity check that the variety claim holds: at least one curse uses
      // a non-HP downside, and at least one uses a non-stat upside.
      const speedCost = service.upgradeOptions.find((u) => u.id === 'sluggish_reactor')!;
      const unlockTrade = service.upgradeOptions.find((u) => u.id === 'phantom_echo')!;
      expect(speedCost).toBeDefined();
      expect(unlockTrade).toBeDefined();
    });

    it('every HP-cost curse clamps current health after subtracting from max so the player cannot float above the new ceiling', () => {
      // sluggish_reactor uses a speed downside instead of HP and intentionally
      // does NOT touch maxHealth — so it has no need to clamp. The clamp
      // contract is specific to curses that subtract from max HP.
      const hpCostCurseIds = ['aether_drain', 'hollow_hull', 'burning_marrow', 'glass_veil', 'phantom_echo'];
      hpCostCurseIds.forEach((id) => {
        (mockGameEngine.clampCurrentHealth as jasmine.Spy).calls.reset();
        const card = service.upgradeOptions.find((u) => u.id === id)!;
        service.apply(card, mockGameEngine);
        expect(mockGameEngine.clampCurrentHealth).withContext(id).toHaveBeenCalled();
      });
    });
  });
});
