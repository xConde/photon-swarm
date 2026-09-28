import { TestBed } from '@angular/core/testing';
import { ConsumableItem, ConsumableService } from './consumable.service';
import { GameEngineService } from '../core/engine/game-engine.service';
import { PlayerService } from '../core/player/player.service';
import { StorageService } from './storage.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { BuffSystemService } from '../core/progression/buff-system.service';

describe('ConsumableService', () => {
  let service: ConsumableService;
  let gameEngineSpy: jasmine.SpyObj<GameEngineService>;
  let playerSpy: jasmine.SpyObj<PlayerService>;
  let storageSpy: jasmine.SpyObj<StorageService>;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;
  let buffSystemSpy: jasmine.SpyObj<BuffSystemService>;

  beforeEach(() => {
    gameEngineSpy = jasmine.createSpyObj('GameEngineService', [
      'applyConsumableBuff',
      'getShards',
      'spendShards',
      'refundShards',
      'heal',
      'magnetAllShards',
    ]);
    gameEngineSpy.spendShards.and.returnValue(true);
    gameEngineSpy.applyConsumableBuff.and.returnValue(true);
    gameEngineSpy.magnetAllShards.and.returnValue(true);
    // Nested player object with getMaxHealth spy
    (gameEngineSpy as unknown as { player: { getMaxHealth: jasmine.Spy } }).player = {
      getMaxHealth: jasmine.createSpy('getMaxHealth').and.returnValue(100),
    };

    playerSpy = jasmine.createSpyObj('PlayerService', ['activateInvincibility']);
    storageSpy = jasmine.createSpyObj('StorageService', ['get', 'set']);
    debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    buffSystemSpy = jasmine.createSpyObj('BuffSystemService', ['applyBuff']);

    // Default: no saved consumables
    storageSpy.get.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [
        ConsumableService,
        { provide: GameEngineService, useValue: gameEngineSpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: StorageService, useValue: storageSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: BuffSystemService, useValue: buffSystemSpy },
      ],
    });

    service = TestBed.inject(ConsumableService);
  });

  // ---- initialize() ----
  describe('initialize()', () => {
    it('should load consumables from storage on first call', () => {
      service.initialize();
      expect(storageSpy.get).toHaveBeenCalledWith('photon-swarm-consumables');
    });

    it('should only run once even when called multiple times', () => {
      service.initialize();
      service.initialize();
      service.initialize();
      // Storage should only be read once
      expect(storageSpy.get).toHaveBeenCalledTimes(1);
    });

    it('should restore owned quantities from storage', () => {
      storageSpy.get.and.returnValue({ damage_boost: 3, shield: 1 });
      service.initialize();
      expect(service.getQuantity('damage_boost')).toBe(3);
      expect(service.getQuantity('shield')).toBe(1);
    });

    it('drops unknown, fractional, and non-positive persisted inventory', () => {
      storageSpy.get.and.returnValue({ damage_boost: 2, shield: -1, rapid_fire: 1.5, retired_item: 9 });

      service.initialize();

      expect(service.getQuantity('damage_boost')).toBe(2);
      expect(service.getQuantity('shield')).toBe(0);
      expect(service.getQuantity('rapid_fire')).toBe(0);
      expect(service.getQuantity('retired_item')).toBe(0);
    });
  });

  // ---- getAll() ----
  describe('getAll()', () => {
    it('should return all 9 consumable definitions', () => {
      const items = service.getAll();
      expect(items.length).toBe(9);
    });

    it('should contain expected item IDs', () => {
      const ids = service.getAll().map((i) => i.id);
      expect(ids).toEqual([
        'damage_boost',
        'rapid_fire',
        'critical_boost',
        'shield',
        'heal_instant',
        'invincibility',
        'speed_boost',
        'xp_boost',
        'magnet_field',
      ]);
    });

    it('should return the same frozen array reference on repeated calls (cached)', () => {
      const a = service.getAll();
      const b = service.getAll();
      expect(a).toBe(b);
    });

    it('should return frozen items — mutating a returned item does not affect service state', () => {
      const items = service.getAll();
      const firstItem = items[0];
      const originalName = firstItem.name;

      // Attempt to mutate the frozen item — should throw in strict mode or silently no-op
      expect(() => {
        (firstItem as { name: string }).name = 'hacked';
      }).toThrow();

      // Service internal state must be unaffected
      expect(service.getAll()[0].name).toBe(originalName);
    });

    it('should return a new frozen array after use() invalidates the cache', () => {
      gameEngineSpy.getShards.and.returnValue(10000);
      service.purchase('invincibility');

      const before = service.getAll();
      service.use('invincibility');
      const after = service.getAll();

      // Cache invalidated by use() — new array reference
      expect(after).not.toBe(before);
    });
  });

  // ---- purchase() ----
  describe('purchase()', () => {
    it('should succeed when player has enough shards', () => {
      gameEngineSpy.getShards.and.returnValue(200);
      const result = service.purchase('damage_boost');
      expect(result).toBeTrue();
      expect(gameEngineSpy.spendShards).toHaveBeenCalledWith(150);
      expect(service.getQuantity('damage_boost')).toBe(1);
    });

    it('should fail when player does not have enough shards', () => {
      gameEngineSpy.spendShards.and.returnValue(false);
      const result = service.purchase('damage_boost');
      expect(result).toBeFalse();
      expect(gameEngineSpy.spendShards).toHaveBeenCalledWith(150);
      expect(service.getQuantity('damage_boost')).toBe(0);
    });

    it('should increment quantity on repeated purchases', () => {
      gameEngineSpy.getShards.and.returnValue(1000);
      service.purchase('shield');
      service.purchase('shield');
      service.purchase('shield');
      expect(service.getQuantity('shield')).toBe(3);
    });

    it('should save to storage after purchase', () => {
      gameEngineSpy.getShards.and.returnValue(500);
      service.purchase('rapid_fire');
      expect(storageSpy.set).toHaveBeenCalledWith('photon-swarm-consumables', { rapid_fire: 1 });
    });

    it('should emit updated inventory after purchase', () => {
      gameEngineSpy.getShards.and.returnValue(500);
      let lastInventory: Map<string, number> | undefined;
      service.inventory$.subscribe((inv) => (lastInventory = inv));
      service.purchase('magnet_field');
      expect(lastInventory!.get('magnet_field')).toBe(1);
    });

    it('uses the catalog price and rejects unknown IDs before charging', () => {
      expect(service.purchase('retired_item')).toBeFalse();
      expect(gameEngineSpy.spendShards).not.toHaveBeenCalled();

      expect(service.purchase('critical_boost')).toBeTrue();
      expect(gameEngineSpy.spendShards).toHaveBeenCalledWith(200);
    });

    it('refunds a purchase when inventory persistence fails', () => {
      storageSpy.set.and.returnValue(false);

      expect(service.purchase('shield')).toBeFalse();

      expect(service.getQuantity('shield')).toBe(0);
      expect(gameEngineSpy.refundShards).toHaveBeenCalledWith(175);
    });
  });

  // ---- use() ----
  describe('use()', () => {
    beforeEach(() => {
      // Give the player some items
      gameEngineSpy.getShards.and.returnValue(10000);
      service.purchase('damage_boost');
      service.purchase('magnet_field');
      service.purchase('invincibility');
    });

    it('should activate the effect and return true', () => {
      const result = service.use('damage_boost');
      expect(result).toBeTrue();
      expect(gameEngineSpy.applyConsumableBuff).toHaveBeenCalledWith('power_surge', {
        damageMultiplier: 2.0,
        duration: 30000,
      });
    });

    it('should return false when quantity is 0', () => {
      const result = service.use('speed_boost'); // not purchased
      expect(result).toBeFalse();
    });

    it('should return false for unknown item ID', () => {
      const result = service.use('nonexistent_item');
      expect(result).toBeFalse();
    });

    it('should decrement quantity and remove from map when reaching 0', () => {
      expect(service.getQuantity('damage_boost')).toBe(1);
      service.use('damage_boost');
      expect(service.getQuantity('damage_boost')).toBe(0);
    });

    it('should call magnetAllShards for the magnet_field consumable', () => {
      service.use('magnet_field');
      expect(gameEngineSpy.magnetAllShards).toHaveBeenCalled();
    });

    it('should call activateInvincibility for the invincibility consumable', () => {
      service.use('invincibility');
      expect(playerSpy.activateInvincibility).toHaveBeenCalledWith(3000);
    });

    it('should enforce cooldown period', () => {
      // invincibility has a 60s cooldown - buy a second one so we can try twice
      service.purchase('invincibility');
      expect(service.getQuantity('invincibility')).toBe(2);

      // First use should succeed
      const first = service.use('invincibility');
      expect(first).toBeTrue();

      // Second use immediately should fail (cooldown)
      const second = service.use('invincibility');
      expect(second).toBeFalse();
      expect(service.getQuantity('invincibility')).toBe(1); // quantity unchanged on cooldown fail
    });

    it('should save to storage after use', () => {
      storageSpy.set.calls.reset();
      service.use('magnet_field');
      expect(storageSpy.set).toHaveBeenCalled();
    });

    it('restores inventory and cooldown state when an effect cannot be applied', () => {
      gameEngineSpy.applyConsumableBuff.and.returnValue(false);

      expect(service.use('damage_boost')).toBeFalse();

      expect(service.getQuantity('damage_boost')).toBe(1);
      expect(service.getItem('damage_boost')!.lastUsed).toBeUndefined();
    });
  });

  // ---- getQuantity() ----
  describe('getQuantity()', () => {
    it('should return 0 for items not owned', () => {
      expect(service.getQuantity('damage_boost')).toBe(0);
    });

    it('should return correct count after purchases', () => {
      gameEngineSpy.getShards.and.returnValue(10000);
      service.purchase('shield');
      service.purchase('shield');
      expect(service.getQuantity('shield')).toBe(2);
    });
  });

  // ---- getQuickSlots() ----
  describe('getQuickSlots()', () => {
    it('should return empty array when nothing owned', () => {
      expect(service.getQuickSlots().length).toBe(0);
    });

    it('should return up to 3 owned items in canonical order', () => {
      gameEngineSpy.getShards.and.returnValue(10000);
      // Purchase items out of canonical order
      service.purchase('magnet_field'); // index 8
      service.purchase('shield'); // index 3
      service.purchase('damage_boost'); // index 0
      service.purchase('rapid_fire'); // index 1 (4th owned, should be excluded)

      const slots = service.getQuickSlots();
      expect(slots.length).toBe(3);
      // Canonical order: damage_boost (0), rapid_fire (1), shield (3)
      expect(slots[0].id).toBe('damage_boost');
      expect(slots[1].id).toBe('rapid_fire');
      expect(slots[2].id).toBe('shield');
    });
  });

  // ---- getItem() ----
  describe('getItem()', () => {
    it('should return item definition by ID', () => {
      const item = service.getItem('shield');
      expect(item).toBeDefined();
      expect(item!.name).toBe('Energy Shield');
      expect(item!.category).toBe('defense');
    });

    it('should return undefined for unknown ID', () => {
      expect(service.getItem('does_not_exist')).toBeUndefined();
    });
  });

  // ---- Item 4: Consumable bus routing ----
  // These tests prove each consumable routes its effect through the correct
  // downstream system — the one that actually reads the value during gameplay.
  describe('Item 4 — consumable bus routing', () => {
    beforeEach(() => {
      gameEngineSpy.getShards.and.returnValue(10000);
    });

    it('Turbo Boost routes to buffSystem.applyBuff("movementSpeed"), NOT applyConsumableBuff', () => {
      service.purchase('speed_boost');
      service.use('speed_boost');

      // Must go through BuffSystemService so player.service reads it via movementSpeedMultiplier
      expect(buffSystemSpy.applyBuff).toHaveBeenCalledWith('turbo_boost', 'movementSpeed', 2.0, 30_000);
      expect(gameEngineSpy.applyConsumableBuff).not.toHaveBeenCalledWith('turbo_boost', jasmine.anything());
    });

    it('XP Amplifier routes to buffSystem.applyBuff("experienceGain"), NOT applyConsumableBuff', () => {
      service.purchase('xp_boost');
      service.use('xp_boost');

      // Must go through BuffSystemService so progression reads it via experienceGainMultiplier
      expect(buffSystemSpy.applyBuff).toHaveBeenCalledWith('xp_amplifier', 'experienceGain', 2.0, 60_000);
      expect(gameEngineSpy.applyConsumableBuff).not.toHaveBeenCalledWith('xp_amplifier', jasmine.anything());
    });

    it('Critical Strike still routes through gameEngine.applyConsumableBuff (BuffComponent path)', () => {
      service.purchase('critical_boost');
      service.use('critical_boost');

      // Critical Strike writes to BuffComponent via the gameEngine buff bus so that
      // beam-collision-system can read buffComp.criticalChance alongside the upgrade crit.
      expect(gameEngineSpy.applyConsumableBuff).toHaveBeenCalledWith(
        'critical_strike',
        jasmine.objectContaining({ criticalChance: 1.0, criticalMultiplier: 2.0 })
      );
    });
  });

  // ---- isOnCooldown() / getCooldownRemaining() ----
  describe('isOnCooldown() / getCooldownRemaining()', () => {
    it('should return false when no cooldown is defined', () => {
      const item = service.getItem('damage_boost')!;
      expect(service.isOnCooldown(item)).toBeFalse();
    });

    it('should return false when cooldown is defined but item was never used', () => {
      const item = service.getItem('invincibility')!;
      expect(service.isOnCooldown(item)).toBeFalse();
    });

    it('should return true when item was recently used and cooldown has not elapsed', () => {
      const item: ConsumableItem = {
        id: 'test',
        name: 'Test',
        description: '',
        cost: 0,
        duration: 0,
        icon: '',
        category: 'combat',
        effectFn: () => {},
        cooldown: 60,
        lastUsed: Date.now(), // just used
      };
      expect(service.isOnCooldown(item)).toBeTrue();
    });

    it('should return false when cooldown has fully elapsed', () => {
      const item: ConsumableItem = {
        id: 'test',
        name: 'Test',
        description: '',
        cost: 0,
        duration: 0,
        icon: '',
        category: 'combat',
        effectFn: () => {},
        cooldown: 60,
        lastUsed: Date.now() - 61000, // 61 seconds ago
      };
      expect(service.isOnCooldown(item)).toBeFalse();
    });

    it('should return 0 remaining when no cooldown is defined', () => {
      const item = service.getItem('damage_boost')!;
      expect(service.getCooldownRemaining(item)).toBe(0);
    });

    it('should return 0 remaining when cooldown has elapsed', () => {
      const item: ConsumableItem = {
        id: 'test',
        name: 'Test',
        description: '',
        cost: 0,
        duration: 0,
        icon: '',
        category: 'combat',
        effectFn: () => {},
        cooldown: 10,
        lastUsed: Date.now() - 15000,
      };
      expect(service.getCooldownRemaining(item)).toBe(0);
    });

    it('should return remaining seconds (rounded up) when on cooldown', () => {
      const item: ConsumableItem = {
        id: 'test',
        name: 'Test',
        description: '',
        cost: 0,
        duration: 0,
        icon: '',
        category: 'combat',
        effectFn: () => {},
        cooldown: 60,
        lastUsed: Date.now() - 30000, // 30s ago, 30s remaining
      };
      const remaining = service.getCooldownRemaining(item);
      // Should be approximately 30, allow +-1 for timing
      expect(remaining).toBeGreaterThanOrEqual(29);
      expect(remaining).toBeLessThanOrEqual(31);
    });
  });
});
