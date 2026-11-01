// Procedural Web Audio Sound Engine (Zero external audio files required)
// Produces punchy, realistic gunshots, impacts, reloads, and zombie vocals.

let ctx = null;

function getContext() {
  if (!ctx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

// User interaction unlocker
if (typeof window !== 'undefined') {
  const unlock = () => {
    getContext();
    ['click', 'keydown', 'mousedown', 'touchstart'].forEach(e => window.removeEventListener(e, unlock));
  };
  ['click', 'keydown', 'mousedown', 'touchstart'].forEach(e => window.addEventListener(e, unlock, { once: true, passive: true }));
}

// White noise buffer generator for gun cracks & blast transients
let noiseBuffer = null;
function getNoiseBuffer(ac) {
  if (noiseBuffer) return noiseBuffer;
  const bufferSize = ac.sampleRate * 2;
  noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/**
 * Play a gunshot sound
 * @param {'pistol'|'smg'|'shotgun'|'rifle'} weapon
 */
export function playGunshot(weapon = 'pistol') {
  const ac = getContext();
  if (!ac) return;
  const now = ac.currentTime;

  // 1. Noise transient (gunpowder explosion & mechanical snap)
  const noise = ac.createBufferSource();
  noise.buffer = getNoiseBuffer(ac);

  const filter = ac.createBiquadFilter();
  const noiseGain = ac.createGain();

  // 2. Low-frequency punch oscillator (body/thump)
  const osc = ac.createOscillator();
  const oscGain = ac.createGain();

  if (weapon === 'smg') {
    // Sharp rapid 9mm snap
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, now);
    filter.Q.setValueAtTime(1.5, now);

    noiseGain.gain.setValueAtTime(0.7, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);

    oscGain.gain.setValueAtTime(0.5, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    noise.connect(filter).connect(noiseGain).connect(ac.destination);
    osc.connect(oscGain).connect(ac.destination);

    noise.start(now);
    noise.stop(now + 0.13);
    osc.start(now);
    osc.stop(now + 0.09);

  } else if (weapon === 'shotgun') {
    // Massive 12-gauge blast
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.linearRampToValueAtTime(800, now + 0.35);

    noiseGain.gain.setValueAtTime(1.0, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.28);

    oscGain.gain.setValueAtTime(0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

    // Sub rumble
    const sub = ac.createOscillator();
    const subGain = ac.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90, now);
    sub.frequency.exponentialRampToValueAtTime(25, now + 0.4);
    subGain.gain.setValueAtTime(0.8, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    noise.connect(filter).connect(noiseGain).connect(ac.destination);
    osc.connect(oscGain).connect(ac.destination);
    sub.connect(subGain).connect(ac.destination);

    noise.start(now);
    noise.stop(now + 0.46);
    osc.start(now);
    osc.stop(now + 0.31);
    sub.start(now);
    sub.stop(now + 0.41);

  } else if (weapon === 'rifle') {
    // High-powered supersonic crack + heavy echoing boom
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1200, now);

    noiseGain.gain.setValueAtTime(1.0, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.22);

    oscGain.gain.setValueAtTime(0.85, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    noise.connect(filter).connect(noiseGain).connect(ac.destination);
    osc.connect(oscGain).connect(ac.destination);

    noise.start(now);
    noise.stop(now + 0.3);
    osc.start(now);
    osc.stop(now + 0.26);

  } else {
    // Pistol: punchy .45 caliber crack
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.Q.setValueAtTime(1.2, now);

    noiseGain.gain.setValueAtTime(0.85, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.14);

    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    noise.connect(filter).connect(noiseGain).connect(ac.destination);
    osc.connect(oscGain).connect(ac.destination);

    noise.start(now);
    noise.stop(now + 0.19);
    osc.start(now);
    osc.stop(now + 0.16);
  }
}

/**
 * Play weapon reload sound (mechanical slide racking)
 */
export function playReload() {
  const ac = getContext();
  if (!ac) return;
  const now = ac.currentTime;

  // Slide pull (friction scrape)
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.linearRampToValueAtTime(900, now + 0.12);
  osc.frequency.linearRampToValueAtTime(600, now + 0.2);

  gain.gain.setValueAtTime(0.15, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.26);

  // Metallic chamber click
  setTimeout(() => {
    if (!ac) return;
    const clickNow = ac.currentTime;
    const click = ac.createOscillator();
    const clickGain = ac.createGain();
    click.type = 'square';
    click.frequency.setValueAtTime(1400, clickNow);
    clickGain.gain.setValueAtTime(0.35, clickNow);
    clickGain.gain.exponentialRampToValueAtTime(0.001, clickNow + 0.06);

    click.connect(clickGain).connect(ac.destination);
    click.start(clickNow);
    click.stop(clickNow + 0.07);
  }, 350);
}

/**
 * Bullet hitting zombie flesh
 */
export function playHit(headshot = false) {
  const ac = getContext();
  if (!ac) return;
  const now = ac.currentTime;

  // Wet thud
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = headshot ? 'triangle' : 'sine';
  osc.frequency.setValueAtTime(headshot ? 500 : 220, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);

  gain.gain.setValueAtTime(headshot ? 0.6 : 0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.1);

  if (headshot) {
    // Satisfying high skull-crack chime
    const ping = ac.createOscillator();
    const pingGain = ac.createGain();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(1800, now);
    ping.frequency.exponentialRampToValueAtTime(900, now + 0.12);
    pingGain.gain.setValueAtTime(0.4, now);
    pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    ping.connect(pingGain).connect(ac.destination);
    ping.start(now);
    ping.stop(now + 0.13);
  }
}

/**
 * Zombie death groans & guttural shrieks
 */
export function playZombieDeath(type = 0) {
  const ac = getContext();
  if (!ac) return;
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sawtooth';

  if (type === 2) {
    // Brute deep roar
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(50, now + 0.6);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
  } else if (type === 1) {
    // Runner high screech
    osc.frequency.setValueAtTime(450, now);
    osc.frequency.linearRampToValueAtTime(180, now + 0.35);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
  } else {
    // Walker raspy death groan
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(80, now + 0.45);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
  }

  // Distortion filter
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800, now);

  osc.connect(filter).connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.7);
}

/**
 * Pickup collection chime
 */
export function playPickup(type = 'ammo') {
  const ac = getContext();
  if (!ac) return;
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';

  const baseFreq = type === 'health' ? 523.25 : (type === 'armor' ? 659.25 : 783.99); // C5, E5, G5
  osc.frequency.setValueAtTime(baseFreq, now);
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.15);

  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.24);
}

/**
 * Player hurt grunt / melee impact
 */
export function playPlayerHurt() {
  const ac = getContext();
  if (!ac) return;
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.linearRampToValueAtTime(70, now + 0.15);

  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}
