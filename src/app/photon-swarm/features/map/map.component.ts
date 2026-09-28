import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { FourKingsTerritoryService } from '../../core/systems/territory';
import { PlayerService } from '../../core/player/player.service';
import { MapEntities, MapRendererService, Territory } from './map-renderer.service';
import { MinimapRendererService } from './minimap-renderer.service';
import { EntityManagerService } from '../../core/ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../core/entities/entity-factory-ecs.service';
import { PositionComponent } from '@photon/components/position.component';
import { EnemyTypeComponent } from '@photon/components/enemy-type.component';
import { PowerupComponent } from '@photon/components/powerup.component';
import { ShardComponent } from '@photon/components/shard.component';
import { HealthComponent } from '@photon/components/health.component';
import { FallingAsteroidComponent } from '@photon/components/falling-asteroid.component';
import { ThemeService } from '@services/theme.service';
import { FACTION_IDENTITIES } from '@photon/config/faction-identity.config';
import { MinimapEntities } from './map.model';
import { FocusTrapDirective } from '@shared/directives/focus-trap.directive';

/**
 * Convert a canonical `#rrggbb` faction color to an `rgba(...)` string at a fixed alpha.
 * Called only at module load (see TERRITORY_FILL_COLORS below) — never per frame.
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Territory colors matching Four Kings — derived once from the canonical faction
// identity config (config/faction-identity.config.ts) so a hue change there
// propagates here automatically. Alphas are tuned per-theme for map readability
// and are independent of the config.
const TERRITORY_FILL_COLORS: Readonly<Record<number, { dark: string; light: string }>> = {
  1: {
    dark: hexToRgba(FACTION_IDENTITIES[1].dark.territory.color, 0.4),
    light: hexToRgba(FACTION_IDENTITIES[1].light.territory.color, 0.35),
  },
  2: {
    dark: hexToRgba(FACTION_IDENTITIES[2].dark.territory.color, 0.4),
    light: hexToRgba(FACTION_IDENTITIES[2].light.territory.color, 0.35),
  },
  3: {
    dark: hexToRgba(FACTION_IDENTITIES[3].dark.territory.color, 0.4),
    light: hexToRgba(FACTION_IDENTITIES[3].light.territory.color, 0.35),
  },
  4: {
    dark: hexToRgba(FACTION_IDENTITIES[4].dark.territory.color, 0.4),
    light: hexToRgba(FACTION_IDENTITIES[4].light.territory.color, 0.35),
  },
};

interface CachedMapEnemy {
  x: number;
  y: number;
  type: string;
  threat: 'normal' | 'elite' | 'boss';
  health: number;
}

interface CachedMapItem {
  x: number;
  y: number;
  type: string;
  rarity?: string;
}

interface CachedMapAsteroid {
  x: number;
  y: number;
  state: string;
  health: number;
}

/**
 * Advanced Map Component with Diablo 2 inspired visuals
 * Features fog of war, exploration tracking, and cyberpunk aesthetics
 */
