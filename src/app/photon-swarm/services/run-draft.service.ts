import { Injectable } from '@angular/core';
import { AscensionService } from './ascension.service';

/** Owns the deliberately small number of refit redraws available in one run. */
@Injectable({ providedIn: 'root' })
export class RunDraftService {
  private used = 0;

  constructor(private readonly ascension: AscensionService) {}

  getCapacity(): number {
    return this.ascension.getRerollCharges();
  }

  getRemaining(): number {
    return Math.max(0, this.getCapacity() - this.used);
  }

  consume(): boolean {
    if (this.getRemaining() <= 0) return false;
    this.used++;
    return true;
  }

  reset(): void {
    this.used = 0;
  }
}
