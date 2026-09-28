import { getHeatOptions, getMasteryUnlockForLevel, getMaxHeatLevelForMastery, HEAT_DEFINITIONS } from './heat.config';

describe('Heat config', () => {
  it('derives player-facing pressure and reward copy from the runtime modifiers', () => {
    const options = getHeatOptions();
    const heatOne = options.find((option) => option.mode === 'hard');
    const heatTwo = options.find((option) => option.mode === 'extreme');

    expect(heatOne?.description).toBe('+30% enemy strength · +25% rewards');
    expect(heatTwo?.description).toBe('+60% enemy strength · +55% rewards');
    expect(getMasteryUnlockForLevel(1)).toContain('+25% rewards');
    expect(getMasteryUnlockForLevel(3)).toContain('+55% rewards');
  });

  it('uses the same mastery thresholds for availability and unlock copy', () => {
    expect(HEAT_DEFINITIONS.hard.requiredMastery).toBe(1);
    expect(HEAT_DEFINITIONS.extreme.requiredMastery).toBe(3);
    expect(getMaxHeatLevelForMastery(0)).toBe(0);
    expect(getMaxHeatLevelForMastery(1)).toBe(1);
    expect(getMaxHeatLevelForMastery(3)).toBe(2);
  });
});
