/// <reference types="jasmine" />
import { Component, ComponentType, EntityManager } from '../core/ecs/ecs.model';
import {
  ChargingComponent,
  CollisionBoxComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  VelocityComponent,
} from '@photon/components';
import { TEST_ENEMIES, TestTimeProvider } from './test-constants';

/**
 * Create a complete mock EntityManager with all methods
 */
export function createFullMockEntityManager(): jasmine.SpyObj<EntityManager> {
  const spy = jasmine.createSpyObj<EntityManager>('EntityManager', [
    'createEntity',
    'destroyEntity',
    'addComponent',
    'removeComponent',
    'getComponent',
    'hasComponent',
    'getEntitiesWithComponents',
    'hasEntity',
    'getComponents',
  ]);

  // Set up default return values
  spy.createEntity.and.returnValue(1);
  spy.hasEntity.and.returnValue(false);
  spy.hasComponent.and.returnValue(false);
  spy.getComponent.and.returnValue(undefined);
  spy.getComponents.and.returnValue(undefined);
  spy.getEntitiesWithComponents.and.returnValue([]);

  return spy;
}

/**
 * Setup a player entity with common components for testing
 */
export function setupTestPlayer(
  entityManager: jasmine.SpyObj<EntityManager>,
  entityId: number = 1,
  position: { x: number; y: number } = { x: 100, y: 100 }
): Map<ComponentType<any>, Component> {
  const components = new Map<ComponentType<any>, Component>();

  // Add standard player components
  components.set(PositionComponent, new PositionComponent(position.x, position.y));
  components.set(VelocityComponent, new VelocityComponent(0, 0));
  components.set(HealthComponent, new HealthComponent(100, 100));
  components.set(CollisionBoxComponent, new CollisionBoxComponent(12, 'player'));
  components.set(PlayerControlledComponent, new PlayerControlledComponent());
  components.set(ChargingComponent, new ChargingComponent());

  // Configure entity manager responses
  entityManager.getComponent.and.callFake(<T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
    if (id === entityId) {
      return components.get(type) as T | undefined;
    }
    return undefined;
  });

  entityManager.hasComponent.and.callFake((id: number, type: ComponentType<any>) => {
    return id === entityId && components.has(type);
  });

  entityManager.getComponents.and.callFake((id: number) => {
    return id === entityId ? components : undefined;
  });
  entityManager.hasEntity.and.callFake((id: number) => id === entityId);

  return components;
}

/**
 * Setup an enemy entity with common components for testing
 */
export function setupTestEnemy(
  entityManager: jasmine.SpyObj<EntityManager>,
  entityId: number = 2,
  position: { x: number; y: number } = { x: 200, y: 200 },
  type: 'basic' | 'tank' | 'elite' = 'basic'
): Map<ComponentType<any>, Component> {
  const components = new Map<ComponentType<any>, Component>();
  const stats = type === 'elite' ? TEST_ENEMIES.ELITE_TANK : TEST_ENEMIES.BASIC;

  // Add standard enemy components
  components.set(PositionComponent, new PositionComponent(position.x, position.y));
  components.set(VelocityComponent, new VelocityComponent(0, 0));
  components.set(HealthComponent, new HealthComponent(stats.HEALTH, stats.HEALTH));
  components.set(CollisionBoxComponent, new CollisionBoxComponent(stats.RADIUS, 'enemy'));

  // Configure entity manager responses
  entityManager.getComponent.and.callFake(<T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
    if (id === entityId) {
      return components.get(type) as T | undefined;
    }
    return undefined;
  });

  entityManager.hasComponent.and.callFake((id: number, type: ComponentType<any>) => {
    return id === entityId && components.has(type);
  });

  return components;
}

/**
 * Create a test scenario with multiple entities
 */
export interface TestScenario {
  player: { id: number; components: Map<ComponentType<any>, Component> };
  enemies: Array<{ id: number; components: Map<ComponentType<any>, Component> }>;
  entityManager: jasmine.SpyObj<EntityManager>;
  timeProvider: TestTimeProvider;
}

export function createTestScenario(config?: {
  playerPos?: { x: number; y: number };
  enemyCount?: number;
  enemyPositions?: Array<{ x: number; y: number }>;
}): TestScenario {
  const entityManager = createFullMockEntityManager();
  const timeProvider = new TestTimeProvider();

  // Setup player
  const playerId = 1;
  const playerComponents = setupTestPlayer(entityManager, playerId, config?.playerPos || { x: 100, y: 100 });

  // Setup enemies
  const enemies: Array<{ id: number; components: Map<ComponentType<any>, Component> }> = [];
  const enemyCount = config?.enemyCount || 3;

  for (let i = 0; i < enemyCount; i++) {
    const enemyId = i + 2;
    const position = config?.enemyPositions?.[i] || { x: 200 + i * 100, y: 200 };
    const components = setupTestEnemy(entityManager, enemyId, position);
    enemies.push({ id: enemyId, components });
  }

  // Configure getEntitiesWithComponents
  entityManager.getEntitiesWithComponents.and.callFake((...types: ComponentType<any>[]) => {
    const result: number[] = [];

    // Check player
    if (types.every((type) => playerComponents.has(type))) {
      result.push(playerId);
    }

    // Check enemies
    for (const enemy of enemies) {
      if (types.every((type) => enemy.components.has(type))) {
        result.push(enemy.id);
      }
    }

    return result;
  });

  return {
    player: { id: playerId, components: playerComponents },
    enemies,
    entityManager,
    timeProvider,
  };
}

/**
 * Advance game simulation by multiple frames
 */
export function simulateFrames(
  scenario: TestScenario,
  frameCount: number,
  frameMs: number = 16.67,
  updateCallback?: (frame: number) => void
): void {
  for (let i = 0; i < frameCount; i++) {
    scenario.timeProvider.advance(frameMs);
    updateCallback?.(i);
  }
}

/**
 * Assert component values with better error messages
 */
export function assertComponentValue<T extends Component>(
  component: T | undefined,
  property: keyof T,
  expected: any,
  message?: string
): void {
  expect(component).toBeDefined(message || `Component should be defined`);
  if (component) {
    expect(component[property]).toEqual(expected, message || `${property.toString()} should be ${expected}`);
  }
}

/**
 * Create a spy that tracks call history with arguments
 */
export function createTrackingSpy<T extends (...args: any[]) => any>(
  name: string,
  returnValue?: ReturnType<T>
): jasmine.Spy<T> & { callHistory: Array<{ args: Parameters<T>; timestamp: number }> } {
  const callHistory: Array<{ args: Parameters<T>; timestamp: number }> = [];

  const spy = jasmine.createSpy(name, (...args: Parameters<T>) => {
    callHistory.push({ args, timestamp: Date.now() });
    return returnValue;
  }) as jasmine.Spy<T> & { callHistory: typeof callHistory };

  spy.callHistory = callHistory;

  return spy;
}
