import { TestBed } from '@angular/core/testing';
import { ProjectileSystemService } from './projectile-system.service';
import { CONTROL_CONSTANTS } from '../../controls/control-constants';

describe('ProjectileSystemService', () => {
  let service: ProjectileSystemService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProjectileSystemService],
    });

    service = TestBed.inject(ProjectileSystemService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should use centralized control constants', () => {
    expect(CONTROL_CONSTANTS.ACTION_NAMES.TARGET).toBe('Target');
  });
});
