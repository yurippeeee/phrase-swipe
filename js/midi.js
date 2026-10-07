// Standard MIDI File (format 1) 書き出し

const PPQ = 480;
const TICKS_PER_STEP = PPQ / 4;

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

function str(s) {
  return [...new TextEncoder().encode(s)];
}

function u32(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

// events: [{ t(tick), data:[...] }]
function track(name, events) {
  const evs = [{ t: 0, order: 0, data: [0xff, 0x03, ...vlq(str(name).length), ...str(name)] }, ...events];
  evs.sort((a, b) => a.t - b.t || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of evs) {
    body.push(...vlq(e.t - last), ...e.data);
    last = e.t;
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...str('MTrk'), ...u32(body.length), ...body];
}

function noteEvents(notes, ch, vel) {
  const out = [];
  for (const n of notes) {
    // note off を同時刻の note on より先に並べる
    out.push({ t: n.t, order: 2, data: [0x90 | ch, n.p, vel] });
    out.push({ t: n.t + n.len, order: 1, data: [0x80 | ch, n.p, 0] });
  }
  return out;
}

// song: { bpm, melody:[{p,s,d}], chords:[{s,d,notes:[]}] }（s,d は16分ステップ）
export function buildMidi(song) {
  const tempo = Math.round(60000000 / song.bpm);
  const conductor = track('Phrase Swipe', [
    { t: 0, order: 0, data: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { t: 0, order: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ]);
  const mel = song.melody.map((n) => ({ p: n.p, t: n.s * TICKS_PER_STEP, len: Math.max(1, n.d * TICKS_PER_STEP - 10) }));
  const melody = track('Melody', [{ t: 0, order: 0, data: [0xc0, 0] }, ...noteEvents(mel, 0, 96)]);
  const ch = [];
  for (const c of song.chords) for (const p of c.notes) ch.push({ p, t: c.s * TICKS_PER_STEP, len: c.d * TICKS_PER_STEP - 10 });
  const chords = track('Chords', [{ t: 0, order: 0, data: [0xc1, 89] }, ...noteEvents(ch, 1, 64)]);

  const header = [...str('MThd'), ...u32(6), 0, 1, 0, 3, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...header, ...conductor, ...melody, ...chords]);
}

export function downloadMidi(bytes, filename) {
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
