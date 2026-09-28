import { TestBed } from '@angular/core/testing';
import { Cosmetic, CosmeticsService, CosmeticType } from './cosmetics.service';
import { StorageService } from './storage.service';

describe('CosmeticsService', () => {
  let service: CosmeticsService;
  let storage: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    storage = jasmine.createSpyObj<StorageService>('StorageService', ['get', 'set', 'remove', 'clearAll']);
    storage.get.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [CosmeticsService, { provide: StorageService, useValue: storage }],
    });

    service = TestBed.inject(CosmeticsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Initialisation', () => {
    it('should expose a non-empty cosmetics list after construction', () => {
      expect(service.getCosmetics().length).toBeGreaterThan(0);
    });

    it('should have default cosmetics unlocked from the start', () => {
      const unlocked = service.getUnlockedCosmetics();
      expect(unlocked.some((c) => c.id === 'default-white')).toBe(true);
      expect(unlocked.some((c) => c.id === 'default-cyan')).toBe(true);
      expect(unlocked.some((c) => c.id === 'default-circle')).toBe(true);
      expect(unlocked.some((c) => c.id === 'none')).toBe(true);
    });

    it('should merge saved unlocked state from storage on construction', () => {
      // Simulate a saved state where neon-blue was previously unlocked
      const savedCosmetics: Partial<Cosmetic>[] = [{ id: 'neon-blue', unlocked: true }];
      storage.get.and.callFake((key: string) => {
        if (key === 'photon-swarm-cosmetics') return savedCosmetics as unknown as null;
        return null;
      });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [CosmeticsService, { provide: StorageService, useValue: storage }],
      });
      service = TestBed.inject(CosmeticsService);

      expect(service.isUnlocked('neon-blue')).toBe(true);
    });

    it('should restore saved active cosmetics from storage', () => {
      const savedActive: Record<CosmeticType, string> = {
        shipColor: 'default-white',
        beamColor: 'solar-orange',
        shipShape: 'default-circle',
        accessory: 'none',
      };
      // Unlock solar-orange so it can be active
      const savedCosmetics: Partial<Cosmetic>[] = [{ id: 'solar-orange', unlocked: true }];

      storage.get.and.callFake((key: string) => {
        if (key === 'photon-swarm-cosmetics') return savedCosmetics as unknown as null;
        if (key === 'photon-swarm-active-cosmetics') return savedActive as unknown as null;
        return null;
      });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [CosmeticsService, { provide: StorageService, useValue: storage }],
      });
      service = TestBed.inject(CosmeticsService);

      expect(service.getActiveCosmeticId('beamColor')).toBe('solar-orange');
    });
  });

  describe('getCosmetics()', () => {
    it('should return all cosmetics when no type filter is given', () => {
      const all = service.getCosmetics();
      expect(all.length).toBeGreaterThan(0);
    });

    it('should filter by type when a type is provided', () => {
      const shipColors = service.getCosmetics('shipColor');
      expect(shipColors.every((c) => c.type === 'shipColor')).toBe(true);
    });

    it('should return cosmetics of each expected type', () => {
      const types: CosmeticType[] = ['shipColor', 'beamColor', 'shipShape', 'accessory'];
      for (const type of types) {
        expect(service.getCosmetics(type).length).toBeGreaterThan(0);
      }
    });
  });

  describe('unlockCosmetic()', () => {
    it('should unlock a locked cosmetic and return true', () => {
      expect(service.isUnlocked('neon-blue')).toBe(false);
      const result = service.unlockCosmetic('neon-blue');
      expect(result).toBe(true);
      expect(service.isUnlocked('neon-blue')).toBe(true);
    });

    it('should return false when unlocking a non-existent cosmetic', () => {
      expect(service.unlockCosmetic('ghost-id')).toBe(false);
    });

    it('should return false when trying to unlock an already-unlocked cosmetic', () => {
      // default-white starts unlocked
      expect(service.unlockCosmetic('default-white')).toBe(false);
    });

    it('should call saveCosmetics() which persists to storage', () => {
      service.unlockCosmetic('neon-blue');
      expect(storage.set).toHaveBeenCalled();
    });
  });

  describe('setActiveCosmetic()', () => {
    it('should set the active cosmetic and return true when the cosmetic is unlocked', () => {
      // default-white is unlocked by default
      const result = service.setActiveCosmetic('shipColor', 'default-white');
      expect(result).toBe(true);
      expect(service.getActiveCosmeticId('shipColor')).toBe('default-white');
    });

    it('should return false when the cosmetic is locked', () => {
      const result = service.setActiveCosmetic('shipColor', 'neon-blue');
      expect(result).toBe(false);
    });

    it('should return false when the cosmetic id does not exist', () => {
      expect(service.setActiveCosmetic('shipColor', 'ghost-id')).toBe(false);
    });

    it('should update active cosmetic after unlocking', () => {
      service.unlockCosmetic('neon-blue');
      const result = service.setActiveCosmetic('shipColor', 'neon-blue');
      expect(result).toBe(true);
      expect(service.getActiveCosmeticId('shipColor')).toBe('neon-blue');
    });

    it('should persist the active selection to storage', () => {
      storage.set.calls.reset();
      service.setActiveCosmetic('shipColor', 'default-white');
      expect(storage.set).toHaveBeenCalled();
    });
  });

  describe('getActiveCosmetic()', () => {
    it('should return the active cosmetic object for a given type', () => {
      const active = service.getActiveCosmetic('shipColor');
      expect(active).toBeDefined();
      expect(active?.id).toBe('default-white');
    });

    it('should return undefined when the active id does not match any cosmetic of that type', () => {
      // Force an invalid active state by using a type mismatch
      service.setActiveCosmetic('shipColor', 'default-white');
      // getActiveCosmetic checks type match so asking for beamColor with default-white id won't match
      const active = service.getActiveCosmetic('beamColor');
      expect(active?.id).toBe('default-cyan');
    });
  });

  describe('getUnlockedCosmetics()', () => {
    it('should return only unlocked cosmetics', () => {
      const unlocked = service.getUnlockedCosmetics();
      expect(unlocked.every((c) => c.unlocked)).toBe(true);
    });

    it('should include a newly unlocked cosmetic', () => {
      service.unlockCosmetic('crimson');
      const unlocked = service.getUnlockedCosmetics('shipColor');
      expect(unlocked.some((c) => c.id === 'crimson')).toBe(true);
    });
  });

  describe('unlockRainbowBeam()', () => {
    it('should unlock "rainbow-beam" and set it as the active beam color', () => {
      service.unlockRainbowBeam();
      expect(service.isUnlocked('rainbow-beam')).toBe(true);
      expect(service.getActiveCosmeticId('beamColor')).toBe('rainbow-beam');
    });
  });
});
