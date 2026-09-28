/**
 * Spatial bounds for partitioning
 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Spatial entity data
 */
export interface SpatialEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  collisionGroup: string;
}

/**
 * Spatial partitioning statistics
 */
export interface SpatialStats {
  worldBounds: Bounds;
  entityCount: number;
  quadTreeStats: QuadTreeStats;
}

/**
 * QuadTree statistics
 */
export interface QuadTreeStats {
  nodeCount: number;
  depth: number;
  entitiesPerNode: number;
  nodes: number;
  entities: number;
  maxDepth: number;
}

/**
 * Quadtree node for spatial partitioning
 */
export class QuadTreeNode {
  public bounds: Bounds;
  public entities: SpatialEntity[] = [];
  public children: QuadTreeNode[] = [];
  public divided: boolean = false;

  constructor(
    bounds: Bounds,
    private maxEntities: number = 10,
    private maxDepth: number = 5,
    private depth: number = 0
  ) {
    this.bounds = bounds;
  }

  /**
   * Insert entity into quadtree
   */
  insert(entity: SpatialEntity): boolean {
    if (!this.contains(entity)) {
      return false;
    }

    if (this.entities.length < this.maxEntities && !this.divided) {
      this.entities.push(entity);
      return true;
    }

    if (!this.divided) {
      this.subdivide();
    }

    // Try to insert into children
    for (const child of this.children) {
      if (child.insert(entity)) {
        return true;
      }
    }

    // If no child can contain it, keep it in this node
    this.entities.push(entity);
    return true;
  }

  /**
   * Query entities within bounds
   */
  query(bounds: Bounds, result: SpatialEntity[] = []): SpatialEntity[] {
    if (!this.intersects(bounds)) {
      return result;
    }

    // Check entities in this node
    for (const entity of this.entities) {
      if (this.entityInBounds(entity, bounds)) {
        result.push(entity);
      }
    }

    // Check children
    if (this.divided) {
      for (const child of this.children) {
        child.query(bounds, result);
      }
    }

    return result;
  }

  /**
   * Query entities within radius of a point
   */
  queryRadius(x: number, y: number, radius: number, result: SpatialEntity[] = []): SpatialEntity[] {
    const bounds: Bounds = {
      x: x - radius,
      y: y - radius,
      width: radius * 2,
      height: radius * 2,
    };

    const candidates = this.query(bounds);

    // Filter by actual distance
    for (const entity of candidates) {
      const dx = entity.x - x;
      const dy = entity.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius + entity.radius) {
        result.push(entity);
      }
    }

    return result;
  }

  /**
   * Check if entity is contained within this node
   */
  private contains(entity: SpatialEntity): boolean {
    return (
      entity.x >= this.bounds.x &&
      entity.x < this.bounds.x + this.bounds.width &&
      entity.y >= this.bounds.y &&
      entity.y < this.bounds.y + this.bounds.height
    );
  }

  /**
   * Check if bounds intersect with this node
   */
  private intersects(bounds: Bounds): boolean {
    return !(
      bounds.x > this.bounds.x + this.bounds.width ||
      bounds.x + bounds.width < this.bounds.x ||
      bounds.y > this.bounds.y + this.bounds.height ||
      bounds.y + bounds.height < this.bounds.y
    );
  }

  /**
   * Check if entity is within given bounds
   */
  private entityInBounds(entity: SpatialEntity, bounds: Bounds): boolean {
    return (
      entity.x >= bounds.x &&
      entity.x <= bounds.x + bounds.width &&
      entity.y >= bounds.y &&
      entity.y <= bounds.y + bounds.height
    );
  }

  /**
   * Subdivide this node into 4 children
   */
  private subdivide(): void {
    if (this.depth >= this.maxDepth) {
      return;
    }

    const halfWidth = this.bounds.width / 2;
    const halfHeight = this.bounds.height / 2;

    // Northwest
    this.children.push(
      new QuadTreeNode(
        {
          x: this.bounds.x,
          y: this.bounds.y,
          width: halfWidth,
          height: halfHeight,
        },
        this.maxEntities,
        this.maxDepth,
        this.depth + 1
      )
    );

    // Northeast
    this.children.push(
      new QuadTreeNode(
        {
          x: this.bounds.x + halfWidth,
          y: this.bounds.y,
          width: halfWidth,
          height: halfHeight,
        },
        this.maxEntities,
        this.maxDepth,
        this.depth + 1
      )
    );

    // Southwest
    this.children.push(
      new QuadTreeNode(
        {
          x: this.bounds.x,
          y: this.bounds.y + halfHeight,
          width: halfWidth,
          height: halfHeight,
        },
        this.maxEntities,
        this.maxDepth,
        this.depth + 1
      )
    );

    // Southeast
    this.children.push(
      new QuadTreeNode(
        {
          x: this.bounds.x + halfWidth,
          y: this.bounds.y + halfHeight,
          width: halfWidth,
          height: halfHeight,
        },
        this.maxEntities,
        this.maxDepth,
        this.depth + 1
      )
    );

    this.divided = true;

    // Move entities to children
    const entitiesForChildren = [...this.entities];
    this.entities = [];

    for (const entity of entitiesForChildren) {
      let inserted = false;
      for (const child of this.children) {
        if (child.insert(entity)) {
          inserted = true;
          break;
        }
      }

      // If no child can contain it, keep it in this node
      if (!inserted) {
        this.entities.push(entity);
      }
    }
  }

  /**
   * Clear the tree
   */
  clear(): void {
    this.entities = [];
    this.children = [];
    this.divided = false;
  }

  /**
   * Get tree statistics
   */
  getStats(): { nodes: number; entities: number; maxDepth: number } {
    let nodeCount = 1;
    let entityCount = this.entities.length;
    let maxDepth = this.depth;

    for (const child of this.children) {
      const childStats = child.getStats();
      nodeCount += childStats.nodes;
      entityCount += childStats.entities;
      maxDepth = Math.max(maxDepth, childStats.maxDepth);
    }

    return { nodes: nodeCount, entities: entityCount, maxDepth };
  }
}

// This file formerly defined SpatialPartitioningService (removed + file renamed to
// quadtree.ts on 2026-06-01): the service was never populated — insertEntity/updateEntity
// were never called from the game loop, so queryRadius always returned []. QuadTreeNode
// and the interfaces above are kept because EnemyMovementSystemService and
// FactionAISystemService maintain their own self-populated local QuadTreeNode instances.
