import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';

const THEME_STORAGE_KEY = 'photon-swarm-theme-preference';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  // PLATFORM_ID guard: localStorage is browser-only.
  private readonly platformId = inject(PLATFORM_ID);

  private isDayModeSubject = new BehaviorSubject<boolean>(this.getInitialTheme());
  isDayMode$ = this.isDayModeSubject.asObservable();

  get isDayMode(): boolean {
    return this.isDayModeSubject.value;
  }

  toggleDayMode(): void {
    this.setDayMode(!this.isDayModeSubject.value);
  }

  setDayMode(isDayMode: boolean): void {
    this.isDayModeSubject.next(isDayMode);
    this.saveThemePreference(isDayMode);
  }

  /**
   * Determines initial theme:
   * 1. Check localStorage for saved preference (browser only)
   * 2. Default to night mode (false)
   */
  private getInitialTheme(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    // Check localStorage first
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved !== null) {
      return saved === 'day';
    }

    return false;
  }

  private saveThemePreference(isDayMode: boolean): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(THEME_STORAGE_KEY, isDayMode ? 'day' : 'night');
  }
}
