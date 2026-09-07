// Synthetic firmware-shaped data, independent of the verifier's requirements.
// Never load a private device capture in the automated test suite.
export function stagehandFixture() {
  const object = (value, methods = []) => ({
    value,
    meta: {
      properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, { type: typeof item }])),
      'x-methods': Object.fromEntries(methods.map((name) => [name, { argumentsMeta: [] }])),
    },
  });
  return {
    '/Evil/Engine/Patch/Rig': object({ PresetName: 'QA Stage Rig', Tempo: 120 }),
    '/Evil/Engine/Patch/Chain': object(Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`ModuleType${index + 1}`, index < 4 ? index + 1 : 0]))),
    '/Evil/Engine/FootSwitch': object({ LastScene: 3, LastSceneState: 0, SceneActive1: false, SceneActive2: false, SceneActive3: false, SceneActive4: true, SceneActive5: false, SceneActive6: false }),
    '/Evil/Engine/DrumsCtrl': object({ Kit: 'QA Kit', PartInfo: 'Verse', currentBar: 2, currentBeat: 1, isMuted: false, isPlaying: true }, ['togglePlay', 'playFill', 'playBridge', 'playOutro', 'toggleMute', 'playAccent', 'stopAccent', 'restart']),
    '/Evil/Engine/AudioCtrl/Input': object({ TunerOn: true }),
    '/Evil/Engine/AudioCtrl/Tuner': object({ TunerMuting: false }),
    '/Evil/Engine/FFTCtrl': object({ TunerCents: -3, TunerRef: 440, TunerString: 'A' }),
    '/Evil/Engine/Tempo': {
      value: { Tempo: (120 - 30) / (240 - 30) },
      meta: { properties: { Tempo: { type: 'number', minimum: 30, maximum: 240 } } },
    },
  };
}
