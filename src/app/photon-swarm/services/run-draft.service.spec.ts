import { TestBed } from '@angular/core/testing';
import { AscensionService } from './ascension.service';
import { RunDraftService } from './run-draft.service';

describe('RunDraftService', () => {
  let ascension: jasmine.SpyObj<AscensionService>;
  let service: RunDraftService;

  beforeEach(() => {
    ascension = jasmine.createSpyObj<AscensionService>('AscensionService', ['getRerollCharges']);
    ascension.getRerollCharges.and.returnValue(1);
    TestBed.configureTestingModule({
      providers: [RunDraftService, { provide: AscensionService, useValue: ascension }],
    });
    service = TestBed.inject(RunDraftService);
  });

  it('consumes the finite refit allowance', () => {
    expect(service.getRemaining()).toBe(1);
    expect(service.consume()).toBeTrue();
    expect(service.getRemaining()).toBe(0);
    expect(service.consume()).toBeFalse();
  });

  it('resets refits on a new run and respects mastery capacity', () => {
    ascension.getRerollCharges.and.returnValue(2);
    service.consume();
    service.consume();
    service.reset();
    expect(service.getRemaining()).toBe(2);
  });
});
