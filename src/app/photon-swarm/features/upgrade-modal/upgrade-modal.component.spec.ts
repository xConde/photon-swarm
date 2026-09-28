import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatPreview, UpgradeModalComponent } from './upgrade-modal.component';
import { UpgradeService } from '../../services/upgrade.service';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { ProgressionSystemService } from '../../core/progression/progression-system.service';
import { PlayerUpgradesService } from '../../core/player/player-upgrades.service';
import { UpgradeOption } from '../../core/models/upgrade.model';
import { RunDraftService } from '../../services/run-draft.service';

describe('UpgradeModalComponent', () => {
  let component: UpgradeModalComponent;
  let fixture: ComponentFixture<UpgradeModalComponent>;
  let mockUpgradeService: jasmine.SpyObj<UpgradeService>;
  let mockGameEngine: jasmine.SpyObj<GameEngineService>;
  let mockProgressionSystem: jasmine.SpyObj<ProgressionSystemService>;
  let mockPlayerUpgrades: jasmine.SpyObj<PlayerUpgradesService>;
  let mockRunDraft: jasmine.SpyObj<RunDraftService>;

  const makeUpgrade = (id: string, rarity: string = 'common', type: string = 'upgrade'): UpgradeOption => ({
    id,
    name: `Test ${id}`,
    description: `Description for ${id}`,
    effect: jasmine.createSpy(`effect_${id}`),
    type: type as UpgradeOption['type'],
    rarity: rarity as UpgradeOption['rarity'],
  });

  beforeEach(async () => {
    mockUpgradeService = jasmine.createSpyObj('UpgradeService', ['getRandomUpgrades', 'getCount', 'incCount', 'apply']);
    mockUpgradeService.getRandomUpgrades.and.returnValue([]);
    mockUpgradeService.getCount.and.returnValue(0);
    mockUpgradeService.apply.and.returnValue(true);

    mockGameEngine = jasmine.createSpyObj('GameEngineService', ['getShards', 'spendShards', 'heal', 'emitState']);
    mockGameEngine.getShards.and.returnValue(100);

    mockProgressionSystem = jasmine.createSpyObj('ProgressionSystemService', [], { level: 5 });

    mockPlayerUpgrades = jasmine.createSpyObj('PlayerUpgradesService', [
      'getSpeedMultiplier',
      'getBeamDamageMultiplier',
      'getMaxHealth',
      'getShardMagnetismBonus',
      'getFireRateMultiplier',
      'getBurnChance',
      'getCriticalHitChance',
    ]);
    mockPlayerUpgrades.getSpeedMultiplier.and.returnValue(1.0);
    mockPlayerUpgrades.getBeamDamageMultiplier.and.returnValue(1.0);
    mockPlayerUpgrades.getMaxHealth.and.returnValue(100);
    mockPlayerUpgrades.getShardMagnetismBonus.and.returnValue(0);
    mockPlayerUpgrades.getFireRateMultiplier.and.returnValue(1.0);
    mockPlayerUpgrades.getBurnChance.and.returnValue(0);
    mockPlayerUpgrades.getCriticalHitChance.and.returnValue(0);

    mockRunDraft = jasmine.createSpyObj<RunDraftService>('RunDraftService', ['getRemaining', 'consume']);
    mockRunDraft.getRemaining.and.returnValue(1);
    mockRunDraft.consume.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [UpgradeModalComponent],
      providers: [
        { provide: UpgradeService, useValue: mockUpgradeService },
        { provide: GameEngineService, useValue: mockGameEngine },
        { provide: ProgressionSystemService, useValue: mockProgressionSystem },
        { provide: PlayerUpgradesService, useValue: mockPlayerUpgrades },
        { provide: RunDraftService, useValue: mockRunDraft },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UpgradeModalComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not restore focus to a trigger that was removed while the modal was open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    fixture.detectChanges();

    trigger.remove();
    const focusSpy = spyOn(trigger, 'focus');
    fixture.destroy();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('renders every standard rarity with a distinct schematic classification', () => {
    const rarities: UpgradeOption['rarity'][] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    component.upgradeOptions = rarities.map((rarity) => makeUpgrade(`card_${rarity}`, rarity));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const cards = Array.from(host.querySelectorAll<HTMLElement>('.upgrade-card'));
    expect(cards.length).toBe(rarities.length);
    rarities.forEach((rarity, index) => {
      expect(cards[index].classList.contains(`rarity-${rarity}`)).toBeTrue();
      expect(cards[index].querySelector('.classification')?.textContent?.trim()).toBe(rarity);
    });
  });

  it('presents the opening cores as distinct weapon identities with explicit tradeoffs', () => {
    const cores = ['lance', 'prism', 'arc'].map((core) => {
      const option = makeUpgrade(`beam_core_${core}`, 'core');
      option.category = 'beam-core';
      option.designation = core.toUpperCase();
      option.signature = `${core} firing pattern`;
      option.tradeoff = `${core} handling cost`;
      option.buildTags = ['beam'];
      return option;
    });
    component.upgradeOptions = cores;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#upgrade-heading')?.textContent).toContain('Choose your beam');
    expect(host.querySelector('.upgrade-count')?.textContent).toContain('Permanent for this run');
    expect(host.querySelectorAll('.core-blueprint').length).toBe(3);
    expect(host.querySelector('.beam-core-lance')).not.toBeNull();
    expect(host.querySelector('.beam-core-prism')).not.toBeNull();
    expect(host.querySelector('.beam-core-arc')).not.toBeNull();
    expect(host.querySelector('.core-tradeoff')?.textContent).toContain('handling cost');
  });

  it('gives route commitments and relic salvage their own authored ceremonies', () => {
    const route = makeUpgrade('route_azure_bastion', 'rare');
    route.category = 'route';
    route.designation = 'ROUTE 02 / PROTECTORATE';
    route.signature = 'Defensive passage';
    route.tradeoff = 'Slower movement';
    component.upgradeOptions = [route];
    fixture.detectChanges();

    let host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#upgrade-heading')?.textContent).toContain('Choose a route');
    expect(host.querySelector('.route-card')).not.toBeNull();
    expect(host.querySelector('.artifact-designation')?.textContent).toContain('ROUTE 02');

    fixture.destroy();
    fixture = TestBed.createComponent(UpgradeModalComponent);
    component = fixture.componentInstance;
    const relic = makeUpgrade('relic_mobius_lens', 'legendary');
    relic.category = 'relic';
    relic.designation = 'OPTIC / IMPOSSIBLE';
    relic.signature = 'Double beam';
    relic.tradeoff = 'Less damage';
    component.upgradeOptions = [relic];
    fixture.detectChanges();

    host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#upgrade-heading')?.textContent).toContain('Claim a relic');
    expect(host.querySelector('.relic-card')).not.toBeNull();
  });

  it('presents sector anomalies as irreversible world contracts with visible pressure', () => {
    const anomaly = makeUpgrade('anomaly_glass_orbit', 'legendary');
    anomaly.category = 'anomaly';
    anomaly.designation = 'FIELD / VOLATILE';
    anomaly.signature = '+40% beam damage';
    anomaly.tradeoff = 'Enemy attacks deal 35% more damage';
    component.upgradeOptions = [anomaly];

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#upgrade-heading')?.textContent).toContain('Choose what changes');
    expect(host.querySelector('.upgrade-count')?.textContent).toContain('field will remember');
    expect(host.querySelector('.anomaly-card')).not.toBeNull();
    expect(host.querySelector('.mutation-doctrine small')?.textContent).toContain('Enemy attacks');
  });

  it('spends a run refit to redraw ordinary upgrade signals', () => {
    component.upgradeOptions = [makeUpgrade('core_power', 'core')];
    fixture.detectChanges();
    const replacement = makeUpgrade('beam_damage', 'uncommon');
    mockUpgradeService.getRandomUpgrades.and.returnValue([replacement]);

    component.rerollOptions();

    expect(mockRunDraft.consume).toHaveBeenCalled();
    expect(component.options).toEqual([replacement]);
  });

  it('keeps the dialog labelled when a curse or blessing opens its detail state', () => {
    const curse = makeUpgrade('vulnerability', 'curse', 'curse');
    component.upgradeOptions = [curse];
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    if (!dialog) {
      return;
    }
    expect(dialog.getAttribute('aria-labelledby')).toBe('upgrade-heading');
    expect(host.querySelector('#upgrade-heading')).not.toBeNull();

    host.querySelector<HTMLElement>('.upgrade-card')?.click();
    fixture.detectChanges();

    const detailDialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(detailDialog?.getAttribute('aria-labelledby')).toBe('upgrade-detail-heading');
    expect(host.querySelector('#upgrade-detail-heading')).not.toBeNull();
  });

  it('closes only after a normal upgrade applies successfully', () => {
    const upgrade = makeUpgrade('core_power', 'core');
    spyOn(component.upgradeChosen, 'emit');

    component.chooseUpgrade(upgrade);

    expect(mockUpgradeService.apply).toHaveBeenCalledWith(upgrade, mockGameEngine);
    expect(component.upgradeChosen.emit).toHaveBeenCalledWith(upgrade);
  });

  it('shows an accessible failure and prevents blind retries when application fails', () => {
    const upgrade = makeUpgrade('core_power', 'core');
    mockUpgradeService.apply.and.returnValue(false);
    spyOn(component.upgradeChosen, 'emit');

    component.upgradeOptions = [upgrade];
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.upgrade-card') as HTMLElement;
    card.click();
    fixture.detectChanges();

    expect(component.upgradeChosen.emit).not.toHaveBeenCalled();
    expect(component.applicationError).toContain(upgrade.name);
    expect(component.isApplicationFailed(upgrade)).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(upgrade.name);
    expect(card.getAttribute('aria-disabled')).toBe('true');

    card.click();
    expect(mockUpgradeService.apply).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss a mandatory reward with Escape', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    spyOn(event, 'stopPropagation');
    spyOn(component.upgradeChosen, 'emit');

    component.onEscape(event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.upgradeChosen.emit).not.toHaveBeenCalled();
  });

  it('routes curse confirmation through the same transactional apply path', () => {
    const curse = makeUpgrade('vulnerability', 'curse', 'curse');
    curse.severity = 'high';
    component.selectedCurse = curse;
    spyOn(component.upgradeChosen, 'emit');

    component.confirmSelection();

    expect(mockUpgradeService.apply).toHaveBeenCalledWith(curse, mockGameEngine);
    expect(component.upgradeChosen.emit).toHaveBeenCalledWith(curse);
  });

  it('returns from a failed curse confirmation and disables the failed reward', () => {
    const curse = makeUpgrade('vulnerability', 'curse', 'curse');
    mockUpgradeService.apply.and.returnValue(false);
    component.selectedCurse = curse;
    component.showingCurseConfirmation = true;
    spyOn(component.upgradeChosen, 'emit');
    spyOn(component.curseConfirmationVisible, 'emit');

    component.confirmSelection();

    expect(component.applicationError).toContain(curse.name);
    expect(component.isApplicationFailed(curse)).toBeTrue();
    expect(component.selectedCurse).toBeNull();
    expect(component.showingCurseConfirmation).toBeFalse();
    expect(component.upgradeChosen.emit).not.toHaveBeenCalled();
    expect(component.curseConfirmationVisible.emit).toHaveBeenCalledWith(false);
  });

  describe('Cache Invalidation', () => {
    it('should clear caches when upgrades change', () => {
      // Provide initial upgrades and init the component
      const initialUpgrades = [makeUpgrade('core_speed', 'core'), makeUpgrade('beam_damage')];
      component.upgradeOptions = initialUpgrades;
      component.ngOnInit();

      // Verify caches are populated
      expect(component.getStatPreview(initialUpgrades[0])).toBeTruthy();
      expect(component.getCoreBenefit(initialUpgrades[0])).toBeTruthy();

      // Simulate changing options and refreshing caches
      const newUpgrades = [makeUpgrade('core_power', 'core'), makeUpgrade('fire_rate_boost')];
      component.upgradeOptions = newUpgrades;
      component.options = newUpgrades;

      // Access private refreshOptionCaches through a typed interface
      interface UpgradeModalWithPrivates {
        refreshOptionCaches: () => void;
      }
      (component as unknown as UpgradeModalWithPrivates).refreshOptionCaches();

      // Old upgrade IDs should no longer have cached values
      expect(component.getStatPreview(initialUpgrades[0])).toBeNull();
      expect(component.getCoreBenefit(initialUpgrades[0])).toBe('');
      expect(component.getCoreIcon(initialUpgrades[0])).toBe('');

      // New upgrade IDs should have cached values
      expect(component.getStatPreview(newUpgrades[0])).toBeTruthy();
      expect(component.getCoreBenefit(newUpgrades[0])).toBeTruthy();
    });

    it('should rebuild caches with new upgrade data', () => {
      // Provide core upgrades that generate stat previews
      const upgrades = [
        makeUpgrade('core_speed', 'core'),
        makeUpgrade('core_power', 'core'),
        makeUpgrade('core_shield', 'core'),
      ];
      component.upgradeOptions = upgrades;
      component.ngOnInit();

      // Verify each core upgrade has a cached stat preview
      const speedPreview = component.getStatPreview(upgrades[0]);
      expect(speedPreview).toBeTruthy();
      expect((speedPreview as StatPreview).label).toBe('Speed');

      const powerPreview = component.getStatPreview(upgrades[1]);
      expect(powerPreview).toBeTruthy();
      expect((powerPreview as StatPreview).label).toBe('Damage');

      const shieldPreview = component.getStatPreview(upgrades[2]);
      expect(shieldPreview).toBeTruthy();
      expect((shieldPreview as StatPreview).label).toBe('Max HP');

      // Verify core benefits are also cached
      expect(component.getCoreBenefit(upgrades[0])).toContain('%');
      expect(component.getCoreBenefit(upgrades[1])).toContain('%');
      expect(component.getCoreBenefit(upgrades[2])).toContain('HP');

      // Now rebuild with different upgrades
      const newUpgrades = [makeUpgrade('core_magnet', 'core')];
      component.options = newUpgrades;

      interface UpgradeModalWithPrivates {
        refreshOptionCaches: () => void;
      }
      (component as unknown as UpgradeModalWithPrivates).refreshOptionCaches();

      // Old caches should be cleared
      expect(component.getStatPreview(upgrades[0])).toBeNull();
      expect(component.getStatPreview(upgrades[1])).toBeNull();

      // New cache should be populated
      const magnetPreview = component.getStatPreview(newUpgrades[0]);
      expect(magnetPreview).toBeTruthy();
      expect((magnetPreview as StatPreview).label).toBe('Range');
    });

    it('should handle empty upgrades array', () => {
      // Start with some upgrades
      const upgrades = [makeUpgrade('core_speed', 'core')];
      component.upgradeOptions = upgrades;
      component.ngOnInit();

      expect(component.getStatPreview(upgrades[0])).toBeTruthy();

      // Refresh with empty options
      component.options = [];

      interface UpgradeModalWithPrivates {
        refreshOptionCaches: () => void;
      }
      (component as unknown as UpgradeModalWithPrivates).refreshOptionCaches();

      // All caches should be empty -- old entries cleared
      expect(component.getStatPreview(upgrades[0])).toBeNull();
      expect(component.getCoreBenefit(upgrades[0])).toBe('');
      expect(component.getCoreIcon(upgrades[0])).toBe('');
    });

    it('should return empty string for non-core upgrade benefits and icons', () => {
      const commonUpgrade = makeUpgrade('beam_damage', 'common');
      component.upgradeOptions = [commonUpgrade];
      component.ngOnInit();

      expect(component.getCoreBenefit(commonUpgrade)).toBe('');
      expect(component.getCoreIcon(commonUpgrade)).toBe('');
    });

    it('should return null stat preview for upgrades without preview logic', () => {
      const unknownUpgrade = makeUpgrade('unknown_upgrade', 'common');
      component.upgradeOptions = [unknownUpgrade];
      component.ngOnInit();

      expect(component.getStatPreview(unknownUpgrade)).toBeNull();
    });
  });
});
