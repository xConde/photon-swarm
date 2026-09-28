import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { PlayerService } from '../../core/player/player.service';
import { Cosmetic, CosmeticsService, CosmeticType } from '../../services/cosmetics.service';
import { DebugLogBridgeService } from '../../core/debug/debug-log-bridge.service';
import { ControlsDisplayComponent } from '@photon/components/controls-display/controls-display.component';
import { ConsumableItem, ConsumableService } from '../../services/consumable.service';
import { HangarLoadoutService } from '../../services/hangar-loadout.service';
import { ShipPreviewComponent } from './ship-preview.component';
import { HANGAR_MODULES, HangarModuleDefinition, HangarModuleId } from '../../config/hangar-module.config';

type ShopTab = 'Upgrades' | 'Consumables' | 'Cosmetics';

interface UpgradeItem extends HangarModuleDefinition {
  unlocked: boolean;
}

@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [CommonModule, ControlsDisplayComponent, ShipPreviewComponent],
  templateUrl: './shop.component.html',
  styleUrls: ['./shop.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @Input() isVisible = false;
  @Output() close = new EventEmitter<void>();

  photonPoints = 0;

  readonly tabs: readonly ShopTab[] = ['Upgrades', 'Consumables', 'Cosmetics'];
  activeTab: ShopTab = 'Upgrades';
  activeCosmeticCategory = 'shipColor'; // Default to Ship Colors instead of 'all'
  activeConsumableCategory = 'combat'; // Default consumable category

  // Track the previous game state to restore it when closing the shop
  private wasGameRunning = false;

  // Focus management (mirrors upgrade-modal pattern)
  private previouslyFocusedElement: HTMLElement | null = null;
  private tabTrapHandler: ((event: KeyboardEvent) => void) | null = null;

  activeModuleId: HangarModuleId | null = null;
  // Consumable items (delegated to ConsumableService)
  get consumableItems(): ReadonlyArray<Readonly<ConsumableItem>> {
    return this.consumableService.getAll();
  }
  get ownedConsumables(): Map<string, number> {
    return this.consumableService.inventory$.value;
  }

  readonly shopItems: UpgradeItem[] = HANGAR_MODULES.map((module) => ({ ...module, unlocked: false }));

  cosmeticCategories = [
    { id: 'shipColor', name: 'Ship Colors' },
    { id: 'beamColor', name: 'Beam Colors' },
    { id: 'shipShape', name: 'Ship Shapes' },
    { id: 'accessory', name: 'Accessories' },
  ];

  filteredCosmetics: Cosmetic[] = [];

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    public gameEngine: GameEngineService,
    private player: PlayerService,
    private cosmeticsService: CosmeticsService,
    private hangar: HangarLoadoutService,
    private debugLog: DebugLogBridgeService,
    private cdr: ChangeDetectorRef,
    private consumableService: ConsumableService
  ) {
    // Signal-based state read (Sprint A8b) — replaces the legacy
    // gameEngine.state$ subscription. Must run in an injection context
    // so it lives in the constructor body.
    effect(() => {
      // Touch the signal so the effect re-runs on every state change.
      this.gameEngine.state();
      this.updatePoints();
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    this.loadUpgradeLevels();
    this.loadCosmetics();
    this.consumableService.initialize();
    this.updatePoints();
  }

  ngAfterViewInit(): void {
    // Save element to restore focus to when shop closes
    this.previouslyFocusedElement = document.activeElement as HTMLElement;

    // Focus the dialog container so SR announces the dialog role immediately
    const container = this.elementRef.nativeElement.querySelector<HTMLElement>('.shop-container');
    if (container) {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    // Tab focus trap — keeps keyboard navigation inside the shop dialog
    this.tabTrapHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !this.isVisible) return;

      const c = this.elementRef.nativeElement;
      const focusable = c.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', this.tabTrapHandler);
  }

  ngOnDestroy(): void {
    if (this.tabTrapHandler) {
      document.removeEventListener('keydown', this.tabTrapHandler);
      this.tabTrapHandler = null;
    }
    if (this.previouslyFocusedElement?.isConnected && typeof this.previouslyFocusedElement.focus === 'function') {
      this.previouslyFocusedElement.focus();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When the shop becomes visible, pause the game
    if (changes['isVisible'] && changes['isVisible'].currentValue) {
      // Store current game state
      this.wasGameRunning = !this.gameEngine.isPaused();

      // Pause the game while the shop is open
      if (this.wasGameRunning) {
        this.player.setGameActive(false);
        this.gameEngine.pause();
      }
    } else if (changes['isVisible'] && !changes['isVisible'].currentValue && this.wasGameRunning) {
      // Resume the game if it was running before
      this.player.setGameActive(true);
      this.gameEngine.resume();
    }
  }

  /** Load the validated module snapshot. Legacy saves migrate inside the loadout service. */
  loadUpgradeLevels(): void {
    const loadout = this.hangar.getSnapshot();

    this.shopItems.forEach((item) => {
      item.unlocked = loadout.unlocks[item.id] === true;
    });
    this.activeModuleId = loadout.activeModuleId;
  }

  loadCosmetics(): void {
    const cosmetics = this.cosmeticsService.getCosmetics();

    // Add active status to cosmetics
    this.filteredCosmetics = cosmetics.map((cosmetic) => ({
      ...cosmetic,
      active: this.cosmeticsService.getActiveCosmeticId(cosmetic.type) === cosmetic.id,
      icon: cosmetic.icon || 'fas fa-question',
    }));

    // Filter to current category (defaults to shipColor on first load)
    this.filterCosmetics(this.activeCosmeticCategory);
  }

  updatePoints(): void {
    this.photonPoints = this.gameEngine.getShards();
  }

  filterCosmetics(category: string): void {
    this.activeCosmeticCategory = category;

    const filteredCosmetics = this.cosmeticsService.getCosmetics(category as CosmeticType);

    // Add active status to cosmetics
    this.filteredCosmetics = filteredCosmetics.map((cosmetic) => ({
      ...cosmetic,
      active: this.cosmeticsService.getActiveCosmeticId(cosmetic.type) === cosmetic.id,
      icon: cosmetic.icon || 'fas fa-question',
    }));
  }

  buyUpgrade(item: UpgradeItem): void {
    if (item.unlocked) {
      this.equipModule(item);
      return;
    }
    if (this.photonPoints < item.cost || !this.gameEngine.spendShards(item.cost)) return;

    if (!this.hangar.unlockAndEquip(item.id)) {
      this.gameEngine.refundShards(item.cost);
      this.debugLog.log('Hangar module purchase rolled back', 'error', { item: item.id });
      this.updatePoints();
      return;
    }

    item.unlocked = true;
    this.activeModuleId = item.id;
    this.updatePoints();
  }

  equipModule(item: UpgradeItem): void {
    if (!item.unlocked || this.activeModuleId === item.id) return;
    if (!this.hangar.equip(item.id)) {
      this.debugLog.log('Hangar module selection could not be saved', 'error', { item: item.id });
      return;
    }
    this.activeModuleId = item.id;
  }

  buyCosmeticItem(cosmetic: Cosmetic): void {
    if (!this.gameEngine.isPaused()) {
      // Don't allow buying during gameplay
      return;
    }

    const cost = cosmetic.cost;
    if (this.photonPoints >= cost && !cosmetic.unlocked) {
      // Use the gameEngine's spendShards method which exists
      if (this.gameEngine.spendShards(cost)) {
        this.cosmeticsService.unlockCosmetic(cosmetic.id);
        this.filterCosmetics(this.activeCosmeticCategory);
        this.updatePoints();
      }
    }
  }

  activateCosmetic(cosmetic: Cosmetic): void {
    if (cosmetic.unlocked) {
      this.cosmeticsService.setActiveCosmetic(cosmetic.type, cosmetic.id);

      // Update active status for all cosmetics of this type
      this.filteredCosmetics.forEach((c) => {
        if (c.type === cosmetic.type) {
          c.active = c.id === cosmetic.id;
        }
      });
    }
  }

  isActiveCosmetic(cosmetic: Cosmetic): boolean {
    return this.cosmeticsService.getActiveCosmeticId(cosmetic.type) === cosmetic.id;
  }

  /**
   * Returns the fill color (colors[0]) for ship-hull previews.
   * For shipShape items: uses the player's currently active ship color.
   * For shipColor items: uses the cosmetic's own colors[0].
   * Falls back to 'white' if no color data is available.
   */
  getPreviewFillColor(cosmetic: Cosmetic): string {
    if (cosmetic.type === 'shipShape') {
      const activeColorCosmetic = this.cosmeticsService.getActiveCosmetic('shipColor');
      return activeColorCosmetic?.colors?.[0] ?? 'white';
    }
    // shipColor: show that color's own first color
    return cosmetic.colors?.[0] ?? 'white';
  }

  /**
   * Returns the active ship shape ID for shipColor previews
   * so the canvas shows the hull the player actually uses.
   */
  getPreviewShapeId(): string {
    return this.cosmeticsService.getActiveCosmeticId('shipShape') || 'default-circle';
  }

  getModuleAction(item: UpgradeItem): string {
    if (this.activeModuleId === item.id) return 'Mounted';
    if (item.unlocked) return 'Mount';
    return `Unlock · ${item.cost}`;
  }

  /** Stable, lowercase DOM-safe key for a tab label (used in id/aria-controls). */
  tabKey(tab: ShopTab): string {
    return tab.toLowerCase();
  }

  onTablistKeydown(event: KeyboardEvent): void {
    const current = this.tabs.indexOf(this.activeTab);
    let next: number;

    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.activeTab = this.tabs[next];
    this.cdr.markForCheck();

    // Move DOM focus to the newly selected tab button
    const tabEl = this.elementRef.nativeElement.querySelector<HTMLElement>(`#shop-tab-${this.tabKey(this.activeTab)}`);
    tabEl?.focus();
  }

  closeShop(): void {
    this.close.emit();
  }

  // Handle click on cosmetic item based on its state
  handleCosmeticClick(cosmetic: Cosmetic): void {
    if (!cosmetic.unlocked) {
      // If not unlocked, try to buy it
      this.buyCosmeticItem(cosmetic);
    } else if (!this.isActiveCosmetic(cosmetic)) {
      // If unlocked but not active, activate it
      this.activateCosmetic(cosmetic);
    }
    // If already active, do nothing
  }

  // Buy a consumable item
  buyConsumable(item: ConsumableItem): void {
    if (this.consumableService.purchase(item.id)) {
      this.updatePoints();
    }
  }

  // Use a consumable item
  useConsumable(item: ConsumableItem): void {
    this.consumableService.use(item.id);
  }

  // Get quantity of owned consumables
  getConsumableQuantity(itemId: string): number {
    return this.consumableService.getQuantity(itemId);
  }

  // Filter consumables by category
  filterConsumables(category: string): void {
    this.activeConsumableCategory = category;
  }

  // Get filtered consumables
  get filteredConsumables(): ConsumableItem[] {
    return this.consumableItems.filter((item) => item.category === this.activeConsumableCategory);
  }
}
