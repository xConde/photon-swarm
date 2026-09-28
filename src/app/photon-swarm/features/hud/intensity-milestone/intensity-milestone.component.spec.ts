import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { IntensityMilestoneComponent } from './intensity-milestone.component';
import { IntensityMilestone, IntensityService } from '../../../core/systems/combat';
import { PostProcessingService } from '../../../core/effects/post-processing.service';
import { CameraShakeService } from '../../../core/effects/camera-shake.service';

describe('IntensityMilestoneComponent', () => {
  let intensitySpy: jasmine.SpyObj<IntensityService>;
  let postProcessingSpy: jasmine.SpyObj<PostProcessingService>;
  let cameraShakeSpy: jasmine.SpyObj<CameraShakeService>;
  let milestones$: Subject<IntensityMilestone>;

  beforeEach(async () => {
    milestones$ = new Subject<IntensityMilestone>();

    intensitySpy = jasmine.createSpyObj('IntensityService', ['getState', 'getMilestones']);
    intensitySpy.getMilestones.and.returnValue(milestones$.asObservable());

    postProcessingSpy = jasmine.createSpyObj('PostProcessingService', ['addScreenFlash', 'addChromaticAberration']);

    cameraShakeSpy = jasmine.createSpyObj('CameraShakeService', ['addShake']);

    await TestBed.configureTestingModule({
      imports: [IntensityMilestoneComponent],
      providers: [
        { provide: IntensityService, useValue: intensitySpy },
        { provide: PostProcessingService, useValue: postProcessingSpy },
        { provide: CameraShakeService, useValue: cameraShakeSpy },
      ],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(IntensityMilestoneComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    fixture.destroy();
  });

  it('should start with visible = false', () => {
    const fixture = TestBed.createComponent(IntensityMilestoneComponent);
    expect(fixture.componentInstance.visible).toBe(false);
    fixture.destroy();
  });

  it('should start with milestoneText empty', () => {
    const fixture = TestBed.createComponent(IntensityMilestoneComponent);
    expect(fixture.componentInstance.milestoneText).toBe('');
    fixture.destroy();
  });

  it('should start with currentTier as "idle"', () => {
    const fixture = TestBed.createComponent(IntensityMilestoneComponent);
    expect(fixture.componentInstance.currentTier).toBe('idle');
    fixture.destroy();
  });
});
