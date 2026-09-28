// Barrel export for photon-swarm models.
//
// NOTE: Some model files have overlapping export names:
//   - Rarity/AlertState: re-exported by enemy.model.ts from common.model.ts
//   - Enemy/EnemyType/Projectile/GameState: re-exported by game-types.model.ts
//   - StatusEffect: equipment.model.ts (upgrade.model.ts duplicate removed)
//   - EnemyProperties: game-types.model.ts only (enemy.model.ts duplicate removed)
//   - TerritoryTile (Four Kings schema): territory.model.ts only
//   - FactionTerritoryTile (faction/grid schema): territory-tile.model.ts
//
// To avoid ambiguous re-export errors, files with overlapping names
// are NOT re-exported here. Import directly from the specific model file
// when you need types from: enemy.model, game-types.model, territory.model,
// territory-tile.model, equipment.model, or upgrade.model.
//
// Files exported via this barrel (no conflicts):
export * from './common.model';
export * from './asteroid.model';
export * from './effects.model';
export * from './encounter.model';
export * from './game-engine-extended.model';
export * from './game-state.model';
export * from './player.model';
export * from './projectile.model';
export * from './save-game.model';
export * from './run-build.model';
