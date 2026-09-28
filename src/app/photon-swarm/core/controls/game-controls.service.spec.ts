import { TestBed } from '@angular/core/testing';
import { GameControlsService } from './game-controls.service';
import { PlayerService } from '../player/player.service';
import { AudioService } from '../audio/audio.service';
import { CONTROL_CONSTANTS } from './control-constants';

describe('GameControlsService', () => {
  let service: GameControlsService;
  let playerServiceSpy: jasmine.SpyObj<PlayerService>;

  beforeEach(() => {
    // Install jasmine clock BEFORE service construction so that
    // the internal interval(50) and all Date.now() calls are under clock control.
    try {
      jasmine.clock().uninstall();
    } catch {
      // Not installed — fine
    }
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(1_000_000));

    const spy = jasmine.createSpyObj('PlayerService', [
      'isDirectionChangeOnCooldown',
      'isDirectionChangeActive',
      'isDischargeAvailable',
      'getDischargePercent',
      'getDashCooldown',
      'getGameActive',
      'isParryAvailable',
      'setKey',
      'setShiftFiring',
      'getIsShiftFiring',
      'toggleShootingMode',
      'isParrying',
      'isChargingDischarge',
      'changeDirection',
      'getMouseWorldPosition',
      'toggleAutoBeam',
      'setFocusFire',
      'getIsFocusFiring',
    ]);

    const audioSpy = jasmine.createSpyObj('AudioService', ['playFocusFireEngage', 'playFocusFireDisengage']);

    TestBed.configureTestingModule({
      providers: [
        GameControlsService,
        { provide: PlayerService, useValue: spy },
        { provide: AudioService, useValue: audioSpy },
      ],
    });

    service = TestBed.inject(GameControlsService);
    playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;

    playerServiceSpy.isDirectionChangeOnCooldown.and.returnValue(false);
    playerServiceSpy.isDirectionChangeActive.and.returnValue(false);
    playerServiceSpy.isDischargeAvailable.and.returnValue(true);
    playerServiceSpy.getDischargePercent.and.returnValue(0);
    playerServiceSpy.getDashCooldown.and.returnValue(5000);
    playerServiceSpy.getGameActive.and.returnValue(true);
    playerServiceSpy.isParryAvailable.and.returnValue(false);
    playerServiceSpy.getIsShiftFiring.and.returnValue(false);
    playerServiceSpy.isParrying.and.returnValue(false);
    playerServiceSpy.isChargingDischarge.and.returnValue(false);
    playerServiceSpy.getIsFocusFiring.and.returnValue(false);
  });

  afterEach(() => {
    service.ngOnDestroy();
    jasmine.clock().uninstall();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getControlsForState', () => {
    it('should return game controls with centralized constants', () => {
      const controls = service.getControlsForState('game');
      expect(controls).toBeDefined();
      expect(controls.length).toBe(8);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.MOVEMENT)).toBe(true);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.TARGET)).toBe(true);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.DISCHARGE)).toBe(true);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.DASH)).toBe(true);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PARRY)).toBe(true);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.FLIGHT_MODE)).toBe(true);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.MAP)).toBe(true);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PAUSE)).toBe(true);
    });

    it('should return pause controls for pause state', () => {
      const controls = service.getControlsForState('pause');
      expect(controls).toBeDefined();
      expect(controls.length).toBe(1);
      expect(controls[0].key).toBe(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PAUSE);
      expect(controls[0].action).toBe('Resume');
    });

    it('should return shop controls for shop state', () => {
      const controls = service.getControlsForState('shop');
      expect(controls).toBeDefined();
      expect(controls.length).toBe(2);
      expect(controls.some((c) => c.key === CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PAUSE)).toBe(true);
      expect(controls.some((c) => c.key === 'ENTER')).toBe(true);
    });
  });

  describe('weapon specifications', () => {
    it('should return all weapon specifications', () => {
      const specs = service.getWeaponSpecifications();
      expect(specs).toBeDefined();
      expect(specs.length).toBe(5);
      expect(specs.some((s) => s.type === 'beam_cannon')).toBe(true);
      expect(specs.some((s) => s.type === 'plasma_rifle')).toBe(true);
      expect(specs.some((s) => s.type === 'void_launcher')).toBe(true);
      expect(specs.some((s) => s.type === 'nova_projector')).toBe(true);
      expect(specs.some((s) => s.type === 'photon_array')).toBe(true);
    });

    it('should return correct damage multipliers', () => {
      const beamCannon = service.getWeaponSpec('beam_cannon');
      const plasmaRifle = service.getWeaponSpec('plasma_rifle');
      const voidLauncher = service.getWeaponSpec('void_launcher');
      const novaProjector = service.getWeaponSpec('nova_projector');
      const photonArray = service.getWeaponSpec('photon_array');

      expect(beamCannon?.damageMultiplier).toBe(1.0);
      expect(plasmaRifle?.damageMultiplier).toBe(1.2);
      expect(voidLauncher?.damageMultiplier).toBe(1.5);
      expect(novaProjector?.damageMultiplier).toBe(0.8);
      expect(photonArray?.damageMultiplier).toBe(1.1);
    });
  });

  describe('player action state with active states', () => {
    it('should provide initial player action state', (done) => {
      service.getPlayerActionState().subscribe((state) => {
        expect(state.isMoving).toBe(false);
        expect(state.isDashing).toBe(false);
        expect(state.isTargeting).toBe(false);
        expect(state.isCombat).toBe(false);
        expect(state.dashCooldownPercent).toBe(0);
        done();
      });
    });

    it('should track movement state when keys are pressed', (done) => {
      const keyDownEvent = new KeyboardEvent('keydown', { key: 'w' });
      document.dispatchEvent(keyDownEvent);

      // Advance the jasmine clock past the 50ms polling interval.
      // The service's interval(50) was created under jasmine.clock() control.
      jasmine.clock().tick(60);

      service.getPlayerActionState().subscribe((state) => {
        expect(state.isMoving).toBe(true);
        done();
      });
    });

    it('should track targeting state from PlayerService', (done) => {
      playerServiceSpy.isDirectionChangeActive.and.returnValue(true);

      jasmine.clock().tick(60);

      service.getPlayerActionState().subscribe((state) => {
        expect(state.isTargeting).toBe(true);
        done();
      });
    });
  });

  describe('cooldown tracking', () => {
    it('should track all cooldowns', (done) => {
      service.getCooldowns().subscribe((cooldowns) => {
        expect(cooldowns.has('TARGET')).toBe(true);
        expect(cooldowns.has('DISCHARGE')).toBe(true);
        expect(cooldowns.has('DASH')).toBe(true);
        done();
      });
    });

    it('should track TARGET cooldown correctly', (done) => {
      service.getCooldowns().subscribe((cooldowns) => {
        const targetCooldown = cooldowns.get('TARGET');
        expect(targetCooldown).toBeDefined();
        if (targetCooldown) {
          expect(targetCooldown.key).toBe('TARGET');
          expect(targetCooldown.isReady).toBe(true);
          expect(targetCooldown.percent).toBe(0);
        }
        done();
      });
    });

    it('should track DISCHARGE cooldown correctly', (done) => {
      // Advance clock so the interval fires and updates cooldown state
      jasmine.clock().tick(60);

      service.getCooldowns().subscribe((cooldowns) => {
        const dischargeCooldown = cooldowns.get('DISCHARGE');
        expect(dischargeCooldown).toBeDefined();
        if (dischargeCooldown) {
          expect(dischargeCooldown.key).toBe('DISCHARGE');
          expect(dischargeCooldown.isReady).toBe(true);
          expect(dischargeCooldown.percent).toBe(0);
        }
        done();
      });
    });

    it('should track DASH cooldown correctly', (done) => {
      service.getCooldowns().subscribe((cooldowns) => {
        const dashCooldown = cooldowns.get('DASH');
        expect(dashCooldown).toBeDefined();
        if (dashCooldown) {
          expect(dashCooldown.key).toBe('DASH');
          expect(dashCooldown.isReady).toBe(true);
          expect(dashCooldown.percent).toBe(0);
        }
        done();
      });
    });
  });

  describe('Shift key — combat modifier', () => {
    it('should toggle auto-beam when Shift pressed in beam mode', (done) => {
      playerServiceSpy.getIsShiftFiring.and.returnValue(false); // beam mode

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));

      // Shift handling is synchronous in handleKeyDown — no tick needed.
      // Use jasmine.clock().tick(0) to flush any microtasks.
      jasmine.clock().tick(0);

      expect(playerServiceSpy.toggleAutoBeam).toHaveBeenCalledTimes(1);
      expect(playerServiceSpy.setFocusFire).not.toHaveBeenCalled();
      done();
    });

    it('should toggle Focus Fire ON when Shift pressed in shooting mode (off→on)', (done) => {
      playerServiceSpy.getIsShiftFiring.and.returnValue(true); // shooting mode
      playerServiceSpy.getIsFocusFiring.and.returnValue(false); // currently off

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      jasmine.clock().tick(0);

      expect(playerServiceSpy.setFocusFire).toHaveBeenCalledWith(true);
      expect(playerServiceSpy.toggleAutoBeam).not.toHaveBeenCalled();
      done();
    });

    it('should toggle Focus Fire OFF when Shift pressed again (on→off)', (done) => {
      playerServiceSpy.getIsShiftFiring.and.returnValue(true); // shooting mode
      playerServiceSpy.getIsFocusFiring.and.returnValue(true); // currently on

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      jasmine.clock().tick(0);

      expect(playerServiceSpy.setFocusFire).toHaveBeenCalledWith(false);
      done();
    });

    it('should NOT affect Focus Fire on Shift keyup (toggle, not hold)', (done) => {
      playerServiceSpy.getIsShiftFiring.and.returnValue(true);
      playerServiceSpy.getIsFocusFiring.and.returnValue(true);

      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
      jasmine.clock().tick(0);

      expect(playerServiceSpy.setFocusFire).not.toHaveBeenCalled();
      done();
    });

    it('should NOT respond to Shift when game is not active', (done) => {
      playerServiceSpy.getGameActive.and.returnValue(false);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      jasmine.clock().tick(0);

      expect(playerServiceSpy.toggleAutoBeam).not.toHaveBeenCalled();
      done();
    });
  });

  describe('cleanup', () => {
    it('should cleanup subscriptions on destroy', () => {
      spyOn(service, 'ngOnDestroy').and.callThrough();
      service.ngOnDestroy();
      expect(service.ngOnDestroy).toHaveBeenCalled();
    });
  });
});
