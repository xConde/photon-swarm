/**
 * Creates a canvas suitable for off-screen sprite rendering.
 * Uses OffscreenCanvas when available (Chrome, Firefox, Safari 16.4+),
 * falls back to a detached HTMLCanvasElement for older browsers.
 */
export type SpriteCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * Union of the 2D rendering contexts returned by SpriteCanvas.getContext('2d').
 * Both share the full CanvasRenderingContext2D API surface used for sprite drawing.
 */
export type SpriteContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Probe once at module load — catches Edge 79-83 where typeof check passes but constructor throws
let supportsOffscreen = false;
try {
  if (typeof OffscreenCanvas !== 'undefined') {
    new OffscreenCanvas(1, 1); // constructor test
    supportsOffscreen = true;
  }
} catch {
  supportsOffscreen = false;
}

export function createSpriteCanvas(width: number, height: number): SpriteCanvas {
  if (supportsOffscreen) {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
