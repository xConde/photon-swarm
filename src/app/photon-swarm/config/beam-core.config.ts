import { BeamCoreId, BeamCoreProfile } from '../core/models/run-build.model';

export const DEFAULT_BEAM_CORE_PROFILE: BeamCoreProfile = {
  id: 'lance',
  name: 'Unshaped Beam',
  designation: 'UNBOUND',
  description: 'Standard emitter geometry awaiting a core imprint.',
  signature: 'Balanced emitter',
  tradeoff: 'No specialization',
  tags: ['beam'],
  damageMultiplier: 1,
  lengthMultiplier: 1,
  widthMultiplier: 1,
  rotationMultiplier: 1,
  angleOffsets: [0],
  rayOverlapDamageBonus: 0,
  chainTargets: 0,
  chainRange: 0,
  chainDamageMultiplier: 0,
};

export const BEAM_CORE_PROFILES: Readonly<Record<BeamCoreId, BeamCoreProfile>> = {
  lance: {
    id: 'lance',
    name: 'Lance Core',
    designation: 'LNC-01',
    description: 'Compress the beam into a long-range cutting line built for deliberate aim.',
    signature: 'Long, narrow, high-output beam',
    tradeoff: 'Thirty percent slower turning',
    tags: ['beam', 'kinetic'],
    damageMultiplier: 1.25,
    lengthMultiplier: 1.4,
    widthMultiplier: 0.58,
    rotationMultiplier: 0.7,
    angleOffsets: [0],
    rayOverlapDamageBonus: 0,
    chainTargets: 0,
    chainRange: 0,
    chainDamageMultiplier: 0,
  },
  prism: {
    id: 'prism',
    name: 'Prism Core',
    designation: 'PRS-03',
    description: 'Refract the emitter into a three-ray fan that controls the space ahead of the hull.',
    signature: 'Three diverging beams',
    tradeoff: 'Each ray deals reduced damage',
    tags: ['beam', 'thermal'],
    damageMultiplier: 0.72,
    lengthMultiplier: 0.95,
    widthMultiplier: 0.82,
    rotationMultiplier: 1,
    angleOffsets: [-0.2, 0, 0.2],
    rayOverlapDamageBonus: 0,
    chainTargets: 0,
    chainRange: 0,
    chainDamageMultiplier: 0,
  },
  arc: {
    id: 'arc',
    name: 'Arc Core',
    designation: 'ARC-02',
    description: 'Ground the beam through nearby hulls, turning one clean hit into a cascading discharge.',
    signature: 'Hits jump to two nearby targets',
    tradeoff: 'Shorter reach and lower direct damage',
    tags: ['beam', 'discharge'],
    damageMultiplier: 0.82,
    lengthMultiplier: 0.78,
    widthMultiplier: 1.12,
    rotationMultiplier: 1.12,
    angleOffsets: [0],
    rayOverlapDamageBonus: 0,
    chainTargets: 2,
    chainRange: 220,
    chainDamageMultiplier: 0.55,
  },
} as const;

export const BEAM_CORE_IDS = Object.freeze(Object.keys(BEAM_CORE_PROFILES) as BeamCoreId[]);

export function getBeamCoreProfile(id: BeamCoreId | null): BeamCoreProfile {
  return id ? BEAM_CORE_PROFILES[id] : DEFAULT_BEAM_CORE_PROFILE;
}
