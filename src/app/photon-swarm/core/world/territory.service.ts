import { EventEmitter, Injectable } from '@angular/core';
import { EngineSystem } from '../utils/system';

export interface Territory {
  id: number;
  color: string;
  alpha: number; // current blended alpha (0-1)
  fadeDir: 1 | -1; // 1 = fading in, -1 = fading out
  tiles: { r: number; c: number }[]; // grid cells belonging to this territory
}

@EngineSystem()
@Injectable({ providedIn: 'root' })
export class TerritoryService {
  // ──────────────────────────────────────────────────────────
  private territories: Territory[] = [];
  private previous: Territory[] = [];

  private tileSize = 300; // px – tweak for chunkiness of regions / map grid
  private cols = 0;
  private rows = 0;
  private tileOwner: number[][] = [];
  private visited: boolean[][] = [];

  private readonly FADE_MS = 2000;
  private nextSwitch = 0;

  public territoryEntered = new EventEmitter<string>();

  init(worldW: number, worldH: number, now: number = window.performance.now()): void {
    this.cols = Math.ceil(worldW / this.tileSize);
    this.rows = Math.ceil(worldH / this.tileSize);
    this.tileOwner = Array.from({ length: this.rows }, () => Array(this.cols).fill(-1));
    this.visited = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));

    this.generateTerritories();
    this.nextSwitch = now + this.randomDuration();
  }

  update(dt: number, now: number = window.performance.now(), _w?: number, _h?: number): void {
    if (now >= this.nextSwitch) {
      // begin cross-fade: previous territories fade out, new fade in
      this.previous = this.territories.map((t) => ({ ...t, fadeDir: -1 }));
      this.generateTerritories();
      this.nextSwitch = now + this.randomDuration();
    }

    const step = dt / this.FADE_MS;
    [...this.territories, ...this.previous].forEach((t) => {
      t.alpha = Math.max(0, Math.min(1, t.alpha + step * t.fadeDir));
    });
    this.previous = this.previous.filter((t) => t.alpha > 0);
  }

  getActive(): Territory[] {
    return [...this.territories, ...this.previous].filter((t) => t.alpha > 0.01);
  }

  /** Emits when player crosses into new territory */
  private currentId: number | null = null;
  checkPlayerTerritory(px: number, py: number): void {
    const col = Math.floor(px / this.tileSize);
    const row = Math.floor(py / this.tileSize);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

    const id = this.tileOwner[row][col];
    if (id !== this.currentId && id !== -1) {
      this.currentId = id;
      const terr = this.territories.find((t) => t.id === id) || this.previous.find((t) => t.id === id);
      if (terr) this.territoryEntered.emit(terr.color);
    }
  }

  // ──────────────────────────────────────────────────────────
  /**
   * Returns a pseudo-random interval for the next territory shuffle.
   * Range: 40 000 – 75 000 ms (40-75 s) as requested.
   */
  private randomDuration(): number {
    return 40000 + Math.random() * 35000; // 40–75 s
  }

  private generateTerritories(rng: () => number = Math.random, attempt: number = 0): void {
    // Brighter, higher-contrast palette for better visibility against the star-field background
    const colors = [
      '#304ffe', // vivid blue
      '#7b1fa2', // vibrant purple
      '#00c853', // bright green
      '#ff6d00', // strong orange
    ];

    // pick 4 random seed tiles far apart by simple rejection sampling
    const seeds: { r: number; c: number; color: string; id: number }[] = [];
    while (seeds.length < 4) {
      const r = Math.floor(rng() * this.rows);
      const c = Math.floor(rng() * this.cols);
      // ensure not too close to existing seeds
      if (seeds.every((s) => Math.abs(s.r - r) + Math.abs(s.c - c) > Math.min(this.rows, this.cols) / 4)) {
        seeds.push({ r, c, color: colors[seeds.length % colors.length], id: Date.now() + seeds.length });
      }
    }

    // clear owner grid (keep visited so exploration persists)
    for (let y = 0; y < this.rows; y++) {
      this.tileOwner[y].fill(-1);
    }

    // frontier-based flood-fill so each territory grows as a single body
    type QItem = { r: number; c: number };
    const frontiers: Record<number, QItem[]> = {};
    seeds.forEach((seed) => {
      frontiers[seed.id] = [{ r: seed.r, c: seed.c }];
      this.tileOwner[seed.r][seed.c] = seed.id;
    });

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let unassigned = this.rows * this.cols - seeds.length;
    let iter = 0;
    while (unassigned > 0 && iter < 1e6) {
      iter++;
      for (const seed of seeds) {
        const id = seed.id;
        const frontier = frontiers[id];
        if (!frontier.length) continue;
        const idx = Math.floor(rng() * frontier.length);
        const { r, c } = frontier.splice(idx, 1)[0];
        for (const [dr, dc] of dirs) {
          const nr = r + dr,
            nc = c + dc;
          if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
          if (this.tileOwner[nr][nc] !== -1) continue;
          this.tileOwner[nr][nc] = id;
          frontier.push({ r: nr, c: nc });
          unassigned--;
          if (unassigned === 0) break;
        }
        if (unassigned === 0) break;
      }
    }

    // Count tiles per territory
    const counts: Record<number, number> = {};
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const id = this.tileOwner[y][x];
        counts[id] = (counts[id] || 0) + 1;
      }
    }

    // Ensure every territory ≥15% else regenerate
    const minTiles = Math.ceil(this.rows * this.cols * 0.15);
    if (Object.values(counts).some((c) => c < minTiles)) {
      if (attempt >= 10) {
        // Fallback: Accept the best result after 10 attempts
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Territory generation: accepting suboptimal layout after 10 attempts', 'warning', {
            source: 'territory_service',
            attempt,
          });
        }
        // Could implement fallback strategy here, like equal division
      } else {
        this.generateTerritories(rng, attempt + 1);
        return;
      }
    }

    // Build territory structures
    this.territories = seeds.map((seed) => ({
      id: seed.id,
      color: seed.color,
      alpha: 0.01,
      fadeDir: 1,
      tiles: [],
    }));

    const terrMap: Record<number, Territory> = {};
    this.territories.forEach((t) => (terrMap[t.id] = t));

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const id = this.tileOwner[y][x];
        terrMap[id].tiles.push({ r: y, c: x });
      }
    }
  }

  getTileSize(): number {
    return this.tileSize;
  }

  markVisited(px: number, py: number): void {
    const c = Math.floor(px / this.tileSize);
    const r = Math.floor(py / this.tileSize);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;
    this.visited[r][c] = true;
  }

  isVisited(r: number, c: number): boolean {
    return this.visited[r]?.[c] || false;
  }

  /** Clears the visited grid (called when player dies). */
  resetVisited(): void {
    for (let r = 0; r < this.visited.length; r++) {
      this.visited[r].fill(false);
    }
  }

  /** Returns the territory id (or null) for the given world coordinates. */
  getTerritoryId(px: number, py: number): number | null {
    const col = Math.floor(px / this.tileSize);
    const row = Math.floor(py / this.tileSize);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    const id = this.tileOwner[row][col];
    return id !== -1 ? id : null;
  }

  /**
   * Regenerates territories.  If a seed is provided the layout becomes fully
   * deterministic, allowing replays & syncing between clients.
   */
  regenerate(seed?: number): void {
    const original = Math.random;
    const seeded = this.createSeededRng(seed ?? Date.now());
    // Temporarily override RNG so the internal method stays untouched.
    const rng = seed != null ? seeded : original;

    this.generateTerritories(rng);
  }

  private createSeededRng(seed: number): () => number {
    let s = seed % 2147483647;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
}
