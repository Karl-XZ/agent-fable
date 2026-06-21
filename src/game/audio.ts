import * as Tone from 'tone';

let initialized = false;

// Synthesizers
let doorSynth: Tone.Synth;
let destroySynth: Tone.MembraneSynth;
let errorSynth: Tone.FMSynth;
let jumpSynth: Tone.MembraneSynth;
let mapRewriteSynth: Tone.FMSynth;
let lastMapRewriteTime = 0;

const safePlay = (play: () => void) => {
  try {
    play();
  } catch (error) {
    console.warn('Audio playback skipped:', error);
  }
};

export const initAudio = async () => {
  if (initialized) return;
  await Tone.start();
  
  jumpSynth = new Tone.MembraneSynth({
    pitchDecay: 0.2,
    octaves: 1.2,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 }
  }).toDestination();
  jumpSynth.volume.value = -15;

  doorSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.1, decay: 0.1, sustain: 0.5, release: 1 }
  }).toDestination();
  doorSynth.volume.value = -10;
  
  destroySynth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 10,
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 }
  }).toDestination();
  destroySynth.volume.value = -5;

  errorSynth = new Tone.FMSynth({
    modulationIndex: 12.22,
    envelope: { attack: 0.01, decay: 0.2 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.2, decay: 0.01 }
  }).toDestination();
  errorSynth.volume.value = -15;

  mapRewriteSynth = new Tone.FMSynth({
    harmonicity: 1.7,
    modulationIndex: 18,
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.005, decay: 0.16, sustain: 0.02, release: 0.2 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.08 }
  }).toDestination();
  mapRewriteSynth.volume.value = -10;

  // Background white noise drone
  const filter = new Tone.Filter(400, "lowpass").toDestination();
  const noise = new Tone.Noise("pink").connect(filter);
  noise.volume.value = -20;
  noise.start();
  
  const lfo = new Tone.LFO(0.1, 200, 800).connect(filter.frequency);
  lfo.start();

  initialized = true;
};

export const playJump = () => {
  if (!initialized) return;
  safePlay(() => jumpSynth.triggerAttackRelease("C2", "8n"));
};

export const playDoorOpen = () => {
  if (!initialized) return;
  safePlay(() => {
    const now = Tone.now();
    doorSynth.triggerAttackRelease("C4", "8n", now);
    doorSynth.triggerAttackRelease("E4", "8n", now + 0.15);
  });
};

export const playDoorClose = () => {
  if (!initialized) return;
  safePlay(() => {
    const now = Tone.now();
    doorSynth.triggerAttackRelease("E4", "8n", now);
    doorSynth.triggerAttackRelease("C4", "8n", now + 0.15);
  });
};

export const playDestroy = () => {
  if (!initialized) return;
  safePlay(() => destroySynth.triggerAttackRelease("C2", "8n"));
};

export const playError = () => {
  if (!initialized) return;
  safePlay(() => errorSynth.triggerAttackRelease("A2", "16n"));
};

export const playMapRewrite = () => {
  if (!initialized) return;
  safePlay(() => {
    const start = Math.max(Tone.now(), lastMapRewriteTime + 0.02);
    mapRewriteSynth.triggerAttackRelease("F#3", "32n", start);
    mapRewriteSynth.triggerAttackRelease("C4", "32n", start + 0.08);
    mapRewriteSynth.triggerAttackRelease("A2", "16n", start + 0.15);
    lastMapRewriteTime = start + 0.22;
  });
};
