/**
 * Factory for creating components with initialized values
 * Avoids constructor parameter issues while maintaining type safety
 */

import { Ability, AbilityComponent, InvincibilityComponent } from '@photon/components';

export class ComponentFactory {
  /**
   * Create an AbilityComponent with initialized abilities
   */
  static createAbilityComponent(abilities: Ability[]): AbilityComponent {
    const component = new AbilityComponent();
    component.abilities = abilities;
    return component;
  }

  /**
   * Create an InvincibilityComponent with duration
   */
  static createInvincibilityComponent(durationMs: number): InvincibilityComponent {
    const component = new InvincibilityComponent();
    component.duration = durationMs;
    component.startTime = window.performance.now();
    return component;
  }

  /**
   * Reset an existing InvincibilityComponent
   */
  static resetInvincibility(component: InvincibilityComponent, durationMs: number): void {
    component.duration = durationMs;
    component.startTime = window.performance.now();
  }
}
