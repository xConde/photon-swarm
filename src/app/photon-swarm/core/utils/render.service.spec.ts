import { TestBed } from '@angular/core/testing';

import { RenderService } from './render.service';

describe('RenderService', () => {
  let service: RenderService;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RenderService);

    // create in-memory canvas for rendering tests
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    spyOn(ctx, 'clearRect').and.callThrough();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('clear() should call clearRect on full canvas', () => {
    service.clear(ctx, 200, 100);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
  });
});
