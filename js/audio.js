// Tone.js ラッパー：メロディ用シンセとパッド、ループ再生
/* global Tone */

const TICKS_PER_STEP = 48; // PPQ 192 / 4 (16分音符)

let lead, pad, transport, part, endId;
let loopTicks = 0;
let playing = false;
let unlocked = false;

export function isUnlocked() {
  return unlocked;
}

// iOS では最初のユーザー操作の中で呼ぶ
export async function unlock() {
  if (unlocked) return;
  try {
    // iOS のマナーモードでも鳴らす（Safari 16.4+）
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (e) {
    /* ignore */
  }
  await Tone.start();
  setup();
  unlocked = true;
}

function setup() {
  transport = Tone.getTransport();
  const reverb = new Tone.Reverb({ decay: 2.2, wet: 0.22 }).toDestination();
  lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.25 },
  }).connect(reverb);
  lead.volume.value = -6;
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 1100, Q: 0.4 }).connect(reverb);
  pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
    envelope: { attack: 0.25, decay: 0.4, sustain: 0.75, release: 0.9 },
  }).connect(filter);
  pad.volume.value = -22;
}

export function setBpm(bpm) {
  if (transport) transport.bpm.value = bpm;
}

// seq: { steps, notes:[{p,s,d}], chords:[{s,d,notes:[]}], loop, onEnd }
export function play(seq, bpm) {
  if (!unlocked) return;
  stop();
  transport.bpm.value = bpm;
  const events = [];
  for (const n of seq.notes) events.push({ time: `${n.s * TICKS_PER_STEP}i`, kind: 'n', p: n.p, d: n.d, v: n.v ?? 0.8 });
  for (const c of seq.chords || []) events.push({ time: `${c.s * TICKS_PER_STEP}i`, kind: 'c', notes: c.notes, d: c.d });

  loopTicks = seq.steps * TICKS_PER_STEP;
  part = new Tone.Part((time, ev) => {
    const dur = `${Math.max(1, ev.d * TICKS_PER_STEP - 6)}i`;
    if (ev.kind === 'n') lead.triggerAttackRelease(Tone.Frequency(ev.p, 'midi').toFrequency(), dur, time, ev.v);
    else pad.triggerAttackRelease(ev.notes.map((m) => Tone.Frequency(m, 'midi').toFrequency()), dur, time, 0.5);
  }, events);
  part.loop = !!seq.loop;
  part.loopEnd = `${loopTicks}i`;
  part.start(0);
  if (!seq.loop) {
    endId = transport.scheduleOnce(() => {
      Tone.getDraw().schedule(() => {
        stop();
        seq.onEnd && seq.onEnd();
      }, Tone.now());
    }, `${loopTicks + TICKS_PER_STEP * 2}i`);
  }
  transport.position = 0;
  transport.start('+0.05');
  playing = true;
}

export function stop() {
  if (!transport) return;
  transport.stop();
  transport.cancel(0);
  if (part) {
    part.dispose();
    part = null;
  }
  endId = null;
  lead.releaseAll();
  pad.releaseAll();
  playing = false;
}

export function isPlaying() {
  return playing;
}

// 現在の再生位置（16分ステップ、小数）
export function currentStep() {
  if (!playing || !transport || transport.state !== 'started') return -1;
  const t = transport.ticks;
  const pos = loopTicks && part && part.loop ? t % loopTicks : t;
  return pos / TICKS_PER_STEP;
}

// 単発で音を鳴らす（UIの手応え用）
export function blip(midi) {
  if (!unlocked) return;
  lead.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), 0.08, undefined, 0.4);
}
