import { Injectable } from '@angular/core';

/**
 * Camera state for the render loop, extracted from GameEngineService
 * (Photon-Swarm decomposition plan, Phase B). GameEngineService keeps
 * setCameraZoomScale/getCameraZoomScale as public delegates so
 * RenderingSystemService (the only external caller) needs no edit.
 *
 * Camera POSITION is deliberately absent. getCameraX()/getCameraY() had
 * zero callers, which left cameraX/cameraY as write-only dead state, which
 * in turn made RenderingSystemService's per-frame setCameraPosition() call
 * vestigial. Rather than keep a no-op setter that reads at the call site as
 * though the engine tracks the camera, the whole chain was removed. Every
 * renderer that needs camera position computes it locally and passes it
 * through function parameters; nothing ever round-tripped it through here.
 *
 * cameraZoomScale is preserved unchanged because it has a live reader
 * (RenderingSystemService builds it into the render context every frame).
 * It has no live WRITER, though: a repo-wide grep finds no caller of
 * setCameraZoomScale outside this class, its GameEngineService delegate and
 * their specs, so the value is a constant 1 today and every `/ zoom` and
 * `ctx.scale(zoom, zoom)` in game-rendering.service.ts is currently a no-op.
 * That is the mirror image of the camera-position chain deleted above and it
 * is deliberately NOT resolved here — deleting it changes the render path,
 * which this behavior-preserving PR is not scoped to touch. Wire a real zoom
 * writer or delete the field; do not leave it half-alive a third time.
 */
@Injectable({ providedIn: 'root' })
export class CameraStateService {
  private cameraZoomScale = 1;

  getCameraZoomScale(): number {
    return this.cameraZoomScale;
  }

  setCameraZoomScale(scale: number): void {
    this.cameraZoomScale = scale;
  }
}
