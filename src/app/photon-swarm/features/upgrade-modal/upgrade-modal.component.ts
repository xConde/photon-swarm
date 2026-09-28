import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { UpgradeService } from '../../services/upgrade.service';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { UpgradeOption } from '../../core/models/upgrade.model';
import { ControlsDisplayComponent } from '@photon/components/controls-display/controls-display.component';
import { getUpgradeIconByID } from '../../utils/upgrade-icons';
import { CORE_UPGRADE_EFFECTS, UPGRADE_EFFECTS } from '@photon/config/game-constants';
import { ProgressionSystemService } from '../../core/progression/progression-system.service';
import { PlayerUpgradesService } from '../../core/player/player-upgrades.service';
import { RunDraftService } from '../../services/run-draft.service';

/** Stat preview data for showing "Current → After" values */
export interface StatPreview {
  label: string;
  current: string;
  after: string;
  change: string;
}

@Component({
  selector: 'app-upgrade-modal',
  standalone: true,
  imports: [CommonModule, ControlsDisplayComponent],
  templateUrl: './upgrade-modal.component.html',
  styleUrls: ['./upgrade-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpgradeModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() upgradeOptions: UpgradeOption[] = [];
  @Output() upgradeChosen = new EventEmitter<UpgradeOption>();
  @Output() curseConfirmationVisible = new EventEmitter<boolean>();

  selectedUpgrade: UpgradeOption | null = null;
  selectedCurse: UpgradeOption | null = null;
  applicationError: string | null = null;
  showHiddenEffect: boolean = false;
  hiddenEffectRevealCost: number = 50;
  options: UpgradeOption[] = [];

  // Curse and blessing management variables
  revealedEffects: Set<string> = new Set<string>();
  showingCurseConfirmation = false;

  // Current shards display
  currentShards = 0;

  // Current player level
  currentLevel = 1;
  isBeamCoreSelection = false;
  isRelicSelection = false;
  isRouteSelection = false;
  isAnomalySelection = false;
  selectionConsole = 'REFIT TERMINAL';
  selectionTitle = 'Choose an Upgrade';
  selectionCount = '';
  selectionNote = '';

  // Active tab for UI
  activeTab: 'upgrade' | 'curse' | 'blessing' = 'upgrade';

  /**
   * Pre-computed caches for template lookups, populated once when options are set via `refreshOptionCaches()`.
   * Avoids recalculating stat previews, benefit strings, and SVG icon markup on every change detection cycle.
   * - `statPreviews`: "Current -> After" preview for each upgrade option
   * - `coreBenefits`: formatted benefit text (e.g. "+12%") for Core-tier upgrades
   * - `coreIcons`: SVG markup for Core-tier upgrade icons
   */
  private statPreviews = new Map<string, StatPreview | null>();
  private coreBenefits = new Map<string, string>();
  private coreIcons = new Map<string, SafeHtml | string>();
  private buildContexts = new Map<string, string>();
  private failedOptionIds = new Set<string>();

  // Event listener cleanup
  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;
  private tabTrapHandler: ((event: KeyboardEvent) => void) | null = null;
  private previouslyFocusedElement: HTMLElement | null = null;

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private upgradeService: UpgradeService,
    private gameEngine: GameEngineService,
    private progressionSystem: ProgressionSystemService,
    private playerUpgrades: PlayerUpgradesService,
    private runDraft: RunDraftService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    // Setup escape key handler manually to ensure cleanup
    this.escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.onEscape(event);
      }
    };
    document.addEventListener('keydown', this.escapeHandler);

    // If upgradeOptions were provided from parent component, use those
    if (this.upgradeOptions && this.upgradeOptions.length > 0) {
      this.options = this.upgradeOptions;
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Upgrade modal using provided options', 'info', {
          source: 'upgrade_modal_component',
          optionCount: this.options.length,
          operation: 'using_provided_options',
        });
      }
    } else {
      // Otherwise generate our own random set
      this.options = this.upgradeService.getRandomUpgrades(3);
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Upgrade modal generating random options', 'info', {
          source: 'upgrade_modal_component',
          optionCount: this.options.length,
          operation: 'generating_options',
        });
      }
    }

    // If we still have no options (perhaps due to a bug), create emergency backup options
    if (!this.options || this.options.length === 0) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('No upgrade options available! Creating emergency options', 'warning', {
          source: 'upgrade_modal_component',
          operation: 'emergency_fallback',
        });
      }

      // Create a basic health regen upgrade as emergency fallback
      const fallbackUpgrade: UpgradeOption = {
        id: 'health_regen',
        name: 'Emergency Shield Repair',
        description: 'Restore some of your shield integrity',
        effect: (gameEngine: GameEngineService) => {
          gameEngine.heal(1);
        },
        type: 'upgrade',
        rarity: 'common',
      };

      this.options = [fallbackUpgrade];
    }

    // Update current shards and level display
    this.currentShards = this.gameEngine.getShards();
    this.currentLevel = this.progressionSystem.level;

    // Pre-compute cached values for template lookups
    this.refreshOptionCaches();
  }

  /**
   * Rebuilds all template-lookup caches for the current set of upgrade options.
   * Called once in `ngOnInit` after options are resolved; the caches are stable
   * for the lifetime of the modal since the option list does not change after init.
   */
  private refreshOptionCaches(): void {
    this.isBeamCoreSelection =
      this.options.length > 0 && this.options.every((option) => option.category === 'beam-core');
    this.isRelicSelection = this.options.length > 0 && this.options.every((option) => option.category === 'relic');
    this.isRouteSelection = this.options.length > 0 && this.options.every((option) => option.category === 'route');
    this.isAnomalySelection = this.options.length > 0 && this.options.every((option) => option.category === 'anomaly');
    if (this.isBeamCoreSelection) {
      this.selectionConsole = 'CORE IMPRINT / FIRST BINDING';
      this.selectionTitle = 'Choose your beam';
      this.selectionCount = 'Permanent for this run';
      this.selectionNote = 'This choice changes your firing pattern now and the evolutions you can find later.';
    } else if (this.isRouteSelection) {
      this.selectionConsole = 'NAVIGATION / BRANCH COMMIT';
      this.selectionTitle = 'Choose a route';
      this.selectionCount = 'The other passage will close';
      this.selectionNote = 'Your route determines the next sector, its allied faction, and the pressure on your build.';
    } else if (this.isRelicSelection) {
      this.selectionConsole = 'SALVAGE VAULT / SECTOR CLEAR';
      this.selectionTitle = 'Claim a relic';
      this.selectionCount = `${this.options.length} recovered artifacts`;
      this.selectionNote = 'Relics stay for this run and can bend the rules of your current build.';
    } else if (this.isAnomalySelection) {
      this.selectionConsole = 'SECTOR ANOMALY / IRREVERSIBLE';
      this.selectionTitle = 'Choose what changes';
      this.selectionCount = 'The field will remember';
      this.selectionNote = 'Each contract changes both your ship and every encounter for the rest of this run.';
    } else {
      this.selectionConsole = `REFIT TERMINAL / LV ${this.currentLevel}`;
      this.selectionTitle = 'Choose an Upgrade';
      this.selectionCount = `${this.options.length} compatible signals`;
      this.selectionNote = '';
    }
    this.statPreviews.clear();
    this.coreBenefits.clear();
    this.coreIcons.clear();
    this.buildContexts.clear();

    this.options.forEach((option) => {
      this.statPreviews.set(option.id, this.computeStatPreview(option));
      this.coreBenefits.set(option.id, this.computeCoreBenefit(option));
      this.coreIcons.set(option.id, this.computeCoreIcon(option));
      this.buildContexts.set(option.id, this.computeBuildContext(option));
    });
  }

  getBuildContext(option: UpgradeOption): string {
    return this.buildContexts.get(option.id) ?? '';
  }

  get rerollsRemaining(): number {
    return this.runDraft.getRemaining();
  }

  get canReroll(): boolean {
    return (
      !this.isBeamCoreSelection &&
      !this.isRelicSelection &&
      !this.isRouteSelection &&
      !this.isAnomalySelection &&
      this.rerollsRemaining > 0
    );
  }

  rerollOptions(): void {
    if (!this.canReroll || !this.runDraft.consume()) return;
    this.options = this.upgradeService.getRandomUpgrades(3);
    this.selectedCurse = null;
    this.applicationError = null;
    this.refreshOptionCaches();
  }

  private computeBuildContext(option: UpgradeOption): string {
    if (option.category === 'relic') return 'RUN RELIC';
    if (option.category === 'route') return 'ROUTE COMMITMENT';
    if (option.category === 'anomaly') return 'SECTOR CONTRACT';
    const ownedStacks = this.upgradeService.getCount(option.id);
    if (ownedStacks > 0) return `STACK ${ownedStacks + 1}`;
    if (option.prerequisites?.length) {
      const parentNames = option.prerequisites
        .filter((id) => this.upgradeService.getCount(id) > 0)
        .map((id) => this.upgradeService.upgradeOptions.find((candidate) => candidate.id === id)?.name ?? id);
      if (parentNames.length > 0) return `EVOLVES ${parentNames.join(' / ')}`;
    }
    if (option.rarity === 'core') return 'FOUNDATION';
    if (option.rarity === 'uncommon') return 'SPECIALIZATION';
    return '';
  }

  ngAfterViewInit(): void {
    // Save currently focused element for restoration
    this.previouslyFocusedElement = document.activeElement as HTMLElement;

    // Focus the dialog container
    const container = this.elementRef.nativeElement.querySelector('.upgrade-container') as HTMLElement;
    if (container) {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    // Set up focus trap
    this.tabTrapHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = this.elementRef.nativeElement.querySelectorAll<HTMLElement>(
        'button, [href], [tabindex]:not([tabindex="-1"]), .upgrade-card'
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

  chooseUpgrade(option: UpgradeOption): void {
    if (this.isApplicationFailed(option)) return;

    // If this is a normal upgrade, apply immediately
    if (option.type === 'upgrade') {
      if (this.upgradeService.apply(option, this.gameEngine)) {
        this.upgradeChosen.emit(option);
      } else {
        this.markApplicationFailure(option);
      }
      return;
    }

    // For curses and blessings, show confirmation dialog
    this.applicationError = null;
    this.selectedCurse = option;
    this.showingCurseConfirmation = true;
    this.showHiddenEffect = this.isEffectRevealed(option);
    this.curseConfirmationVisible.emit(true);
  }

  cancelSelection(): void {
    this.selectedCurse = null;
    this.showingCurseConfirmation = false;
    this.curseConfirmationVisible.emit(false);
  }

  confirmSelection(): void {
    if (this.selectedCurse) {
      const selected = this.selectedCurse;
      if (!this.upgradeService.apply(selected, this.gameEngine)) {
        this.markApplicationFailure(selected);
        this.cancelSelection();
        return;
      }

      // Close dialog and notify parent
      this.selectedCurse = null;
      this.showingCurseConfirmation = false;
      this.curseConfirmationVisible.emit(false);
      this.upgradeChosen.emit(selected);
    }
  }

  isApplicationFailed(option: UpgradeOption): boolean {
    return this.failedOptionIds.has(option.id);
  }

  private markApplicationFailure(option: UpgradeOption): void {
    this.failedOptionIds.add(option.id);
    this.applicationError = `${option.name} could not be installed. Choose another reward.`;
  }

  revealEffect(option: UpgradeOption): void {
    if ((option.type !== 'curse' && option.type !== 'blessing') || this.isEffectRevealed(option)) {
      return;
    }

    // Calculate cost
    const revealCost = this.calculateRevealCost();

    // Check if player has enough shards
    if (this.currentShards >= revealCost) {
      // Deduct shards
      this.gameEngine.spendShards(revealCost);

      // Update the current shards display
      this.currentShards = this.gameEngine.getShards();

      // Mark as revealed
      this.revealedEffects.add(option.id);

      // Emit an event to update the game state for background HUD
      this.gameEngine.emitState();
    }
  }

  calculateRevealCost(): number {
    // Calculate cost (5% of current shards, minimum 5)
    return Math.max(5, Math.floor(this.currentShards * 0.05));
  }

  isEffectRevealed(option: UpgradeOption): boolean {
    return (option.type !== 'curse' && option.type !== 'blessing') || this.revealedEffects.has(option.id);
  }

  // Removed @HostListener to prevent memory leak
  onEscape(event: KeyboardEvent): void {
    // Stop propagation to prevent parent component from handling the same event
    event.stopPropagation();

    if (this.showingCurseConfirmation || this.selectedCurse) {
      this.cancelSelection();
      return;
    }

    // Level-up rewards are mandatory; Escape only backs out of the detail view.
  }

  // HTML template method aliases to ensure compatibility
  revealSelectedHiddenEffect(): void {
    if (this.selectedCurse) {
      this.revealEffect(this.selectedCurse);
      this.showHiddenEffect = true;
    }
  }

  cancelDetailSelection(): void {
    this.cancelSelection();
  }

  confirmCurseFromDetail(): void {
    this.confirmSelection();
  }

  /**
   * Get sanitized SVG icon markup for core-tier upgrades (cached lookup).
   * Returns empty string if no icon is mapped.
   */
  getCoreIcon(upgrade: UpgradeOption): SafeHtml | string {
    return this.coreIcons.get(upgrade.id) ?? '';
  }

  /** Compute sanitized SVG icon markup — bypasses Angular's HTML sanitizer for trusted SVG */
  private computeCoreIcon(upgrade: UpgradeOption): SafeHtml | string {
    if (upgrade.rarity !== 'core') return '';
    const svg = getUpgradeIconByID(upgrade.id);
    return svg ? this.sanitizer.bypassSecurityTrustHtml(svg) : '';
  }

  /**
   * Get the benefit value text for Core tier upgrades (cached lookup)
   * Returns formatted text like "+12%" or "+25 HP"
   */
  getCoreBenefit(upgrade: UpgradeOption): string {
    return this.coreBenefits.get(upgrade.id) ?? '';
  }

  /** Compute the benefit value text for Core tier upgrades */
  private computeCoreBenefit(upgrade: UpgradeOption): string {
    if (upgrade.rarity !== 'core') {
      return '';
    }
    if (upgrade.category === 'beam-core') return upgrade.designation ?? 'CORE';
    switch (upgrade.id) {
      case 'core_speed':
        return `+${CORE_UPGRADE_EFFECTS.SPEED.INCREASE_PERCENT}%`;
      case 'core_power':
        return `+${CORE_UPGRADE_EFFECTS.POWER.INCREASE_PERCENT}%`;
      case 'core_shield':
        return `+${CORE_UPGRADE_EFFECTS.SHIELD.INCREASE_AMOUNT} HP`;
      case 'core_magnet':
        return `+${CORE_UPGRADE_EFFECTS.MAGNET.INCREASE_RANGE}`;
      default:
        return '';
    }
  }

  /**
   * Get stat preview showing "Current -> After" for upgrades (cached lookup)
   * Returns null if no meaningful preview is available
   */
  getStatPreview(upgrade: UpgradeOption): StatPreview | null {
    return this.statPreviews.get(upgrade.id) ?? null;
  }

  /** Compute stat preview showing "Current -> After" for upgrades */
  private computeStatPreview(upgrade: UpgradeOption): StatPreview | null {
    switch (upgrade.id) {
      // Core tier upgrades
      case 'core_speed': {
        const currentMult = this.playerUpgrades.getSpeedMultiplier();
        const increase = CORE_UPGRADE_EFFECTS.SPEED.INCREASE_PERCENT / 100;
        const afterMult = currentMult * (1 + increase);
        return {
          label: 'Speed',
          current: `${Math.round(currentMult * 100)}%`,
          after: `${Math.round(afterMult * 100)}%`,
          change: `+${CORE_UPGRADE_EFFECTS.SPEED.INCREASE_PERCENT}%`,
        };
      }
      case 'core_power': {
        const currentMult = this.playerUpgrades.getBeamDamageMultiplier();
        const increase = CORE_UPGRADE_EFFECTS.POWER.INCREASE_PERCENT / 100;
        const afterMult = currentMult * (1 + increase);
        return {
          label: 'Damage',
          current: `${Math.round(currentMult * 100)}%`,
          after: `${Math.round(afterMult * 100)}%`,
          change: `+${CORE_UPGRADE_EFFECTS.POWER.INCREASE_PERCENT}%`,
        };
      }
      case 'core_shield': {
        const currentHP = this.playerUpgrades.getMaxHealth();
        const afterHP = currentHP + CORE_UPGRADE_EFFECTS.SHIELD.INCREASE_AMOUNT;
        return {
          label: 'Max HP',
          current: `${currentHP}`,
          after: `${afterHP}`,
          change: `+${CORE_UPGRADE_EFFECTS.SHIELD.INCREASE_AMOUNT}`,
        };
      }
      case 'core_magnet': {
        // Base magnetism range is 150 (from shard-magnetism-system.service.ts)
        const BASE_MAGNETISM_RANGE = 150;
        const currentBonus = this.playerUpgrades.getShardMagnetismBonus();
        const currentRange = BASE_MAGNETISM_RANGE + currentBonus;
        const afterRange = currentRange + CORE_UPGRADE_EFFECTS.MAGNET.INCREASE_RANGE;
        return {
          label: 'Range',
          current: `${Math.round(currentRange)}`,
          after: `${Math.round(afterRange)}`,
          change: `+${CORE_UPGRADE_EFFECTS.MAGNET.INCREASE_RANGE}`,
        };
      }

      // Non-core upgrades with meaningful stats
      case 'beam_damage': {
        const currentMult = this.playerUpgrades.getBeamDamageMultiplier();
        // First upgrade gives 50%, subsequent give 38%
        const isFirst = this.upgradeService.getCount('beam_damage') === 0;
        const increasePercent = isFirst
          ? UPGRADE_EFFECTS.BEAM_DAMAGE.FIRST_UPGRADE_PERCENT
          : UPGRADE_EFFECTS.BEAM_DAMAGE.SUBSEQUENT_UPGRADE_PERCENT;
        const afterMult = currentMult * (1 + increasePercent / 100);
        return {
          label: 'Damage',
          current: `${Math.round(currentMult * 100)}%`,
          after: `${Math.round(afterMult * 100)}%`,
          change: `+${increasePercent}%`,
        };
      }
      case 'fire_rate_boost': {
        const currentMult = this.playerUpgrades.getFireRateMultiplier();
        const afterMult = currentMult * 1.25; // 25% increase per upgrade.service.ts
        return {
          label: 'Fire Rate',
          current: `${Math.round(currentMult * 100)}%`,
          after: `${Math.round(afterMult * 100)}%`,
          change: '+25%',
        };
      }
      case 'burn_chance': {
        const currentChance = this.playerUpgrades.getBurnChance() * 100;
        const increasePercent = UPGRADE_EFFECTS.BURN_CHANCE.INCREASE_PERCENT;
        const afterChance = Math.min(100, currentChance + increasePercent);
        return {
          label: 'Burn',
          current: `${Math.round(currentChance)}%`,
          after: `${Math.round(afterChance)}%`,
          change: `+${increasePercent}%`,
        };
      }
      case 'surgical_precision': {
        const currentChance = this.playerUpgrades.getCriticalHitChance() * 100;
        const afterChance = Math.min(100, currentChance + 15); // 15% per stack per upgrade.service.ts
        return {
          label: 'Crit',
          current: `${Math.round(currentChance)}%`,
          after: `${Math.round(afterChance)}%`,
          change: '+15%',
        };
      }

      default:
        return null;
    }
  }

  /**
   * Format upgrade description for the current input device.
   * On touch devices, replaces desktop-specific copy ("Right-click") with the
   * equivalent touch action ("Mode button") so mobile players understand the mechanic.
   * Pure display function — does not alter upgrade data.
   */
  formatDescription(description: string): string {
    // Detect touch device: coarse pointer = no keyboard/mouse
    const isTouch =
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    if (!isTouch) return description;
    // Substitute desktop-specific copy with touch equivalents
    return description.replace(/Right[‑-]click/gi, 'Mode button').replace(/Left[‑-]click/gi, 'Tap');
  }

  ngOnDestroy(): void {
    // Clean up event listeners to prevent memory leaks
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
    if (this.tabTrapHandler) {
      document.removeEventListener('keydown', this.tabTrapHandler);
      this.tabTrapHandler = null;
    }

    // Restore focus to previously focused element
    if (this.previouslyFocusedElement?.isConnected && typeof this.previouslyFocusedElement.focus === 'function') {
      this.previouslyFocusedElement.focus();
    }
  }
}
