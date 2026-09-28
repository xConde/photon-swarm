import { AbilityComponent, AbilityType } from './ability.component';

describe('AbilityComponent', () => {
  let component: AbilityComponent;

  beforeEach(() => {
    component = new AbilityComponent();
  });

  describe('initialization', () => {
    it('should create with default values', () => {
      expect(component).toBeTruthy();
      expect(component.name).toBe('AbilityComponent');
      expect(component.abilities).toEqual([]);
      expect(component.currentAbilityIndex).toBe(0);
      expect(component.nextAbilityTime).toBe(0);
    });
  });

  describe('canUseAbility', () => {
    beforeEach(() => {
      component.abilities = [
        {
          type: AbilityType.AREA_BUFF,
          cooldownMs: 5000,
          lastUsedTime: 0,
        },
        {
          type: AbilityType.POISON_CLOUD,
          cooldownMs: 3000,
          lastUsedTime: 0,
        },
      ];
    });

    it('should return true when ability is off cooldown', () => {
      const currentTime = 10000;
      expect(component.canUseAbility(AbilityType.AREA_BUFF, currentTime)).toBe(true);
    });

    it('should return false when ability is on cooldown', () => {
      component.abilities[0].lastUsedTime = 8000;
      const currentTime = 10000; // Only 2 seconds passed, need 5
      expect(component.canUseAbility(AbilityType.AREA_BUFF, currentTime)).toBe(false);
    });

    it('should return false for ability type not in list', () => {
      const currentTime = 10000;
      expect(component.canUseAbility(AbilityType.SHELL_RETREAT, currentTime)).toBe(false);
    });

    it('should handle edge case of exact cooldown time', () => {
      component.abilities[0].lastUsedTime = 5000;
      const currentTime = 10000; // Exactly 5 seconds passed
      expect(component.canUseAbility(AbilityType.AREA_BUFF, currentTime)).toBe(true);
    });
  });

  describe('useAbility', () => {
    beforeEach(() => {
      component.abilities = [
        {
          type: AbilityType.AREA_BUFF,
          cooldownMs: 5000,
          lastUsedTime: 0,
        },
      ];
    });

    it('should update lastUsedTime when ability is used', () => {
      const currentTime = 10000;
      const result = component.useAbility(AbilityType.AREA_BUFF, currentTime);

      expect(result).toBe(true);
      expect(component.abilities[0].lastUsedTime).toBe(currentTime);
    });

    it('should return false when ability is on cooldown', () => {
      component.abilities[0].lastUsedTime = 8000;
      const currentTime = 10000;
      const result = component.useAbility(AbilityType.AREA_BUFF, currentTime);

      expect(result).toBe(false);
      expect(component.abilities[0].lastUsedTime).toBe(8000); // Unchanged
    });

    it('should return false for unknown ability', () => {
      const currentTime = 10000;
      const result = component.useAbility(AbilityType.SHELL_RETREAT, currentTime);

      expect(result).toBe(false);
    });

    it('should mark ability as active when used', () => {
      const currentTime = 10000;
      component.abilities[0].duration = 2000;

      component.useAbility(AbilityType.AREA_BUFF, currentTime);

      expect(component.abilities[0].isActive).toBe(true);
      expect(component.abilities[0].activeUntil).toBe(currentTime + 2000);
    });
  });

  describe('getNextAbility', () => {
    it('should return null when no abilities', () => {
      expect(component.getNextAbility()).toBeNull();
    });

    it('should cycle through abilities', () => {
      component.abilities = [
        { type: AbilityType.AREA_BUFF, cooldownMs: 1000, lastUsedTime: 0 },
        { type: AbilityType.POISON_CLOUD, cooldownMs: 1000, lastUsedTime: 0 },
        { type: AbilityType.SHELL_RETREAT, cooldownMs: 1000, lastUsedTime: 0 },
      ];

      expect(component.getNextAbility()?.type).toBe(AbilityType.AREA_BUFF);
      expect(component.currentAbilityIndex).toBe(1);

      expect(component.getNextAbility()?.type).toBe(AbilityType.POISON_CLOUD);
      expect(component.currentAbilityIndex).toBe(2);

      expect(component.getNextAbility()?.type).toBe(AbilityType.SHELL_RETREAT);
      expect(component.currentAbilityIndex).toBe(0); // Wrapped around

      expect(component.getNextAbility()?.type).toBe(AbilityType.AREA_BUFF);
      expect(component.currentAbilityIndex).toBe(1);
    });

    it('should handle single ability', () => {
      component.abilities = [{ type: AbilityType.AREA_BUFF, cooldownMs: 1000, lastUsedTime: 0 }];

      expect(component.getNextAbility()?.type).toBe(AbilityType.AREA_BUFF);
      expect(component.currentAbilityIndex).toBe(0); // Stays at 0

      expect(component.getNextAbility()?.type).toBe(AbilityType.AREA_BUFF);
      expect(component.currentAbilityIndex).toBe(0);
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple abilities with different cooldowns', () => {
      component.abilities = [
        { type: AbilityType.AREA_BUFF, cooldownMs: 5000, lastUsedTime: 0 },
        { type: AbilityType.POISON_CLOUD, cooldownMs: 3000, lastUsedTime: 0 },
        { type: AbilityType.SHELL_RETREAT, cooldownMs: 10000, lastUsedTime: 0 },
      ];

      const time1 = 10000;
      expect(component.canUseAbility(AbilityType.AREA_BUFF, time1)).toBe(true);
      expect(component.canUseAbility(AbilityType.POISON_CLOUD, time1)).toBe(true);
      expect(component.canUseAbility(AbilityType.SHELL_RETREAT, time1)).toBe(true);

      // Use all abilities
      component.useAbility(AbilityType.AREA_BUFF, time1);
      component.useAbility(AbilityType.POISON_CLOUD, time1);
      component.useAbility(AbilityType.SHELL_RETREAT, time1);

      // Check after 4 seconds (only poison cloud ready)
      const time2 = 14000;
      expect(component.canUseAbility(AbilityType.AREA_BUFF, time2)).toBe(false);
      expect(component.canUseAbility(AbilityType.POISON_CLOUD, time2)).toBe(true);
      expect(component.canUseAbility(AbilityType.SHELL_RETREAT, time2)).toBe(false);

      // Check after 6 seconds (buff and poison ready)
      const time3 = 16000;
      expect(component.canUseAbility(AbilityType.AREA_BUFF, time3)).toBe(true);
      expect(component.canUseAbility(AbilityType.POISON_CLOUD, time3)).toBe(true);
      expect(component.canUseAbility(AbilityType.SHELL_RETREAT, time3)).toBe(false);
    });

    it('should track active abilities correctly', () => {
      component.abilities = [
        {
          type: AbilityType.AREA_BUFF,
          cooldownMs: 5000,
          lastUsedTime: 0,
          duration: 2000,
        },
      ];

      const currentTime = 10000;
      component.useAbility(AbilityType.AREA_BUFF, currentTime);

      // Check immediately after use
      const ability = component.abilities[0];
      expect(ability.isActive).toBe(true);
      expect(ability.activeUntil).toBe(12000);

      // Simulate checking if still active
      expect(ability.activeUntil! > currentTime + 1000).toBe(true); // Still active after 1s
      expect(ability.activeUntil! > currentTime + 2000).toBe(false); // Not active after 2s
    });
  });
});
