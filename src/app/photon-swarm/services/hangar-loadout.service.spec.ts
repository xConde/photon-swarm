import { TestBed } from '@angular/core/testing';
import { HANGAR_STORAGE_KEYS } from '../config/hangar-module.config';
import { HangarLoadoutService } from './hangar-loadout.service';
import { StorageService } from './storage.service';

describe('HangarLoadoutService', () => {
  let storage: jasmine.SpyObj<StorageService>;

  function create(values: Partial<Record<string, unknown>> = {}): HangarLoadoutService {
    storage.get.and.callFake(<T>(key: string): T | null => (key in values ? (values[key] as T) : null));
    return TestBed.inject(HangarLoadoutService);
  }

  beforeEach(() => {
    storage = jasmine.createSpyObj('StorageService', ['get', 'set']);
    storage.set.and.returnValue(true);
    TestBed.configureTestingModule({
      providers: [HangarLoadoutService, { provide: StorageService, useValue: storage }],
    });
  });

  it('migrates legacy numeric levels and a valid active module', () => {
    const service = create({
      [HANGAR_STORAGE_KEYS.unlocks]: { max_health: 3, speed_boost: 1, critical_hits: 0 },
      [HANGAR_STORAGE_KEYS.active]: 'speed_boost',
    });

    expect(service.isUnlocked('max_health')).toBeTrue();
    expect(service.isUnlocked('speed_boost')).toBeTrue();
    expect(service.isUnlocked('critical_hits')).toBeFalse();
    expect(service.getSnapshot().activeModuleId).toBe('speed_boost');
    expect(storage.set).toHaveBeenCalledWith(
      HANGAR_STORAGE_KEYS.loadout,
      jasmine.objectContaining({ version: 1, activeModuleId: 'speed_boost' })
    );
  });

  it('rejects a persisted active module that is not unlocked', () => {
    const service = create({
      [HANGAR_STORAGE_KEYS.loadout]: {
        version: 1,
        unlocks: { max_health: true },
        activeModuleId: 'critical_hits',
      },
    });

    expect(service.getSnapshot().activeModuleId).toBeNull();
  });

  it('commits unlock and equip in one storage write', () => {
    const service = create();
    storage.set.calls.reset();

    expect(service.unlockAndEquip('critical_hits')).toBeTrue();

    expect(storage.set).toHaveBeenCalledOnceWith(
      HANGAR_STORAGE_KEYS.loadout,
      jasmine.objectContaining({ activeModuleId: 'critical_hits' })
    );
    expect(service.isUnlocked('critical_hits')).toBeTrue();
  });

  it('does not mutate in-memory state when the atomic write fails', () => {
    const service = create();
    storage.set.and.returnValue(false);

    expect(service.unlockAndEquip('critical_hits')).toBeFalse();

    expect(service.isUnlocked('critical_hits')).toBeFalse();
    expect(service.getSnapshot().activeModuleId).toBeNull();
  });

  it('cannot equip a locked module', () => {
    const service = create();

    expect(service.equip('beam_width')).toBeFalse();
    expect(service.getSnapshot().activeModuleId).toBeNull();
  });
});
