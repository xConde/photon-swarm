import { TestBed } from '@angular/core/testing';
import { DifficultyMode, DifficultyModifiers, DifficultyService } from './difficulty.service';
import { StorageService } from './storage.service';
import { AscensionService } from './ascension.service';

describe('DifficultyService', () => {
  let service: DifficultyService;
  let storage: jasmine.SpyObj<StorageService>;
  let ascension: jasmine.SpyObj<AscensionService>;

  function createService(savedMode: DifficultyMode | null = null): DifficultyService {
    storage.get.and.returnValue(savedMode);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DifficultyService,
        { provide: StorageService, useValue: storage },
        { provide: AscensionService, useValue: ascension },
      ],
    });
    return TestBed.inject(DifficultyService);
  }

  beforeEach(() => {
    storage = jasmine.createSpyObj<StorageService>('StorageService', ['get', 'set', 'remove', 'clearAll']);
    ascension = jasmine.createSpyObj<AscensionService>('AscensionService', ['getAscensionLevel']);
    ascension.getAscensionLevel.and.returnValue(3);
    storage.get.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [
        DifficultyService,
        { provide: StorageService, useValue: storage },
        { provide: AscensionService, useValue: ascension },
      ],
    });

    service = TestBed.inject(DifficultyService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Initialisation', () => {
    it('should default to "normal" when nothing is stored', () => {
      expect(service.getDifficulty()).toBe('normal');
    });

    it('should restore "hard" difficulty from storage on construction', () => {
      service = createService('hard');
      expect(service.getDifficulty()).toBe('hard');
    });

    it('should restore "extreme" difficulty from storage on construction', () => {
      service = createService('extreme');
      expect(service.getDifficulty()).toBe('extreme');
    });

    it('should ignore invalid values in storage and fall back to "normal"', () => {
      // simulate a corrupted value
      storage.get.and.returnValue('invalid-mode');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          DifficultyService,
          { provide: StorageService, useValue: storage },
          { provide: AscensionService, useValue: ascension },
        ],
      });
      service = TestBed.inject(DifficultyService);
      expect(service.getDifficulty()).toBe('normal');
    });
  });

  describe('setDifficulty()', () => {
    it('should update the current difficulty', () => {
      service.setDifficulty('hard');
      expect(service.getDifficulty()).toBe('hard');
    });

    it('should persist the new difficulty to storage', () => {
      service.setDifficulty('extreme');
      expect(storage.set).toHaveBeenCalledWith('difficulty', 'extreme');
    });

    it('should allow switching back to "normal"', () => {
      service.setDifficulty('hard');
      service.setDifficulty('normal');
      expect(service.getDifficulty()).toBe('normal');
    });

    it('falls back to Heat 0 when a locked Heat is requested', () => {
      ascension.getAscensionLevel.and.returnValue(0);

      service.setDifficulty('extreme');

      expect(service.getDifficulty()).toBe('normal');
      expect(storage.set).toHaveBeenCalledWith('difficulty', 'normal');
    });
  });

  describe('getModifiers()', () => {
    it('should return 1.0 multipliers for "normal"', () => {
      service.setDifficulty('normal');
      const m: DifficultyModifiers = service.getModifiers();
      expect(m.enemyHealthMultiplier).toBe(1.0);
      expect(m.enemyDamageMultiplier).toBe(1.0);
      expect(m.shardMultiplier).toBe(1.0);
      expect(m.xpMultiplier).toBe(1.0);
    });

    it('should return boosted enemy stats for "hard"', () => {
      service.setDifficulty('hard');
      const m: DifficultyModifiers = service.getModifiers();
      expect(m.enemyHealthMultiplier).toBe(1.3);
      expect(m.enemyDamageMultiplier).toBe(1.3);
      expect(m.shardMultiplier).toBeGreaterThan(1.0);
    });

    it('should return the highest enemy multipliers for "extreme"', () => {
      service.setDifficulty('extreme');
      const m: DifficultyModifiers = service.getModifiers();
      expect(m.enemyHealthMultiplier).toBe(1.6);
      expect(m.enemyDamageMultiplier).toBe(1.6);
      expect(m.enemySpeedMultiplier).toBe(1.2);
      expect(m.spawnRateMultiplier).toBe(1.3);
    });

    it('Heat 1 should pay more shards and XP than Heat 0', () => {
      service.setDifficulty('normal');
      const normalModifiers = service.getModifiers();
      service.setDifficulty('hard');
      const hardModifiers = service.getModifiers();
      expect(hardModifiers.shardMultiplier).toBeGreaterThan(normalModifiers.shardMultiplier);
      expect(hardModifiers.xpMultiplier).toBeGreaterThan(normalModifiers.xpMultiplier);
    });

    it('Heat 2 should pay more than Heat 1', () => {
      service.setDifficulty('hard');
      const hardModifiers = service.getModifiers();
      service.setDifficulty('extreme');
      const extremeModifiers = service.getModifiers();
      expect(extremeModifiers.shardMultiplier).toBeGreaterThan(hardModifiers.shardMultiplier);
    });
  });
});
