import { TestBed } from '@angular/core/testing';
import { SaveGameAdapter } from './save-game.adapter';
import { StorageService } from '../../services/storage.service';
import { SaveGameData } from '../models/save-game.model';
import { CONTROL_CONSTANTS } from '../controls/control-constants';

describe('SaveGameAdapter', () => {
  let service: SaveGameAdapter;
  let storageServiceSpy: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    const storageSpy = jasmine.createSpyObj('StorageService', ['get', 'set', 'remove']);

    TestBed.configureTestingModule({
      providers: [SaveGameAdapter, { provide: StorageService, useValue: storageSpy }],
    });

    service = TestBed.inject(SaveGameAdapter);
    storageServiceSpy = TestBed.inject(StorageService) as jasmine.SpyObj<StorageService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should use centralized constants', () => {
    expect(CONTROL_CONSTANTS.DASH_KEY).toBeDefined();
    expect(CONTROL_CONSTANTS.DASH_KEY).toBe(' ');
  });

  it('should save game data', () => {
    const saveData: SaveGameData = {
      version: 1,
      seed: 'test-seed',
      timestamp: Date.now(),
      player: {
        name: 'Test Player',
        x: 400,
        y: 300,
        health: 100,
        maxHealth: 100,
        shards: 0,
        xp: 0,
        level: 1,
      },
      enemies: [],
    };

    storageServiceSpy.set.and.returnValue(true);
    service.save(saveData);
    // The adapter passes the object directly to storage.set (no JSON stringification here)
    expect(storageServiceSpy.set).toHaveBeenCalledWith(
      'save-v2',
      jasmine.objectContaining({
        version: 1,
        seed: 'test-seed',
        player: jasmine.objectContaining({ name: 'Test Player' }),
      })
    );
  });
});