@Component({
  selector: 'app-map',
  standalone: true,
  imports: [FocusTrapDirective],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
  providers: [MapRendererService, MinimapRendererService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements OnDestroy, AfterViewInit, OnChanges {
  @Input() isVisible = false;
  @Input() hideForModal = false;
  @Output() close = new EventEmitter<void>();

  // ViewChild references for canvas elements
  @ViewChild('mapCanvas', { static: false }) set mapCanvasRef(element: ElementRef<HTMLCanvasElement> | undefined) {
    if (element) {
      this.mapCanvas = element.nativeElement;
      this.initializeMapCanvas();
    }
  }

  @ViewChild('minimapCanvas', { static: false }) set minimapCanvasRef(
    element: ElementRef<HTMLCanvasElement> | undefined
  ) {
    if (element) {
      this.minimapCanvas = element.nativeElement;
      this.initializeMinimapCanvas();
    }
  }

  // Canvas elements
  private mapCanvas!: HTMLCanvasElement;
  private mapCtx!: CanvasRenderingContext2D;
  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;

  // Performance tracking
  private renderIntervalId?: number;
  private isDirty = true; // Only render when something changes

  // Game state
  private playerRotation = 0;
  private isInCombat = false;
  private lastPlayerX = 0;
  private lastPlayerY = 0;

  // Map configuration - simplified for arena shooter
  private readonly MAP_CONFIG = {
    viewRadius: 5000, // Show more of the map
    showElitesOnly: true, // Only show important enemies
    showAsteroids: true, // Show environmental hazards
  };

  private readonly MINIMAP_CONFIG = {
    viewRadius: 550, // Matches approximate viewport size (~500-600px) with slight detection edge
    updateInterval: 50, // Tactical radar cadence: 20 Hz
    showAllEnemies: true, // Show all nearby enemies
    maxEnemyDistance: 700, // Slightly larger than viewRadius to handle edge cases
  };

  // Entity tracking for performance
  private readonly nearbyEnemies: CachedMapEnemy[] = [];
  private readonly nearbyEnemyPool: CachedMapEnemy[] = [];
  private readonly visibleItems: CachedMapItem[] = [];
  private readonly visibleItemPool: CachedMapItem[] = [];
  private readonly asteroids: CachedMapAsteroid[] = [];
  private readonly asteroidPool: CachedMapAsteroid[] = [];

  private readonly fullMapEnemyBuffer: MapEntities['enemies'] = [];
  private readonly fullMapEnemyPool: MapEntities['enemies'] = [];
  private readonly fullMapItemBuffer: MapEntities['items'] = [];
  private readonly fullMapItemPool: MapEntities['items'] = [];
  private readonly fullMapAsteroidBuffer: NonNullable<MapEntities['asteroids']> = [];
  private readonly fullMapAsteroidPool: NonNullable<MapEntities['asteroids']> = [];
  private readonly fullMapEntities: MapEntities = {
    enemies: this.fullMapEnemyBuffer,
    items: this.fullMapItemBuffer,
    asteroids: this.fullMapAsteroidBuffer,
  };

  private readonly filteredEnemyBuffer: CachedMapEnemy[] = [];
  private readonly minimapEnemyBuffer: NonNullable<MinimapEntities['enemies']> = [];
  private readonly minimapEnemyPool: NonNullable<MinimapEntities['enemies']> = [];
  private readonly minimapItemBuffer: NonNullable<MinimapEntities['items']> = [];
  private readonly minimapItemPool: NonNullable<MinimapEntities['items']> = [];
  private readonly spawnWarningBuffer: NonNullable<MinimapEntities['spawnWarnings']> = [];
  private readonly spawnWarningPool: NonNullable<MinimapEntities['spawnWarnings']> = [];
  private readonly minimapEntities: MinimapEntities = {
    enemies: this.minimapEnemyBuffer,
    items: this.minimapItemBuffer,
    spawnWarnings: this.spawnWarningBuffer,
  };

  // Territory caching based on generation
  private territoryCache: Territory[] = [];
  private cachedTerritoryGeneration = -1;
  private cachedTerritoryCenter: { x: number; y: number } | null = null;
  private cachedTerritoryRadius = 0;

  // Entity update tracking
  private lastEntityUpdateTime = 0;

  // Control flags
  showDebugInfo = false; // Disable debug by default

  // Event handlers stored for cleanup
  private keyHandler?: (e: KeyboardEvent) => void;
  private wheelHandler?: (e: WheelEvent) => void;

  // Theme-aware territory colors for consistency with minimap — see TERRITORY_FILL_COLORS
  // above (derived once from the canonical faction identity config).
  private readonly TERRITORY_COLORS = TERRITORY_FILL_COLORS;

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    private player: PlayerService,
    private mapRenderer: MapRendererService,
    private minimapRenderer: MinimapRendererService,
    private entityManager: EntityManagerService,
    private entityFactory: EntityFactoryECSService,
    private themeService: ThemeService,
    private ngZone: NgZone
  ) {}

  ngAfterViewInit(): void {
    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Start the render loop immediately for minimap (it's always visible)
    // The minimap canvas will be initialized when ViewChild detects it
    if (this.renderIntervalId === undefined) {
      this.startRenderLoop();
    }
  }

  ngOnDestroy(): void {
    if (this.renderIntervalId !== undefined) {
      window.clearInterval(this.renderIntervalId);
      this.renderIntervalId = undefined;
    }
    this.minimapRenderer.destroy();
    this.cleanupEventListeners();
  }

  ngOnChanges(): void {
    if (this.isVisible) {
      this.isDirty = true; // Force redraw when map becomes visible
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isVisible && !this.hideForModal) {
      event.preventDefault();
      event.stopPropagation();
      this.closeMap();
    }
  }

  /**
   * Initialize the main map canvas when it becomes available
   */
  private initializeMapCanvas(): void {
    if (!this.mapCanvas) return;

    // Set a fixed size initially
    this.mapCanvas.width = 480;
    this.mapCanvas.height = 400;

    const ctx = this.mapCanvas.getContext('2d');
    if (ctx) {
      this.mapCtx = ctx;
      // Mark dirty to trigger a redraw now that the map canvas is ready
      this.isDirty = true;
    }
  }

  /**
   * Initialize the minimap canvas when it becomes available
   */
  private initializeMinimapCanvas(): void {
    if (!this.minimapCanvas) return;

    // Set fixed size for minimap
    this.minimapCanvas.width = 200;
    this.minimapCanvas.height = 200;

    const minimapCtx = this.minimapCanvas.getContext('2d');
    if (minimapCtx) {
      this.minimapCtx = minimapCtx;
      this.minimapCtx.imageSmoothingEnabled = false; // Crisp pixels for minimap
    }
  }

  /**
   * Main render loop with performance optimization
   */
  private startRenderLoop(): void {
    const render = (): void => {
      const timestamp = window.performance.now();
      // Get player data
      const playerPos = this.player.getPosition();
      if (playerPos) {
        const deltaX = playerPos.x - this.lastPlayerX;
        const deltaY = playerPos.y - this.lastPlayerY;

        // Update player rotation based on movement
        if (deltaX !== 0 || deltaY !== 0) {
          this.playerRotation = Math.atan2(deltaY, deltaX);
          if (deltaX * deltaX + deltaY * deltaY > 100) this.isDirty = true;
          this.lastPlayerX = playerPos.x;
          this.lastPlayerY = playerPos.y;
        }

        // Update entity caches periodically
        if (timestamp - this.lastEntityUpdateTime > 200) {
          this.updateEntityCaches(playerPos);
          this.lastEntityUpdateTime = timestamp;
          this.isDirty = true; // Mark dirty when entities change
        }
      }

      // Keep minimap visible while the full map is open. The scheduler itself
      // runs at 20 Hz, so no 60 Hz RAF wake-up is needed.
      if (!this.hideForModal && this.minimapCtx) {
        this.renderMinimap();
      }

      // Render full map only when dirty (on-demand)
      if (this.isVisible && !this.hideForModal && this.mapCanvas && this.mapCtx && this.isDirty) {
        this.renderFullMap();
        this.isDirty = false;
      }
    };

    this.ngZone.runOutsideAngular(() => {
      render();
      this.renderIntervalId = window.setInterval(render, this.MINIMAP_CONFIG.updateInterval);
    });
  }

  /**
   * Render the full map with all effects
   */
  private renderFullMap(): void {
    if (!this.mapCtx || !this.mapCanvas || this.hideForModal) return;

    const ctx = this.mapCtx;

    // Use fixed dimensions we set in init
    const viewportWidth = this.mapCanvas.width;
    const viewportHeight = this.mapCanvas.height;

    // Ensure we have valid dimensions
    if (viewportWidth === 0 || viewportHeight === 0) return;

    // Clear entire canvas
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    // Save the context state
    ctx.save();

    // Get player position
    const playerPos = this.player.getPosition();
    if (!playerPos) return;

    // Map takes full canvas space (canvas is already sized by CSS)
    const mapSize = Math.min(viewportWidth, viewportHeight) * 0.95;

    // Center the map in the canvas
    const mapX = (viewportWidth - mapSize) / 2;
    const mapY = (viewportHeight - mapSize) / 2;

    // Get territories in view
    const territories = this.getTerritoryData(playerPos.x, playerPos.y, this.MAP_CONFIG.viewRadius);

    this.fullMapEnemyBuffer.length = 0;
    for (const enemy of this.nearbyEnemies) {
      const index = this.fullMapEnemyBuffer.length;
      const target = this.fullMapEnemyPool[index] ?? { x: 0, y: 0, threat: 'normal', health: 1 };
      if (!this.fullMapEnemyPool[index]) this.fullMapEnemyPool.push(target);
      target.x = enemy.x;
      target.y = enemy.y;
      target.threat = enemy.threat;
      target.health = enemy.health;
      this.fullMapEnemyBuffer.push(target);
    }

    this.fullMapItemBuffer.length = 0;
    for (const item of this.visibleItems) {
      const index = this.fullMapItemBuffer.length;
      const target = this.fullMapItemPool[index] ?? { x: 0, y: 0, rarity: 'common', type: 'shard' };
      if (!this.fullMapItemPool[index]) this.fullMapItemPool.push(target);
      target.x = item.x;
      target.y = item.y;
      target.rarity = item.rarity || 'common';
      target.type = item.type as 'powerup' | 'shard';
      this.fullMapItemBuffer.push(target);
    }

    this.fullMapAsteroidBuffer.length = 0;
    for (const asteroid of this.asteroids) {
      const index = this.fullMapAsteroidBuffer.length;
      const target = this.fullMapAsteroidPool[index] ?? { x: 0, y: 0, state: '' };
      if (!this.fullMapAsteroidPool[index]) this.fullMapAsteroidPool.push(target);
      target.x = asteroid.x;
      target.y = asteroid.y;
      target.state = asteroid.state;
      this.fullMapAsteroidBuffer.push(target);
    }

    // Render map using advanced renderer
    this.mapRenderer.renderFullMap(
      ctx,
      mapX,
      mapY,
      mapSize,
      playerPos.x,
      playerPos.y,
      this.MAP_CONFIG.viewRadius,
      territories,
      this.fullMapEntities
    );

    // Restore context state
    ctx.restore();
  }

  /**
   * Render the minimap
   */
  private renderMinimap(): void {
    if (!this.minimapCtx || !this.minimapCanvas || this.hideForModal) return;

    const ctx = this.minimapCtx;
    const width = this.minimapCanvas.width;
    const height = this.minimapCanvas.height;

    // Get player position
    const playerPos = this.player.getPosition();
    if (!playerPos) return;

    // Get territories for minimap
    const territories = this.getTerritoryData(playerPos.x, playerPos.y, this.MINIMAP_CONFIG.viewRadius);

    // Get nearby entities — compare squared distances to avoid sqrt (identical filter result;
    // viewRadius is always positive so squaring both sides preserves the inequality direction).
    const viewRadiusSq = this.MINIMAP_CONFIG.viewRadius * this.MINIMAP_CONFIG.viewRadius;
    this.filteredEnemyBuffer.length = 0;
    this.minimapEnemyBuffer.length = 0;
    for (const enemy of this.nearbyEnemies) {
      const dx = enemy.x - playerPos.x;
      const dy = enemy.y - playerPos.y;
      if (dx * dx + dy * dy >= viewRadiusSq) continue;

      this.filteredEnemyBuffer.push(enemy);
      const index = this.minimapEnemyBuffer.length;
      const target = this.minimapEnemyPool[index] ?? { x: 0, y: 0, type: 'normal' };
      if (!this.minimapEnemyPool[index]) this.minimapEnemyPool.push(target);
      target.x = enemy.x;
      target.y = enemy.y;
      target.type = enemy.threat;
      this.minimapEnemyBuffer.push(target);
    }

    // Calculate spawn warnings based on enemy positions at edge of view
    this.calculateSpawnWarnings(playerPos, this.filteredEnemyBuffer, this.spawnWarningBuffer);

    this.minimapItemBuffer.length = 0;
    for (const item of this.visibleItems) {
      const dx = item.x - playerPos.x;
      const dy = item.y - playerPos.y;
      if (dx * dx + dy * dy >= viewRadiusSq) continue;

      const index = this.minimapItemBuffer.length;
      const target = this.minimapItemPool[index] ?? { x: 0, y: 0, rarity: 'common', type: 'shard' };
      if (!this.minimapItemPool[index]) this.minimapItemPool.push(target);
      target.x = item.x;
      target.y = item.y;
      target.rarity = item.rarity || 'common';
      target.type = item.type as 'powerup' | 'shard';
      this.minimapItemBuffer.push(target);
    }

    // Render using advanced minimap renderer
    this.minimapRenderer.renderMinimap(
      ctx,
      width,
      height,
      playerPos.x,
      playerPos.y,
      this.playerRotation,
      territories,
      this.minimapEntities,
      this.isInCombat,
      this.showDebugInfo
    );
  }

  /**
   * Update entity caches for performance
   */
  private updateEntityCaches(playerPos: { x: number; y: number }): void {
    // Get all enemies with type and position
    const enemyEntities = this.entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent);

    this.nearbyEnemies.length = 0;
    for (const entity of enemyEntities) {
      // Skip pooled/inactive entities — prevents ghost dots on minimap
      if (!this.entityFactory.isEntityActive(entity)) continue;

      const pos = this.entityManager.getComponent(entity, PositionComponent);
      const enemyType = this.entityManager.getComponent(entity, EnemyTypeComponent);
      if (!pos || !enemyType) continue;

      const health = this.entityManager.getComponent(entity, HealthComponent);
      if (health?.isDead || (health && health.health <= 0)) continue;

      let threat: 'normal' | 'elite' | 'boss' = 'normal';
      const typeStr = enemyType.type.toString();
      if (typeStr.includes('King') || typeStr.includes('Boss')) {
        threat = 'boss';
      } else if (typeStr.includes('Elite') || typeStr.includes('Leader')) {
        threat = 'elite';
      }

      const index = this.nearbyEnemies.length;
      const target = this.nearbyEnemyPool[index] ?? { x: 0, y: 0, type: '', threat: 'normal', health: 1 };
      if (!this.nearbyEnemyPool[index]) this.nearbyEnemyPool.push(target);
      target.x = pos.x;
      target.y = pos.y;
      target.type = enemyType.type;
      target.threat = threat;
      target.health = health ? health.health / 100 : 1;
      this.nearbyEnemies.push(target);
    }

    // Get real items from ECS (powerups and shards)
    const powerupEntities = this.entityManager.getEntitiesWithComponents(PositionComponent, PowerupComponent);

    const shardEntities = this.entityManager.getEntitiesWithComponents(PositionComponent, ShardComponent);

    this.visibleItems.length = 0;

    // Add powerups
    for (const entity of powerupEntities) {
      if (!this.entityFactory.isEntityActive(entity)) continue;

      const pos = this.entityManager.getComponent(entity, PositionComponent);
      const powerup = this.entityManager.getComponent(entity, PowerupComponent);
      if (!pos || !powerup) continue;

      const index = this.visibleItems.length;
      const target = this.visibleItemPool[index] ?? { x: 0, y: 0, rarity: 'common', type: 'powerup' };
      if (!this.visibleItemPool[index]) this.visibleItemPool.push(target);
      target.x = pos.x;
      target.y = pos.y;
      target.rarity =
        powerup.type === 'damage_multiplier' || powerup.type === 'speed'
          ? 'rare'
          : powerup.type === 'health'
            ? 'epic'
            : 'common';
      target.type = 'powerup';
      this.visibleItems.push(target);
    }

    // Add shards
    for (const entity of shardEntities) {
      if (!this.entityFactory.isEntityActive(entity)) continue;

      const pos = this.entityManager.getComponent(entity, PositionComponent);
      const shard = this.entityManager.getComponent(entity, ShardComponent);
      if (!pos || !shard) continue;

      const index = this.visibleItems.length;
      const target = this.visibleItemPool[index] ?? { x: 0, y: 0, rarity: 'common', type: 'shard' };
      if (!this.visibleItemPool[index]) this.visibleItemPool.push(target);
      target.x = pos.x;
      target.y = pos.y;
      target.rarity = shard.value > 3 ? 'rare' : 'common';
      target.type = 'shard';
      this.visibleItems.push(target);
    }

    // Get asteroids from ECS
    const asteroidEntities = this.entityManager.getEntitiesWithComponents(PositionComponent, FallingAsteroidComponent);

    this.asteroids.length = 0;
    for (const entity of asteroidEntities) {
      if (!this.entityFactory.isEntityActive(entity)) continue;
      const pos = this.entityManager.getComponent(entity, PositionComponent);
      const asteroid = this.entityManager.getComponent(entity, FallingAsteroidComponent);
      if (!pos || !asteroid) continue;
      const health = this.entityManager.getComponent(entity, HealthComponent);

      const index = this.asteroids.length;
      const target = this.asteroidPool[index] ?? { x: 0, y: 0, state: '', health: 100 };
      if (!this.asteroidPool[index]) this.asteroidPool.push(target);
      target.x = pos.x;
      target.y = pos.y;
      target.state = asteroid.state;
      target.health = health ? health.health : 100;
      this.asteroids.push(target);
    }

    // Check combat state based on real enemies
    this.isInCombat = false;
    for (const enemy of this.nearbyEnemies) {
      const dx = enemy.x - playerPos.x;
      const dy = enemy.y - playerPos.y;
      if (dx * dx + dy * dy < 40000) {
        this.isInCombat = true;
        break;
      }
    }
  }

  /**
   * Get territory data for rendering with smart caching
   */
  private getTerritoryData(centerX: number, centerY: number, radius: number): Territory[] {
    // Check if we need to update the cache
    const currentGeneration = this.fourKingsTerritory.getTerritoryGeneration();
    const needsUpdate =
      currentGeneration !== this.cachedTerritoryGeneration ||
      this.cachedTerritoryCenter === null ||
      Math.abs(this.cachedTerritoryCenter.x - centerX) > radius * 0.5 ||
      Math.abs(this.cachedTerritoryCenter.y - centerY) > radius * 0.5 ||
      Math.abs(this.cachedTerritoryRadius - radius) > 100;

    if (needsUpdate) {
      // Update cache
      const territories = [];
      const tileSize = 100;
      const tilesRadius = Math.ceil(radius / tileSize);

      for (let dx = -tilesRadius; dx <= tilesRadius; dx++) {
        for (let dy = -tilesRadius; dy <= tilesRadius; dy++) {
          const x = centerX + dx * tileSize;
          const y = centerY + dy * tileSize;

          try {
            const territory = this.fourKingsTerritory.getTerritoryAtPosition(x, y);
            if (territory) {
              territories.push({
                x,
                y,
                kingId: territory.kingId,
                color: this.getTerritoryColor(territory.kingId),
                type: territory.kingName,
                minX: x - tileSize / 2,
                maxX: x + tileSize / 2,
                minY: y - tileSize / 2,
                maxY: y + tileSize / 2,
              });
            }
          } catch {
            // Skip on error
          }
        }
      }

      // Update cache metadata
      this.territoryCache = territories;
      this.cachedTerritoryGeneration = currentGeneration;
      this.cachedTerritoryCenter = { x: centerX, y: centerY };
      this.cachedTerritoryRadius = radius;
    }

    return this.territoryCache;
  }

  /**
   * Get territory color with theme-aware styling
   * Matches minimap-renderer.service.ts for visual consistency
   */
  private getTerritoryColor(kingId: number): string {
    const colors = this.TERRITORY_COLORS[kingId];
    if (!colors) {
      return this.themeService.isDayMode ? 'rgba(100, 100, 100, 0.3)' : 'rgba(100, 100, 100, 0.4)';
    }
    return this.themeService.isDayMode ? colors.light : colors.dark;
  }

  /**
   * Calculate spawn warnings based on enemy concentration at edges
   * Shows directional indicators when enemies are approaching from specific directions
   */
  private calculateSpawnWarnings(
    playerPos: { x: number; y: number },
    enemies: Array<{ x: number; y: number; threat: 'normal' | 'elite' | 'boss' }>,
    warnings: NonNullable<MinimapEntities['spawnWarnings']>
  ): void {
    warnings.length = 0;
    if (enemies.length === 0) return;

    // Group enemies by direction (8 sectors)
    const sectors: Record<string, { count: number; hasElite: boolean; hasBoss: boolean; totalThreat: number }> = {
      north: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
      south: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
      east: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
      west: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
      northeast: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
      northwest: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
      southeast: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
      southwest: { count: 0, hasElite: false, hasBoss: false, totalThreat: 0 },
    };

    // Only consider enemies at outer edge of view (600-800 units away)
    const edgeMinDist = this.MINIMAP_CONFIG.viewRadius * 0.6;

    for (const enemy of enemies) {
      const dx = enemy.x - playerPos.x;
      const dy = enemy.y - playerPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Only count enemies at the edge of view range
      if (dist < edgeMinDist) continue;

      // Determine direction (8 sectors, 45 degrees each)
      const angle = Math.atan2(dy, dx);
      const sector = this.getDirectionFromAngle(angle);

      sectors[sector].count++;
      if (enemy.threat === 'elite') sectors[sector].hasElite = true;
      if (enemy.threat === 'boss') sectors[sector].hasBoss = true;

      // Calculate threat level
      const threatValue = enemy.threat === 'boss' ? 5 : enemy.threat === 'elite' ? 2 : 1;
      sectors[sector].totalThreat += threatValue;
    }

    // Generate warnings for sectors with significant enemy presence
    const ENEMY_THRESHOLD = 2; // Minimum enemies to show warning
    const MAX_THREAT = 10; // For normalizing intensity

    for (const [direction, data] of Object.entries(sectors)) {
      if (data.count >= ENEMY_THRESHOLD || data.hasBoss) {
        const intensity = Math.min(data.totalThreat / MAX_THREAT, 1);

        let waveType: 'normal' | 'swarm' | 'elite' = 'normal';
        if (data.hasBoss || data.hasElite) {
          waveType = 'elite';
        } else if (data.count >= 5) {
          waveType = 'swarm';
        }

        const index = warnings.length;
        const warning = this.spawnWarningPool[index] ?? { direction: 'north', intensity: 0, waveType: 'normal' };
        if (!this.spawnWarningPool[index]) this.spawnWarningPool.push(warning);
        warning.direction = direction as (typeof warning)['direction'];
        warning.intensity = intensity;
        warning.waveType = waveType;
        warnings.push(warning);
      }
    }
  }

  /**
   * Convert angle to cardinal/ordinal direction
   */
  private getDirectionFromAngle(angle: number): string {
    // Normalize to 0-2π
    const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    // 8 sectors, each 45 degrees (π/4 radians)
    const sector = Math.round((normalized / (Math.PI / 4)) % 8);

    const directions = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
    return directions[sector] || 'east';
  }

  /**
   * Handle keyboard zoom controls
   */
  @Input()
  set zoomLevel(level: number) {
    if (level >= 0.5 && level <= 2) {
      this.MAP_CONFIG.viewRadius = 2500 / level;
      this.MINIMAP_CONFIG.viewRadius = 800 / level;
    }
  }

  private currentZoom = 1;

  /**
   * Handle zoom in/out
   */
  private handleZoom(delta: number): void {
    this.currentZoom = Math.max(0.5, Math.min(2, this.currentZoom + delta));
    this.MAP_CONFIG.viewRadius = 2500 / this.currentZoom;
    this.MINIMAP_CONFIG.viewRadius = 800 / this.currentZoom;

    // Save zoom preference (wrapped in try-catch for private browsing compatibility)
    try {
      window.localStorage.setItem('photon-swarm-map-zoom', this.currentZoom.toString());
    } catch {
      // localStorage may be unavailable in private browsing mode - silently ignore
    }
  }

  /**
   * Setup keyboard shortcuts
   */
  private setupKeyboardShortcuts(): void {
    const handleKeyPress = (e: KeyboardEvent): void => {
      // Debug info toggle
      if (e.key === 'd' && e.shiftKey) {
        this.showDebugInfo = !this.showDebugInfo;
      }

      // Zoom controls when map is visible
      if (this.isVisible) {
        if (e.key === '+' || e.key === '=') {
          this.handleZoom(0.1);
          e.preventDefault();
        } else if (e.key === '-' || e.key === '_') {
          this.handleZoom(-0.1);
          e.preventDefault();
        } else if (e.key === '0') {
          this.currentZoom = 1;
          this.handleZoom(0);
          e.preventDefault();
        }
      }
    };

    // Mouse wheel zoom when map is visible
    const handleWheel = (e: WheelEvent): void => {
      if (this.isVisible) {
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        this.handleZoom(delta);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    window.addEventListener('wheel', handleWheel, { passive: false });

    // Store references for cleanup
    this.keyHandler = handleKeyPress;
    this.wheelHandler = handleWheel;
  }

  /**
   * Cleanup event listeners
   */
  private cleanupEventListeners(): void {
    // Remove keyboard shortcuts
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
    }
    if (this.wheelHandler) {
      window.removeEventListener('wheel', this.wheelHandler);
    }
  }

  closeMap(): void {
    this.close.emit();
  }
}
