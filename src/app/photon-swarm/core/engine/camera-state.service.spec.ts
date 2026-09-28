import { TestBed } from '@angular/core/testing';
import { CameraStateService } from './camera-state.service';

describe('CameraStateService', () => {
  let service: CameraStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CameraStateService] });
    service = TestBed.inject(CameraStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('defaults zoom scale to 1', () => {
    expect(service.getCameraZoomScale()).toBe(1);
  });

  it('setCameraZoomScale updates the value read back by getCameraZoomScale', () => {
    service.setCameraZoomScale(1.5);
    expect(service.getCameraZoomScale()).toBe(1.5);
  });
});
