import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const storageKey = 'photon-swarm-theme-preference';

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    TestBed.configureTestingModule({ providers: [ThemeService] });
  });

  afterEach(() => localStorage.removeItem(storageKey));

  it('starts in dark mode when there is no saved preference', () => {
    expect(TestBed.inject(ThemeService).isDayMode).toBeFalse();
  });

  it('persists a light choice across service instances', () => {
    const service = TestBed.inject(ThemeService);
    service.setDayMode(true);
    expect(service.isDayMode).toBeTrue();
    expect(localStorage.getItem(storageKey)).toBe('day');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ThemeService] });
    expect(TestBed.inject(ThemeService).isDayMode).toBeTrue();
  });
});
