import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShopComponent } from './shop.component';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { PlayerService } from '../../core/player/player.service';
import { Cosmetic, CosmeticsService } from '../../services/cosmetics.service';
import { DebugLogBridgeService } from '../../core/debug/debug-log-bridge.service';
import { ConsumableItem, ConsumableService } from '../../services/consumable.service';
import { HangarLoadoutService } from '../../services/hangar-loadout.service';
import { BehaviorSubject, Subject } from 'rxjs';

describe('ShopComponent', () => {
  let component: ShopComponent;
  let fixture: ComponentFixture<ShopComponent>;
  let mockGameEngine: jasmine.SpyObj<GameEngineService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockCosmeticsService: jasmine.SpyObj<CosmeticsService>;
  let mockHangar: jasmine.SpyObj<HangarLoadoutService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let mockConsumableService: jasmine.SpyObj<ConsumableService>;
  let mockInventory$: BehaviorSubject<Map<string, number>>;

  // Consumable fixtures used across tests
  const consumableFixtures: ConsumableItem[] = [
    {
      id: 'damage_boost',
      name: 'Power Surge',
      description: 'Double damage for 30s',
      cost: 150,
      duration: 30,
      icon: 'fas fa-bolt',
      category: 'combat',
      effectFn: () => {},
    },
    {
      id: 'heal_instant',
      name: 'Repair Kit',
      description: 'Restore 50% health',
      cost: 100,
      duration: 0,
      icon: 'fas fa-wrench',
      category: 'defense',
      effectFn: () => {},
    },
    {
      id: 'speed_boost',
      name: 'Turbo Boost',
      description: 'Double speed for 30s',
      cost: 125,
      duration: 30,
      icon: 'fas fa-rocket',
      category: 'utility',
      effectFn: () => {},
    },
    {
      id: 'invincibility',
      name: 'Phase Shift',
      description: 'Invincible for 3s',
      cost: 300,
      duration: 3,
      icon: 'fas fa-star',
      category: 'defense',
      cooldown: 60,
      effectFn: () => {},
    },
  ];

  beforeEach(async () => {
    // Create mock services
    mockGameEngine = jasmine.createSpyObj(
      'GameEngineService',
      [
        'isPaused',
        'pause',
        'resume',
        'getShards',
        'spendShards',
        'refundShards',
        'captureUpgradeTransaction',
        'restoreUpgradeTransaction',
        'increaseMaxHealth',
        'applyConsumableBuff',
        'magnetAllShards',
        'isGameActive',
        'heal',
        'unlockShardMagnetism',
        'state',
      ],
      {
        player: jasmine.createSpyObj('player', ['getMaxHealth', 'setHealthRegeneration']),
        state$: new Subject<void>(),
      }
    );
    mockGameEngine.isPaused.and.returnValue(false);
    mockGameEngine.getShards.and.returnValue(1000);
    mockGameEngine.spendShards.and.returnValue(true);
    mockGameEngine.captureUpgradeTransaction.and.returnValue(
      {} as ReturnType<GameEngineService['captureUpgradeTransaction']>
    );
    mockGameEngine.isGameActive.and.returnValue(true);
    interface PlayerWithGetMaxHealth {
      getMaxHealth: jasmine.Spy<() => number>;
    }
    (mockGameEngine.player as unknown as PlayerWithGetMaxHealth).getMaxHealth.and.returnValue(100);

    mockPlayerService = jasmine.createSpyObj('PlayerService', [
      'setGameActive',
      'increaseSpeed',
      'increaseBeamWidth',
      'increaseDischargeRadius',
      'reduceDischargeTime',
      'setHealthRegeneration',
      'activateInvincibility',
      'isParryAvailable',
      'setCriticalHitChance',
      'setCriticalHitMultiplier',
      'setShardMultiplier',
      'renderShipPreview',
    ]);
    mockPlayerService.isParryAvailable.and.returnValue(false);

    mockCosmeticsService = jasmine.createSpyObj('CosmeticsService', [
      'getCosmetics',
      'getActiveCosmeticId',
      'getActiveCosmetic',
      'unlockCosmetic',
      'setActiveCosmetic',
      'unlockTemporaryShield',
    ]);
    mockCosmeticsService.getCosmetics.and.returnValue([]);
    mockCosmeticsService.getActiveCosmeticId.and.returnValue('');
    mockCosmeticsService.getActiveCosmetic.and.returnValue(undefined);

    mockHangar = jasmine.createSpyObj('HangarLoadoutService', ['getSnapshot', 'isUnlocked', 'unlockAndEquip', 'equip']);
    mockHangar.getSnapshot.and.returnValue({ version: 1, unlocks: {}, activeModuleId: null });
    mockHangar.unlockAndEquip.and.returnValue(true);
    mockHangar.equip.and.returnValue(true);

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // ConsumableService mock — tracks inventory in a local Map
    mockInventory$ = new BehaviorSubject<Map<string, number>>(new Map());
    mockConsumableService = jasmine.createSpyObj(
      'ConsumableService',
      ['initialize', 'getAll', 'purchase', 'use', 'getQuantity'],
      { inventory$: mockInventory$ }
    );
    mockConsumableService.getAll.and.returnValue(consumableFixtures);
    mockConsumableService.getQuantity.and.callFake((id: string) => mockInventory$.value.get(id) || 0);
    mockConsumableService.purchase.and.callFake((id: string) => {
      const item = consumableFixtures.find((candidate) => candidate.id === id);
      if (!item || !mockGameEngine.spendShards(item.cost)) return false;
      const current = mockInventory$.value.get(id) || 0;
      const updated = new Map(mockInventory$.value);
      updated.set(id, current + 1);
      mockInventory$.next(updated);
      return true;
    });
    // Track cooldowns locally for the mock
    const lastUsedMap = new Map<string, number>();
    mockConsumableService.use.and.callFake((id: string) => {
      const qty = mockInventory$.value.get(id) || 0;
      if (qty <= 0) return false;
      const item = consumableFixtures.find((i) => i.id === id);
      if (!item) return false;
      if (item.cooldown && lastUsedMap.has(id)) {
        const elapsed = (Date.now() - (lastUsedMap.get(id) as number)) / 1000;
        if (elapsed < item.cooldown) return false;
      }
      item.effectFn();
      lastUsedMap.set(id, Date.now());
      const updated = new Map(mockInventory$.value);
      updated.set(id, qty - 1);
      mockInventory$.next(updated);
      return true;
    });

    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        { provide: GameEngineService, useValue: mockGameEngine },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: CosmeticsService, useValue: mockCosmeticsService },
        { provide: HangarLoadoutService, useValue: mockHangar },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: ConsumableService, useValue: mockConsumableService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ShopComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Consumables System', () => {
    it('should initialize consumable items', () => {
      expect(component.consumableItems.length).toBeGreaterThan(0);
      expect(component.consumableItems.find((item) => item.id === 'damage_boost')).toBeTruthy();
      expect(component.consumableItems.find((item) => item.id === 'heal_instant')).toBeTruthy();
    });

    it('should buy consumable when player has enough shards', () => {
      component.photonPoints = 200;
      const consumable = component.consumableItems[0];

      component.buyConsumable(consumable);

      expect(mockConsumableService.purchase).toHaveBeenCalledWith(consumable.id);
      expect(component.getConsumableQuantity(consumable.id)).toBe(1);
    });

    it('should not buy consumable when player lacks shards', () => {
      mockGameEngine.spendShards.and.returnValue(false);
      const consumable = component.consumableItems.find((item) => item.cost > 50)!;

      component.buyConsumable(consumable);

      expect(component.getConsumableQuantity(consumable.id)).toBe(0);
    });

    it('should use consumable and decrease quantity', () => {
      const consumable = component.consumableItems[0];
      const inv = new Map<string, number>([[consumable.id, 2]]);
      mockInventory$.next(inv);

      component.useConsumable(consumable);

      expect(mockConsumableService.use).toHaveBeenCalledWith(consumable.id);
      expect(component.getConsumableQuantity(consumable.id)).toBe(1);
    });

    it('should not use consumable when quantity is 0', () => {
      const consumable = component.consumableItems[0];
      mockInventory$.next(new Map([[consumable.id, 0]]));

      component.useConsumable(consumable);

      expect(component.getConsumableQuantity(consumable.id)).toBe(0);
    });

    it('should filter consumables by category', () => {
      component.filterConsumables('combat');

      const filtered = component.filteredConsumables;
      expect(filtered.every((item) => item.category === 'combat')).toBeTruthy();
    });

    it('should respect cooldowns on consumables', () => {
      const consumable = component.consumableItems.find((item) => item.cooldown)!;
      const inv = new Map<string, number>([[consumable.id, 2]]);
      mockInventory$.next(inv);

      // Use once
      component.useConsumable(consumable);
      const firstQuantity = component.getConsumableQuantity(consumable.id);

      // Try to use again immediately — mock respects cooldown
      component.useConsumable(consumable);

      // Should not decrease due to cooldown
      expect(component.getConsumableQuantity(consumable.id)).toBe(firstQuantity);
    });

    it('should apply damage boost buff when using power surge', () => {
      const powerSurge = component.consumableItems.find((item) => item.id === 'damage_boost')!;
      mockInventory$.next(new Map([[powerSurge.id, 1]]));

      component.useConsumable(powerSurge);

      expect(mockConsumableService.use).toHaveBeenCalledWith('damage_boost');
    });

    it('should heal player when using repair kit', () => {
      const repairKit = component.consumableItems.find((item) => item.id === 'heal_instant')!;
      mockInventory$.next(new Map([[repairKit.id, 1]]));

      component.useConsumable(repairKit);

      expect(mockConsumableService.use).toHaveBeenCalledWith('heal_instant');
    });
  });

  describe('Upgrades System', () => {
    it('should load the validated module snapshot', () => {
      mockHangar.getSnapshot.and.returnValue({
        version: 1,
        unlocks: { max_health: true, speed_boost: true },
        activeModuleId: 'speed_boost',
      });

      component.loadUpgradeLevels();

      const healthUpgrade = component.shopItems.find((item) => item.id === 'max_health');
      expect(healthUpgrade?.unlocked).toBeTrue();
      expect(component.activeModuleId).toBe('speed_boost');
    });

    it('should unlock and mount a module after purchase', () => {
      component.photonPoints = 500;
      const upgrade = component.shopItems[0];
      upgrade.unlocked = false;

      component.buyUpgrade(upgrade);

      expect(upgrade.unlocked).toBeTrue();
      expect(component.activeModuleId).toBe(upgrade.id);
      expect(mockGameEngine.spendShards).toHaveBeenCalledWith(upgrade.cost);
      expect(mockHangar.unlockAndEquip).toHaveBeenCalledOnceWith(upgrade.id);
    });

    it('should mount an unlocked module without charging again', () => {
      const upgrade = component.shopItems[0];
      upgrade.unlocked = true;
      component.activeModuleId = null;

      component.buyUpgrade(upgrade);

      expect(component.getModuleAction(upgrade)).toBe('Mounted');
      expect(mockHangar.equip).toHaveBeenCalledOnceWith(upgrade.id);
      expect(mockGameEngine.spendShards).not.toHaveBeenCalled();
    });

    it('rolls back an unlock and refunds shards when persistence fails', () => {
      const upgrade = component.shopItems.find((item) => item.id === 'critical_hits')!;
      component.photonPoints = 2000;
      upgrade.unlocked = false;
      mockHangar.unlockAndEquip.and.returnValue(false);

      component.buyUpgrade(upgrade);

      expect(upgrade.unlocked).toBeFalse();
      expect(component.activeModuleId).toBeNull();
      expect(mockGameEngine.refundShards).toHaveBeenCalledWith(upgrade.cost);
    });

    it('should ignore a locked module when the player cannot afford it', () => {
      const upgrade = component.shopItems[0];
      upgrade.unlocked = false;
      component.photonPoints = upgrade.cost - 1;

      component.buyUpgrade(upgrade);

      expect(upgrade.unlocked).toBeFalse();
      expect(mockGameEngine.spendShards).not.toHaveBeenCalled();
    });
  });

  describe('Tab Navigation', () => {
    it('should switch between tabs', () => {
      component.activeTab = 'Upgrades';
      expect(component.activeTab).toBe('Upgrades');

      component.activeTab = 'Consumables';
      expect(component.activeTab).toBe('Consumables');

      component.activeTab = 'Cosmetics';
      expect(component.activeTab).toBe('Cosmetics');
    });
  });

  describe('Game State Management', () => {
    it('should pause game when shop opens', () => {
      mockGameEngine.isPaused.and.returnValue(false);
      component.ngOnChanges({
        isVisible: {
          currentValue: true,
          previousValue: false,
          firstChange: false,
          isFirstChange: () => false,
        },
      });

      expect(mockPlayerService.setGameActive).toHaveBeenCalledWith(false);
      expect(mockGameEngine.pause).toHaveBeenCalled();
    });

    it('should resume game when shop closes if it was running', () => {
      interface ShopComponentWithPrivates {
        wasGameRunning: boolean;
      }
      (component as unknown as ShopComponentWithPrivates).wasGameRunning = true;
      component.ngOnChanges({
        isVisible: {
          currentValue: false,
          previousValue: true,
          firstChange: false,
          isFirstChange: () => false,
        },
      });

      expect(mockPlayerService.setGameActive).toHaveBeenCalledWith(true);
      expect(mockGameEngine.resume).toHaveBeenCalled();
    });
  });

  describe('Persistence', () => {
    it('should save owned consumables via service on purchase', () => {
      // Purchasing triggers the service which persists internally
      mockGameEngine.getShards.and.returnValue(500);
      const consumable = component.consumableItems[0];

      component.buyConsumable(consumable);

      // Verify the service purchase was called (service handles persistence)
      expect(mockConsumableService.purchase).toHaveBeenCalledWith(consumable.id);
    });

    it('should load owned consumables from service inventory', () => {
      // Simulate the service having loaded saved inventory
      const inv = new Map<string, number>([
        ['damage_boost', 2],
        ['speed_boost', 1],
      ]);
      mockInventory$.next(inv);

      expect(component.getConsumableQuantity('damage_boost')).toBe(2);
      expect(component.getConsumableQuantity('speed_boost')).toBe(1);
    });
  });

  describe('Cosmetic Ship Previews', () => {
    const shipShapeCosmetic: Cosmetic = {
      id: 'triangle',
      name: 'Triangle',
      description: 'A triangular ship.',
      type: 'shipShape',
      cost: 5000,
      unlocked: false,
    };
    const shipColorCosmetic: Cosmetic = {
      id: 'neon-blue',
      name: 'Neon Blue',
      description: 'Neon blue ship.',
      type: 'shipColor',
      cost: 1000,
      unlocked: false,
      colors: ['#00ddff'],
    };

    it('should return active ship color for shipShape fill color', () => {
      const activeColor: Cosmetic = {
        id: 'neon-blue',
        name: 'Neon Blue',
        description: '',
        type: 'shipColor',
        cost: 1000,
        unlocked: true,
        colors: ['#00ddff'],
      };
      mockCosmeticsService.getActiveCosmetic.and.returnValue(activeColor);

      const fill = component.getPreviewFillColor(shipShapeCosmetic);
      expect(fill).toBe('#00ddff');
    });

    it('should fall back to white when no active color has colors', () => {
      mockCosmeticsService.getActiveCosmetic.and.returnValue(undefined);

      const fill = component.getPreviewFillColor(shipShapeCosmetic);
      expect(fill).toBe('white');
    });

    it('should return cosmetic own color for shipColor fill color', () => {
      const fill = component.getPreviewFillColor(shipColorCosmetic);
      expect(fill).toBe('#00ddff');
    });

    it('should expose getPreviewFillColor for shipShape using active color', () => {
      // getPreviewFillColor for a shipShape item routes through getActiveCosmetic('shipColor')
      // Verified unit-level since DOM rendering involves OnPush + nested component init.
      const result = component.getPreviewFillColor(shipShapeCosmetic);
      // No active color cosmetic → fallback
      expect(result).toBe('white');
    });

    it('should expose getPreviewFillColor for shipColor returning own color', () => {
      const result = component.getPreviewFillColor(shipColorCosmetic);
      expect(result).toBe('#00ddff');
    });

    it('getPreviewShapeId returns active shape id from cosmetics service', () => {
      mockCosmeticsService.getActiveCosmeticId.and.returnValue('triangle');
      expect(component.getPreviewShapeId()).toBe('triangle');
    });

    it('getPreviewShapeId falls back to default-circle when service returns empty string', () => {
      mockCosmeticsService.getActiveCosmeticId.and.returnValue('');
      expect(component.getPreviewShapeId()).toBe('default-circle');
    });
  });
});
