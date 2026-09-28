import { EnemyType } from '../../models/enemy.model';
import { PlayerService } from '../../player/player.service';
import { RandomService } from '../../utils/random.service';
import { ZoneStateService } from '../world';
import { SpawnPositionService } from './spawn-position.service';

describe('SpawnPositionService', () => {
  let random: jasmine.SpyObj<RandomService>;
  let player: jasmine.SpyObj<PlayerService>;
  let service: SpawnPositionService;

  beforeEach(() => {
    random = jasmine.createSpyObj<RandomService>('RandomService', ['random']);
    random.random.and.returnValue(0.5);
    player = jasmine.createSpyObj<PlayerService>('PlayerService', ['getPosition']);
    player.getPosition.and.returnValue({ x: 1000, y: 1000 });
    const zoneState = jasmine.createSpyObj<ZoneStateService>('ZoneStateService', ['getCurrentZone']);
    zoneState.getCurrentZone.and.returnValue(null);
    service = new SpawnPositionService(random, player, zoneState);
    service.setWorldBounds(3000, 3000);
  });

  it('places alternating pincer targets on opposite sides of the player', () => {
    const first = service.getEncounterPosition({
      formation: 'pincer',
      index: 0,
      total: 4,
      anchorAngle: 0,
      enemyType: EnemyType.Basic,
      blackoutActive: false,
    });
    const second = service.getEncounterPosition({
      formation: 'pincer',
      index: 1,
      total: 4,
      anchorAngle: 0,
      enemyType: EnemyType.Basic,
      blackoutActive: false,
    });

    expect(first.y).toBeGreaterThan(1000);
    expect(second.y).toBeLessThan(1000);
  });

  it('keeps boss formation spawns farther away than standard targets', () => {
    const standard = service.getEncounterPosition({
      formation: 'front',
      index: 0,
      total: 1,
      anchorAngle: 0,
      enemyType: EnemyType.Basic,
      blackoutActive: false,
    });
    const boss = service.getEncounterPosition({
      formation: 'front',
      index: 0,
      total: 1,
      anchorAngle: 0,
      enemyType: EnemyType.Boss,
      blackoutActive: false,
    });

    expect(boss.x - 1000).toBeGreaterThan(standard.x - 1000);
  });

  it('allows blackout formations to close distance without spawning on the player', () => {
    const position = service.getEncounterPosition({
      formation: 'front',
      index: 0,
      total: 1,
      anchorAngle: 0,
      enemyType: EnemyType.Basic,
      blackoutActive: true,
    });

    expect(position.x - 1000).toBe(500);
  });

  it('mirrors an outward formation inward when world clamping would spawn on the player', () => {
    player.getPosition.and.returnValue({ x: 100, y: 100 });

    const position = service.getEncounterPosition({
      formation: 'front',
      index: 0,
      total: 1,
      anchorAngle: Math.PI,
      enemyType: EnemyType.Basic,
      blackoutActive: false,
    });
    const distance = Math.sqrt((position.x - 100) ** 2 + (position.y - 100) ** 2);

    expect(distance).toBeGreaterThanOrEqual(500);
    expect(position.x).toBeGreaterThan(100);
  });

  it('moves an ambient spawn inward when edge clamping collapses it onto the player', () => {
    player.getPosition.and.returnValue({ x: 100, y: 100 });

    const position = service.getSpawnPosition();
    const distance = Math.sqrt((position.x - 100) ** 2 + (position.y - 100) ** 2);

    expect(distance).toBeGreaterThanOrEqual(500);
    expect(position.x).toBeGreaterThanOrEqual(100);
    expect(position.y).toBeGreaterThanOrEqual(100);
  });
});
