import { Injectable } from '@angular/core';
import { KingConfig, TerritoryTile } from '../models/territory.model';

/**
 * Territory Hash Service
 *
 * Generates unique hashes for territory configurations to ensure
 * save/load integrity and detect world corruption.
 */
@Injectable({
  providedIn: 'root',
})
export class TerritoryHashService {
  /**
   * Generate a hash for the entire territory grid
   * Uses a simple but effective hashing algorithm
   */
  generateTerritoryHash(territories: (TerritoryTile | null)[][]): string {
    let hash = 0;
    let tileCount = 0;

    // Process each tile
    for (let x = 0; x < territories.length; x++) {
      for (let y = 0; y < territories[x].length; y++) {
        const tile = territories[x][y];
        if (tile) {
          // Combine tile properties into hash
          hash = this.updateHash(hash, tile.kingId);
          hash = this.updateHash(hash, x * 1000 + y); // Position
          hash = this.updateHash(hash, tile.isRoad ? 1 : 0);
          hash = this.updateHash(hash, tile.roadConnections || 0);
          hash = this.updateHash(hash, tile.distanceFromCapital || 0);
          tileCount++;
        }
      }
    }

    // Include tile count in hash to detect missing tiles
    hash = this.updateHash(hash, tileCount);

    // Convert to hex string
    const hashStr = Math.abs(hash).toString(16).padStart(8, '0');

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Territory Hash Generated', 'info', {
        hash: hashStr,
        tileCount: tileCount,
        gridSize: [territories.length, territories[0]?.length || 0],
      });
    }

    return hashStr;
  }

  /**
   * Generate a hash for king configurations
   */
  generateKingConfigHash(
    kings: Array<{
      id: number;
      name: string;
      color: string;
      expansionStyle: string;
      expansionRate: number;
    }>
  ): string {
    let hash = 0;

    for (const king of kings) {
      hash = this.updateHash(hash, king.id);
      hash = this.updateHash(hash, this.stringHash(king.name));
      hash = this.updateHash(hash, this.stringHash(king.color));
      hash = this.updateHash(hash, this.stringHash(king.expansionStyle));
      hash = this.updateHash(hash, Math.floor(king.expansionRate * 100));
    }

    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Generate a complete world hash combining all elements
   */
  generateWorldHash(seed: string, territories: (TerritoryTile | null)[][], kingConfig: KingConfig[]): string {
    const seedHash = this.stringHash(seed);
    const territoryHash = this.generateTerritoryHash(territories);
    const kingHash = this.generateKingConfigHash(kingConfig);

    // Combine all hashes
    let finalHash = 0;
    finalHash = this.updateHash(finalHash, parseInt(territoryHash, 16));
    finalHash = this.updateHash(finalHash, parseInt(kingHash, 16));
    finalHash = this.updateHash(finalHash, seedHash);

    const worldHash = Math.abs(finalHash).toString(16).padStart(16, '0');

    if (window.debugLogBridge) {
      window.debugLogBridge.log('World Hash Generated', 'info', {
        worldHash,
        components: {
          seed: seed,
          territoryHash,
          kingHash,
        },
      });
    }

    return worldHash;
  }

  /**
   * Validate a world against its hash
   */
  validateWorld(
    seed: string,
    territories: (TerritoryTile | null)[][],
    kingConfig: KingConfig[],
    expectedHash: string
  ): boolean {
    const actualHash = this.generateWorldHash(seed, territories, kingConfig);
    const isValid = actualHash === expectedHash;

    if (!isValid && window.debugLogBridge) {
      window.debugLogBridge.log('World Hash Validation Failed', 'error', {
        expected: expectedHash,
        actual: actualHash,
        seed: seed,
      });
    }

    return isValid;
  }

  /**
   * Update hash using a variant of djb2 algorithm
   */
  private updateHash(hash: number, value: number): number {
    return (hash << 5) + hash + value; // hash * 33 + value
  }

  /**
   * Generate hash from string
   */
  private stringHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i);
    }
    return hash;
  }
}
