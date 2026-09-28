import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { PlayerService } from '../../core/player/player.service';

/**
 * Renders a live ship-hull preview onto a small canvas.
 * Delegates to PlayerService.renderShipPreview() so the exact same bake path
 * used in gameplay is reused — no duplicate geometry code.
 */
@Component({
  selector: 'app-ship-preview',
  standalone: true,
  template: `<canvas #previewCanvas width="144" height="144" aria-hidden="true"></canvas>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShipPreviewComponent implements AfterViewInit, OnChanges {
  @Input() shapeId = 'default-circle';
  @Input() fillColor = 'white';

  @ViewChild('previewCanvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  constructor(private playerService: PlayerService) {}

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    // canvasRef is only set after view init; skip the pre-init call
    if (this.canvasRef) {
      this.render();
    }
  }

  private render(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.playerService.renderShipPreview(ctx, this.shapeId, this.fillColor);
  }
}
