import { KEY_NAMES, SCALES, parseProgression } from './theory.js';
import { generateAcc, defaultAcc, DEFAULT_ACC_ID, accVariants, voiceVariants, voicedLabel, accVoicing, accName, realizeBar } from './accomp.js';
import { guitarShape } from './guitar.js';
import { START_DEGREES, PROGRESSIONS, PROG_NAMES } from './progressions.js';
import { generatePhrase, makeVariants, chordVariants, copyPhrase, endingVariants, transposePhrase, originLabel, STEPS_PER_BAR } from './generator.js';
import * as audio from './audio.js';
import { drawRoll } from './roll.js';
import { buildMidi, downloadMidi } from './midi.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'phraseSwipe.v1';
const SETTINGS_VER = 2;

const state = {
  settings: { key: 0, scale: 'major', bpm: 100, prog: 'I-V-vi-IV', bars: 'random', accVol: 0 },
  deck: [],
  shelf: [],
  mode: 'melody', // 'melody' | 'acc'（伴奏を選ぶ）
  accDeck: [],
  accReplace: null, // 伴奏の棚の1つを構成音違いで差し替え中 { id }
  accTargetId: null, // 棚の ♫ で選んだ「このフレーズだけ」の対象。null なら曲全体
  accDefault: defaultAcc(), // これからキープするフレーズに付く伴奏
  accLib: [], // 伴奏の棚（♥した伴奏）
  shelfTab: 'phrases',
  forcePos: null, // 次の候補をコード進行のこの位置から始める（進行の帯で指定）
  pendingProg: null, // 次のフレーズから切り替えるコード進行（区切り）
  near: null, // 棚のフレーズに近い候補を探索中 { id }
  nearDeck: [],
  contextOn: false,
  padOn: true,
  melodyOn: true, // 棚の再生でメロディを鳴らすか（伴奏だけ聴く用）
  accFit: 0.5, // 伴奏の候補の合いの手の強さ（スライダー）
  cardPlaying: true,
  judged: 0,
  songs: [], // 曲の一覧（今の曲は state の shelf・設定が正。保存時に書き戻す）
  songId: null,
};

// ---------- 曲（棚）を複数持つ ----------
// 曲ごと：キー・スケール・BPM・コード進行・棚・これからの標準の伴奏・区切りの予約
// 全曲共通：伴奏の棚・音量・ギター向け・長さ など
const SONG_SETTINGS = ['key', 'scale', 'bpm', 'prog'];
const newSongId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const curSong = () => state.songs.find((x) => x.id === state.songId);

function snapshotSong() {
  const song = curSong();
  if (!song) return;
  for (const k of SONG_SETTINGS) song[k] = state.settings[k];
  song.shelf = state.shelf;
  song.accDefault = state.accDefault;
  song.forcePos = state.forcePos;
  song.pendingProg = state.pendingProg;
}

function applySong(song) {
  state.songId = song.id;
  for (const k of SONG_SETTINGS) if (song[k] != null) state.settings[k] = song[k];
  state.shelf = Array.isArray(song.shelf) ? song.shelf : [];
  state.accDefault = song.accDefault && song.accDefault.bars ? song.accDefault : defaultAcc();
  state.forcePos = Number.isInteger(song.forcePos) ? song.forcePos : null;
  state.pendingProg = typeof song.pendingProg === 'string' ? song.pendingProg : null;
}

function songName(song) {
  return song.name || `曲${state.songs.indexOf(song) + 1}`;
}

// ---------- 保存 ----------
function save() {
  try {
    snapshotSong();
    const { settings, shelf, contextOn, padOn, melodyOn, judged, accDefault, forcePos, accLib, pendingProg, accFit, songs, songId } = state;
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ settings, settingsVer: SETTINGS_VER, shelf, contextOn, padOn, melodyOn, judged, accDefault, forcePos, accLib, pendingProg, accFit, songs, songId }),
    );
  } catch (e) {
    /* 容量超過やプライベートモード */
  }
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!d) return;
    Object.assign(state.settings, d.settings || {});
    // v1 は長さ固定（2小節）が既定だったので、ランダムに移行
    if ((d.settingsVer || 1) < 2) state.settings.bars = 'random';
    state.shelf = Array.isArray(d.shelf) ? d.shelf : [];
    state.contextOn = !!d.contextOn;
    state.padOn = d.padOn !== false;
    state.melodyOn = d.melodyOn !== false;
    if (typeof d.accFit === 'number') state.accFit = d.accFit;
    state.judged = d.judged || 0;
    // 一度も伴奏を選んでいなければ（旧標準のパッドのまま）新しい標準に置き換える
    const isOldDefault = (t) => t && t.id === 'default';
    if (d.accDefault && d.accDefault.bars && !isOldDefault(d.accDefault)) state.accDefault = d.accDefault;
    for (const ph of state.shelf) if (isOldDefault(ph.acc)) ph.acc = null;
    state.accLib = Array.isArray(d.accLib) ? d.accLib : [];
    // 伴奏の棚が無かった頃のデータ：使っていた伴奏を棚に入れておく
    if (!Array.isArray(d.accLib)) for (const t of [state.accDefault, ...state.shelf.map((p) => p.acc)]) addToLib(t);
    state.forcePos = Number.isInteger(d.forcePos) ? d.forcePos : null;
    state.pendingProg = typeof d.pendingProg === 'string' ? d.pendingProg : null;
    if (Array.isArray(d.songs) && d.songs.length) {
      state.songs = d.songs;
      applySong(state.songs.find((x) => x.id === d.songId) || state.songs[0]);
    }
  } catch (e) {
    /* 壊れたデータは無視 */
  }
}

// ---------- 候補の生成 ----------
function progFrom(text) {
  const s = state.settings;
  const chords = parseProgression(text, s.key, s.scale);
  return chords.length ? chords : parseProgression('I', s.key, s.scale);
}

// 曲の最初の区間の進行（設定）
function progression() {
  return progFrom(state.settings.prog);
}

const lastKept = () => state.shelf[state.shelf.length - 1];

// 次のフレーズが使う進行：切り替え予約 → 直前のフレーズの区間 → 設定
const nextProgText = () => state.pendingProg ?? (lastKept() ? lastKept().progText || state.settings.prog : state.settings.prog);

// コードは曲の中の位置で決まる：棚の先頭から小節を数えて進行を当てはめる。
// くり返したフレーズもメロディは同じまま、コードは次へ進む。
// progChange: このフレーズから別の進行に切り替える（区切り）。その進行の1つ目のコードから数え直す
// jump: 進行の帯で「このコードから」と指定して置いたフレーズは、そこから数え直す
function relayout() {
  let text = state.settings.prog;
  let prog = progFrom(text);
  let pos = 0;
  for (const ph of state.shelf) {
    if (ph.progChange) {
      text = ph.progChange;
      prog = progFrom(text);
      pos = 0;
    }
    if (ph.jump != null) pos = ph.jump;
    ph.progText = text;
    ph.pos = pos % prog.length;
    ph.chords = [];
    for (let b = 0; b < ph.bars; b++) ph.chords.push({ ...prog[(pos + b) % prog.length] });
    // 「コード違い」で差し替えた小節のコード
    if (Array.isArray(ph.chordOverride) && ph.chordOverride.length === ph.bars) {
      ph.chords = ph.chordOverride.map((d, b) => parseProgression(d, state.settings.key, state.settings.scale)[0] || ph.chords[b]);
    }
    pos += ph.bars;
  }
}

// 次のフレーズの位置（直前のフレーズの続き）と、担当するコード
function nextSlot(bars) {
  const prog = progFrom(nextProgText());
  const last = lastKept();
  const pos = state.forcePos != null ? state.forcePos : state.pendingProg || !last ? 0 : last.pos + last.bars;
  const chords = [];
  for (let b = 0; b < bars; b++) chords.push(prog[(pos + b) % prog.length]);
  return { chords, bars, pos: pos % prog.length };
}

// 長さ「ランダム」は 1小節多め
const pickBars = () => (state.settings.bars === 'random' ? (Math.random() < 0.6 ? 1 : 2) : state.settings.bars);

const chordsKey = (chords) => chords.map((c) => c.label).join(' ');
const motifOf = (p) => p.motif || p.id;
// 候補が今の位置のコードに合っているか
const fitsSlot = (p) => chordsKey(p.chords) === chordsKey(nextSlot(p.bars).chords);

function newCandidate() {
  const s = state.settings;
  const { chords, bars, pos } = nextSlot(pickBars());
  // メロディなしの区間は飛ばして、最後に鳴ったメロディの音から続ける
  const sung = [...state.shelf].reverse().find((p) => p.notes.length);
  const prevPitch = sung ? sung.notes[sung.notes.length - 1].p : undefined;
  return generatePhrase({ key: s.key, scale: s.scale, chords, bars, pos, prevPitch });
}

function fillDeck() {
  while (state.deck.length < 3) state.deck.push(newCandidate());
}

// ---------- 再生用シーケンス ----------
const accOf = (ph) => ph.acc || state.accDefault;

const keyScalePcs = () => (SCALES[state.settings.scale] || SCALES.major).map((x) => (x + state.settings.key) % 12);
// 伴奏の響き（構成音アレンジ）を付けたコード名。ギター向けの間は押さえ方の音なので元の名前
function accLabels(ph, t) {
  const sc = keyScalePcs();
  return Array.from({ length: ph.bars }, (_, b) => {
    const c = ph.chords[b % ph.chords.length];
    return c ? voicedLabel(t, c, sc, !!state.settings.guitarAcc) : '';
  });
}

// ---------- コードの変わり目（区間の境目）----------
// ph.shift：このフレーズの頭でコードが変わる位置を、小節線からずらす（16分単位）。
//   負＝前の区間の終わりに食い込む（先取り）、正＝前のコードをこの区間の頭まで残す。null＝自動
const SHIFT_OPTIONS = [null, 0, -2, -4, -8, 4];
const shiftName = (v) => (v === 0 ? 'ぴったり' : v < 0 ? `${{ 2: '8分', 4: '4分', 8: '2拍' }[-v] || -v + '/16'}前` : `${{ 2: '8分', 4: '4分', 8: '2拍' }[v] || v + '/16'}遅れ`);

// 自動：前の区間の最後のメロディが裏拍から小節線まで伸びていて、次のコードの音なら、そこでコードも変える（食い）
function autoShift(prev, next) {
  const A = prev.chords[(prev.bars - 1) % prev.chords.length];
  const B = next.chords[0];
  if (!A || !B || A.label === B.label || !prev.notes.length) return 0;
  const end = prev.bars * STEPS_PER_BAR;
  const n = prev.notes.reduce((a, x) => (x.s > a.s ? x : a), prev.notes[0]);
  const pc = ((n.p % 12) + 12) % 12;
  if (n.s + n.d < end || n.s < end - 4 || n.s % 4 === 0) return 0;
  if (!B.pcs.includes(pc) || A.pcs.includes(pc)) return 0;
  // 次の区間の頭で別の音を弾き直すなら、食いではない
  if (next.notes.some((x) => x.s === 0 && x.p !== n.p)) return 0;
  return n.s - end;
}

function boundaryShift(prev, next) {
  if (!prev || !next) return 0;
  return next.shift != null ? next.shift : autoShift(prev, next);
}

// accOverride: 伴奏の候補を試すときに、フレーズの伴奏の代わりに使う型
function buildSeq(phrases, withAcc, accOverride) {
  const notes = [];
  const acc = [];
  const ranges = [];
  let off = 0;
  const scalePcs = keyScalePcs();
  // 境目 i（phrases[i] の頭）のずれ
  const shifts = phrases.map((ph, i) => (i ? boundaryShift(phrases[i - 1], ph) : 0));
  phrases.forEach((ph, i) => {
    for (const n of ph.notes) notes.push({ p: n.p, s: n.s + off, d: n.d });
    const t = accOverride || accOf(ph);
    const prev = phrases[i - 1];
    const next = phrases[i + 1];
    for (let b = 0; b < ph.bars; b++) {
      let c = ph.chords[b % ph.chords.length];
      const splits = [];
      // 前のコードを残す：小節の頭は前の区間の最後のコードで、shift から自分のコード
      if (b === 0 && prev && shifts[i] > 0) {
        splits.push({ cut: shifts[i], chord: c });
        c = prev.chords[(prev.bars - 1) % prev.chords.length];
      }
      // 次のコードを先取り：最後の小節の終わりを次の区間の最初のコードで
      if (b === ph.bars - 1 && next && shifts[i + 1] < 0) splits.push({ cut: STEPS_PER_BAR + shifts[i + 1], chord: next.chords[0] });
      // この小節で鳴っているメロディ（合いの手を合わせるため）
      const mel = ph.notes.filter((n) => n.s < (b + 1) * STEPS_PER_BAR && n.s + n.d > b * STEPS_PER_BAR).map((n) => ({ s: n.s - b * STEPS_PER_BAR, d: n.d }));
      if (c) for (const a of realizeBar(t, c, b, mel, !!state.settings.guitarAcc, scalePcs, splits)) acc.push({ ...a, s: a.s + off + b * STEPS_PER_BAR });
    }
    ranges.push([off, off + ph.bars * STEPS_PER_BAR]);
    off += ph.bars * STEPS_PER_BAR;
  });
  return { steps: off, notes, acc: withAcc ? acc : [], allAcc: acc, ranges };
}

// ---------- 伴奏モード ----------
const curDeck = () => (state.near ? state.nearDeck : state.mode === 'acc' ? state.accDeck : state.deck);

// ---------- 棚のフレーズに近い候補を探す ----------
const nearTarget = () => (state.near && state.shelf.find((p) => p.id === state.near.id)) || null;

// メロディ違い（リズム・音程・一部・語尾）とコード違いを混ぜる
function nearVariants(t) {
  const vars = [...makeVariants(t, 4), ...chordVariants(t, 2), ...endingVariants(t, { chords: t.chords, pos: t.pos }, 1)];
  for (let i = vars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vars[i], vars[j]] = [vars[j], vars[i]];
  }
  for (const v of vars) v.acc = t.acc;
  return vars;
}

function startNear(ph) {
  state.near = { id: ph.id };
  state.nearDeck = [];
  state.accTargetId = null;
  state.mode = 'melody';
  setMode('melody');
  showView('viewSwipe');
}

function endNear(toShelf) {
  state.near = null;
  state.nearDeck = [];
  if (toShelf) showView('viewShelf');
  else renderDeck();
}

// 伴奏を合わせる対象：棚で指定したフレーズ → 直前のキープ → メロディ候補
const isStd = (t) => !t || t.id === DEFAULT_ACC_ID || t.id === 'default';
function addToLib(t) {
  if (isStd(t) || state.accLib.some((x) => x.id === t.id)) return false;
  state.accLib.push(t);
  if (state.accLib.length > 40) state.accLib.shift();
  return true;
}

const accSpecific = () => state.shelf.find((p) => p.id === state.accTargetId) || null;

const accReplaceOrig = () => (state.accReplace && state.accLib.find((x) => x.id === state.accReplace.id)) || null;

// 伴奏カードで試聴するフレーズ（コードが進むのが分かるよう、最大8小節ぶん並べる）
function accPreview() {
  const one = accSpecific();
  if (one) return [one];
  const MAX = 8;
  const take = (list) => {
    const out = [];
    let bars = 0;
    for (const p of list) {
      if (out.length && bars + p.bars > MAX) break;
      out.push(p);
      bars += p.bars;
    }
    return out;
  };
  if (state.accReplace) {
    const i = state.shelf.findIndex((p) => accOf(p).id === state.accReplace.id);
    if (i >= 0) return take(state.shelf.slice(i).filter((p) => accOf(p).id === state.accReplace.id));
  }
  if (state.shelf.length) return take([...state.shelf].reverse()).reverse();
  return [accTarget()];
}

function accSegs(t) {
  return accPreview().map((ph) => ({ phrase: ph, acc: buildSeq([ph], true, t).acc, accFocus: true, labels: accLabels(ph, t) }));
}

function accTarget() {
  const using = state.accReplace && state.shelf.find((p) => accOf(p).id === state.accReplace.id);
  const t = accSpecific() || using || lastKept();
  if (t) return t;
  fillDeck();
  return state.deck[0];
}

function fillCur() {
  if (state.near) {
    const t = nearTarget();
    if (!t) state.near = null;
    else while (state.nearDeck.length < 3) state.nearDeck.push(...nearVariants(t));
  }
  if (state.near) return;
  const orig = accReplaceOrig();
  if (state.mode === 'acc' && orig) while (state.accDeck.length < 3) {
    // 一度出した組み合わせは出さない（出し尽くしたら最初から）
    const shown = (state.accReplace.shown ||= []);
    let more = voiceVariants(orig, 5, [...state.accDeck, ...shown], voiceCtx());
    if (!more.length) {
      shown.length = 0;
      more = voiceVariants(orig, 5, state.accDeck, voiceCtx());
    }
    if (!more.length) break;
    shown.push(...more);
    state.accDeck.push(...more);
  }
  else if (state.mode === 'acc') while (state.accDeck.length < 3) state.accDeck.push(generateAcc(null, state.accFit));
  else fillDeck();
}

function setMode(mode) {
  if (mode !== 'acc') state.accReplace = null;
  state.mode = mode;
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === mode);
  $('tglContext').classList.toggle('hidden', mode === 'acc');
  $('btnAccAll').classList.toggle('hidden', mode !== 'acc');
  $('fitBar').classList.toggle('hidden', mode !== 'acc');
  $('voiceBar').classList.toggle('hidden', mode !== 'acc');
  updateAccLabels();
  if (!$('viewSwipe').classList.contains('hidden')) renderDeck();
}

// 選んでいる伴奏を棚の全フレーズに
// 使用中の伴奏名をボタンに出す
function updateAccLabels() {
  const name = state.padOn ? accName(state.accDefault) : 'OFF';
  $('tglPad').textContent = state.mode === 'acc' ? '伴奏' : `伴奏：${name}`;
  $('tglPad2').textContent = `伴奏：${state.padOn ? 'ON' : 'OFF'}`;
  $('tglMelody').textContent = `メロディ：${state.melodyOn ? 'ON' : 'OFF'}`;
  $('tglMelody').setAttribute('aria-pressed', String(state.melodyOn));
}

function applyAccToAll(t = state.accDeck[0]) {
  if (!t) return;
  addToLib(t);
  for (const ph of state.shelf) ph.acc = t;
  state.accDefault = t;
  save();
  updateAccLabels();
  toast(`曲全体の伴奏を「${accName(t)}」に`);
}

// ---------- カード ----------
const deckEl = $('deck');

function cardEl(item, behind) {
  if (state.mode === 'acc') return accCardEl(item, behind);
  const phrase = item;
  const el = document.createElement('div');
  el.className = 'card' + (behind ? ' behind' : '');
  el.innerHTML = `
    <div class="card-head"><span class="tag"></span><span class="ctx"></span><span class="num"></span></div>
    <canvas></canvas>
    <div class="card-foot"><span>← ボツ</span><span>タップで再生/停止</span><span>キープ →</span></div>
    <div class="stamp keep">KEEP</div><div class="stamp nope">NOPE</div>`;
  const tag = el.querySelector('.tag');
  tag.textContent = originLabel(phrase.origin);
  tag.classList.add(phrase.origin);
  el.querySelector('.num').textContent = `#${state.judged + (behind ? 2 : 1)}`;
  if (state.near) el.querySelector('.card-foot span:last-child').textContent = '差し替え →';
  el._phrase = phrase;
  return el;
}

function accCardEl(t, behind) {
  const el = document.createElement('div');
  el.className = 'card' + (behind ? ' behind' : '');
  el.innerHTML = `
    <div class="card-head"><span class="tag acc"></span><span class="ctx"></span><span class="num"></span></div>
    <canvas></canvas>
    <div class="card-foot"><span>← ボツ</span><span>タップで再生/停止</span><span>この伴奏 →</span></div>
    <div class="stamp keep">KEEP</div><div class="stamp nope">NOPE</div>`;
  el.querySelector('.tag').textContent = accName(t);
  const target = accTarget();
  const k = state.shelf.indexOf(target);
  el.querySelector('.num').textContent = accSpecific() ? `棚の${k + 1}番だけ` : accReplaceOrig() ? '棚の伴奏を差し替え' : '曲全体';
  if (accReplaceOrig()) el.querySelector('.card-foot span:last-child').textContent = '差し替え →';
  el._acc = t;
  el._phrase = target;
  el._segs = accSegs(t);
  return el;
}

function segmentsFor(el) {
  return el._segs || cardSegments(el._phrase);
}

function cardSegments(phrase) {
  const t = nearTarget();
  const last = t ? state.shelf[state.shelf.indexOf(t) - 1] : lastKept();
  return state.contextOn && last ? [{ phrase: last, faded: true }, { phrase }] : [{ phrase }];
}

function renderBack() {
  fillCur();
  const old = deckEl.querySelector('.card.behind');
  const back = cardEl(curDeck()[1], true);
  if (old) old.replaceWith(back);
  else deckEl.prepend(back);
  drawRoll(back.querySelector('canvas'), back._segs || [{ phrase: back._phrase }]);
}

function renderDeck() {
  fillCur();
  deckEl.innerHTML = '';
  const top = cardEl(curDeck()[0], false);
  deckEl.append(top);
  renderBack();
  updateCtxLabel();
  updateLastBar();
  renderProgBar();
  bindSwipe(top);
  playCurrent();
}

// コード進行の帯：今のカードが進行のどこかを示す。タップでそのコードから作り直す
function renderProgBar() {
  const bar = $('progBar');
  const orig = state.mode === 'acc' && accReplaceOrig();
  bar.classList.toggle('hidden', state.mode === 'acc' && !orig);
  if (orig) {
    bar.innerHTML = `<span class="neartitle">伴奏の棚の${state.accLib.indexOf(orig) + 1}番の構成音を変える（リズムはそのまま・♥で差し替え）</span>`;
    const stop = document.createElement('button');
    stop.className = 'change';
    stop.textContent = 'やめる';
    stop.onclick = () => endAccReplace();
    bar.append(stop);
    bar.classList.remove('pending');
    return;
  }
  const nt = nearTarget();
  if (nt) {
    bar.innerHTML = `<span class="neartitle">棚の${state.shelf.indexOf(nt) + 1}番に近いのを探索中（♥で差し替え）</span>`;
    const stop = document.createElement('button');
    stop.className = 'change';
    stop.textContent = 'やめる';
    stop.onclick = () => endNear(true);
    bar.append(stop);
    bar.classList.remove('pending');
    return;
  }
  const prog = progFrom(nextProgText());
  const top = topCard();
  const ph = top && top._phrase;
  const covered = new Set();
  if (ph && ph.pos != null) for (let b = 0; b < ph.bars; b++) covered.add((ph.pos + b) % prog.length);
  bar.innerHTML = '';
  prog.forEach((c, i) => {
    const b = document.createElement('button');
    b.textContent = c.label;
    b.classList.toggle('cur', covered.has(i));
    b.onclick = () => {
      state.forcePos = i;
      state.deck = state.deck.filter(fitsSlot);
      save();
      renderDeck();
      toast(`${i + 1}つ目の ${c.label} から作ります`);
    };
    bar.append(b);
  });
  // 進行の切り替え。1周してキリのいいところでは目立たせる
  const ch = document.createElement('button');
  ch.className = 'change';
  if (state.pendingProg) {
    ch.textContent = '切替を取消';
    ch.onclick = () => {
      state.pendingProg = null;
      state.deck = state.deck.filter(fitsSlot);
      save();
      renderDeck();
      toast('進行の切り替えを取り消しました');
    };
  } else {
    const atTop = state.shelf.length > 0 && nextSlot(1).pos === 0;
    ch.textContent = atTop ? '1周！進行を変える' : '進行を変える';
    ch.classList.toggle('hint', atTop);
    ch.onclick = () => openSecSheet(null);
  }
  bar.append(ch);
  bar.classList.toggle('pending', !!state.pendingProg);
}

function updateCtxLabel() {
  const top = topCard();
  if (!top) return;
  if (state.mode === 'acc') {
    // ギター向けのときは押さえ方（フォーム）を出す
    const t = top._acc;
    const names = [];
    if (state.settings.guitarAcc && t) for (const ph of accPreview()) for (const c of ph.chords) if (c) names.push(accVoicing(t, c, keyScalePcs(), true).shape.name);
    top.querySelector('.ctx').textContent = [...new Set(names)].join(' / ');
  } else top.querySelector('.ctx').textContent = state.contextOn ? (lastKept() ? '◀ 直前のキープから' : '（棚が空）') : '';
}

function topCard() {
  return deckEl.querySelector('.card:not(.behind)');
}

function playCurrent() {
  const item = curDeck()[0];
  if (!item || !audio.isUnlocked() || $('viewSwipe').classList.contains('hidden')) return;
  if (!state.cardPlaying) {
    audio.stop();
    return;
  }
  const seq =
    state.mode === 'acc' ? buildSeq(accPreview(), true, item) : buildSeq(cardSegments(item).map((s) => s.phrase), state.padOn);
  audio.play({ ...seq, loop: true }, state.settings.bpm);
}

// ---------- スワイプ ----------
function bindSwipe(el) {
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let t0 = 0;
  let active = false;
  const stamps = { keep: el.querySelector('.stamp.keep'), nope: el.querySelector('.stamp.nope') };

  el.addEventListener('pointerdown', (e) => {
    active = true;
    sx = e.clientX;
    sy = e.clientY;
    dx = 0;
    t0 = performance.now();
    el.classList.remove('back');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - sx;
    const dy = (e.clientY - sy) * 0.2;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const r = Math.min(1, Math.abs(dx) / 100);
    stamps.keep.style.opacity = dx > 0 ? r : 0;
    stamps.nope.style.opacity = dx < 0 ? r : 0;
  });
  const end = () => {
    if (!active) return;
    active = false;
    const w = el.clientWidth;
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > w * 0.28 || (Math.abs(dx) > 40 && v > 0.6)) {
      decide(dx > 0 ? 'keep' : 'nope');
    } else {
      if (Math.abs(dx) < 6) togglePlay();
      el.classList.add('back');
      el.style.transform = '';
      stamps.keep.style.opacity = 0;
      stamps.nope.style.opacity = 0;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

let deciding = false;
function decide(kind) {
  const el = topCard();
  if (!el || deciding) return;
  deciding = true;
  const item = curDeck().shift();
  const nearT = nearTarget();
  if (kind === 'keep' && nearT) {
    // 棚のフレーズと差し替える（区切り・伴奏は元のまま）
    const k = state.shelf.indexOf(nearT);
    const np = { ...item, acc: nearT.acc, progChange: nearT.progChange, jump: nearT.jump };
    delete np.motif;
    const changed = item.chords.map((c) => c.label).join(' ') !== nearT.chords.map((c) => c.label).join(' ');
    if (changed) np.chordOverride = item.chords.map((c) => c.degree);
    else if (nearT.chordOverride) np.chordOverride = nearT.chordOverride;
    else delete np.chordOverride;
    state.shelf[k] = np;
    relayout();
    toast(`棚の${k + 1}番を差し替えました`);
    setTimeout(() => endNear(true), 250);
  } else if (kind === 'keep' && state.mode === 'acc' && accReplaceOrig()) {
    // 伴奏の棚から：その伴奏と差し替え、使っているフレーズもまとめて変える
    const old = accReplaceOrig();
    const k = state.accLib.indexOf(old);
    state.accLib[k] = item;
    let n = 0;
    for (const p of state.shelf) if (p.acc && p.acc.id === old.id) (p.acc = item), n++;
    if (state.accDefault.id === old.id) state.accDefault = item;
    toast(`伴奏の棚の${k + 1}番を差し替えました${n ? `（${n}フレーズに反映）` : ''}`);
    setTimeout(() => endAccReplace(), 250);
    updateAccLabels();
  } else if (kind === 'keep' && state.mode === 'acc') {
    const one = accSpecific();
    addToLib(item);
    if (one) {
      // フレーズの ♫ から探しに来た：そのフレーズに付けて棚に戻る
      one.acc = item;
      state.accTargetId = null;
      toast(`伴奏の棚に追加し、棚の${state.shelf.indexOf(one) + 1}番に付けました`);
      setTimeout(() => showView('viewShelf'), 250);
    } else {
      // 伴奏タブから：伴奏の棚に貯める（フレーズへは棚の ♫ から割り当てる）
      toast(`伴奏の棚に追加（${state.accLib.length}個）。棚の ♫ でフレーズに付けられます`);
    }
    updateAccLabels();
  } else if (kind === 'keep') {
    const ph = item;
    ph.acc = ph.acc || (ph.origin === 'ending' && lastKept() ? lastKept().acc : null) || state.accDefault;
    if (state.forcePos != null) ph.jump = state.forcePos;
    if (state.pendingProg) ph.progChange = state.pendingProg;
    state.shelf.push(ph);
    state.forcePos = null;
    state.pendingProg = null;
    relayout();
    // 担当コードが変わるので、合わなくなった候補は作り直す（語尾違いを選んだら他の語尾違いは片付ける）
    state.deck = state.deck.filter((p) => fitsSlot(p) && !(ph.origin === 'ending' && p.origin === 'ending'));
    state.accTargetId = null;
    toast(`キープ（${state.shelf.length}）`);
  }
  const dir = kind === 'keep' ? 1 : -1;
  el.classList.add('fly');
  el.style.transform = `translate(${dir * window.innerWidth * 1.2}px, 40px) rotate(${dir * 24}deg)`;
  el.querySelector(`.stamp.${kind}`).style.opacity = 1;
  state.judged++;
  updateCounts();
  save();
  setTimeout(() => {
    deciding = false;
    renderDeck();
  }, 200);
}

// ---------- 直前のキープ：くり返し ----------
// 末尾で同じ動機が何回続いているか
function runLength() {
  const last = lastKept();
  let n = 0;
  for (let i = state.shelf.length - 1; i >= 0 && motifOf(state.shelf[i]) === motifOf(last); i--) n++;
  return n;
}

function updateLastBar() {
  const last = lastKept();
  $('lastBar').classList.toggle('hidden', !last || state.mode === 'acc' || !!state.near);
  $('restBar').classList.toggle('hidden', state.mode === 'acc' || !!state.near);
  $('btnEnding').classList.toggle('hidden', !last || !last.notes.length);
  if (!last) return;
  $('lastCount').textContent = `×${runLength()}`;
  drawRoll($('lastRoll'), [{ phrase: last }], { labels: false });
}

// 全く同じフレーズを棚に足す
function repeatLast() {
  const last = lastKept();
  if (!last) return;
  const copy = copyPhrase(last);
  delete copy.jump;
  delete copy.progChange;
  delete copy.chordOverride;
  if (state.forcePos != null) copy.jump = state.forcePos;
  if (state.pendingProg) copy.progChange = state.pendingProg;
  state.shelf.push(copy);
  state.forcePos = null;
  state.pendingProg = null;
  relayout();
  state.deck = state.deck.filter(fitsSlot);
  updateCounts();
  updateLastBar();
  save();
  toast(`くり返し ×${runLength()}`);
  if (!state.deck.length) renderDeck();
}

// 直前のフレーズの語尾だけ違う候補を先頭に並べる
// メロディなしの区間（伴奏だけ鳴る）を棚の最後に置く。コードは曲の位置どおりに進む
function addRest(bars) {
  const s = state.settings;
  const slot = nextSlot(bars);
  const last = lastKept();
  const ph = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), bars, key: s.key, scale: s.scale, chords: slot.chords, pos: slot.pos, notes: [], origin: 'rest' };
  ph.acc = (last && last.acc) || state.accDefault;
  if (state.forcePos != null) ph.jump = state.forcePos;
  if (state.pendingProg) ph.progChange = state.pendingProg;
  state.shelf.push(ph);
  state.forcePos = null;
  state.pendingProg = null;
  relayout();
  state.deck = state.deck.filter(fitsSlot);
  updateCounts();
  save();
  renderDeck();
  toast(`メロディなし ${bars}小節を棚に追加（${state.shelf.length}）`);
}

function endingsOfLast() {
  const last = lastKept();
  if (!last || deciding || !last.notes.length) return;
  const vars = endingVariants(last, nextSlot(last.bars), 5);
  state.deck = [...vars, ...state.deck.filter((p) => p.origin !== 'ending')];
  renderDeck();
  toast(`語尾違いを${vars.length}つ用意`);
}

function similar() {
  const item = curDeck()[0];
  if (!item || deciding) return;
  const vars = state.mode === 'acc' ? accVariants(item, 5) : makeVariants(item, 5);
  curDeck().splice(1, 0, ...vars);
  renderBack();
  toast(`近い候補を${vars.length}つ追加`);
}

// 伴奏：リズムと鳴らす位置はそのままで、構成音（7th・sus4 など）や広げ方を変えた候補
function voicings() {
  const item = curDeck()[0];
  if (!item || deciding || state.mode !== 'acc') return;
  const vars = voiceVariants(item, 5, [], voiceCtx());
  curDeck().splice(1, 0, ...vars);
  renderBack();
  toast(`コードごとに構成音を変えた候補を${vars.length}つ追加`);
}

function togglePlay() {
  state.cardPlaying = !state.cardPlaying;
  $('btnPlayCard').textContent = state.cardPlaying ? '一時停止' : '▶ 再生';
  playCurrent();
}

function setContext(on) {
  state.contextOn = on;
  $('tglContext').setAttribute('aria-pressed', String(on));
  updateCtxLabel();
  save();
  playCurrent();
}

function setPad(on) {
  state.padOn = on;
  $('tglPad').setAttribute('aria-pressed', String(on));
  $('tglPad2').setAttribute('aria-pressed', String(on));
  updateAccLabels();
  save();
  if (!$('viewSwipe').classList.contains('hidden')) playCurrent();
  else if (songPlaying) playSong();
}

// ---------- 棚 ----------
let songPlaying = false;
let songRanges = null; // 再生中の各行の [開始, 終了] ステップ
let songRows = null; // 再生中の行インデックス

function updateCounts() {
  $('shelfCount').textContent = state.shelf.length;
}

function renderShelf() {
  renderSongBar();
  const ul = $('shelf');
  ul.innerHTML = '';
  stopSong();
  $('phraseCount2').textContent = state.shelf.length;
  $('accCount').textContent = state.accLib.length;
  for (const b of $('shelfSeg').children) b.classList.toggle('on', b.dataset.tab === state.shelfTab);
  $('shelfPhrases').classList.toggle('hidden', state.shelfTab !== 'phrases');
  $('shelfAccs').classList.toggle('hidden', state.shelfTab !== 'accs');
  renderAccShelf();
  $('shelfEmpty').classList.toggle('hidden', state.shelf.length > 0);
  $('btnPlaySong').disabled = !state.shelf.length;
  const bars = state.shelf.reduce((a, p) => a + p.bars, 0);
  const sec = Math.round((bars * 4 * 60) / state.settings.bpm);
  $('shelfSummary').textContent = `${state.shelf.length}フレーズ / ${bars}小節 / 約${sec}秒`;
  state.shelf.forEach((ph, i) => {
    const li = document.createElement('li');
    li.className = 'row';
    // 行はフレーズそのものを持ち、操作時に現在の位置を引き直す（古い番号で別のフレーズを触らない）
    li._phrase = ph;
    const at = () => state.shelf.indexOf(ph);
    li.innerHTML = `<button class="handle" aria-label="並べ替え">≡</button><canvas></canvas><button class="accbtn" aria-label="伴奏を選ぶ">♫</button><button class="dup" aria-label="くり返し（複製）">⧉</button><button class="del" aria-label="削除">✕</button><span class="idx">${i + 1} · ${ph.notes.length ? '' : 'メロディなし · '}${accName(accOf(ph))}</span>`;
    li.querySelector('.del').onclick = () => {
      if (at() < 0) return;
      state.shelf.splice(at(), 1);
      relayout();
      updateCounts();
      save();
      renderShelf();
    };
    li.querySelector('.dup').onclick = () => {
      const k = at();
      if (k < 0) return;
      const copy = copyPhrase(ph);
      delete copy.jump;
      delete copy.progChange;
      delete copy.chordOverride;
      state.shelf.splice(k + 1, 0, copy);
      relayout();
      updateCounts();
      save();
      renderShelf();
      toast(`${k + 1} をくり返しました`);
    };
    li.querySelector('canvas').onclick = () => at() >= 0 && playRow(at());
    li.querySelector('.accbtn').onclick = () => openPicker(ph);
    // 進行：どのフレーズからでも切り替えられる。切り替わるフレーズには区切りの印
    const badges = document.createElement('div');
    badges.className = 'badges';
    const near = document.createElement('button');
    near.textContent = '近いの';
    near.setAttribute('aria-label', 'このフレーズに近い候補をスワイプで探す');
    near.onclick = () => startNear(ph);
    const badge = document.createElement('button');
    badge.className = 'secbadge' + (ph.progChange ? ' on' : '');
    badge.textContent = ph.progChange ? `▶ ${ph.progChange}` : '進行 ▾';
    badge.setAttribute('aria-label', 'このフレーズから進行を変える');
    badge.onclick = () => openSecSheet(ph);
    li.classList.toggle('secstart', !!ph.progChange);
    if (ph.notes.length) badges.append(near);
    badges.append(badge);
    // コードの変わり目：前の区間との境目。タップで 自動→ぴったり→8分前→4分前→2拍前→4分遅れ
    const k = at();
    if (k > 0) {
      const sb = document.createElement('button');
      const eff = boundaryShift(state.shelf[k - 1], ph);
      sb.className = 'shiftbadge' + (eff ? ' on' : '');
      sb.textContent = `⇤${ph.shift == null ? (eff ? '自動 ' + shiftName(eff) : '自動') : shiftName(ph.shift)}`;
      sb.setAttribute('aria-label', 'コードの変わり目（前の区間との境目）');
      sb.onclick = () => {
        const i = SHIFT_OPTIONS.indexOf(ph.shift ?? null);
        ph.shift = SHIFT_OPTIONS[(i + 1) % SHIFT_OPTIONS.length];
        if (ph.shift == null) delete ph.shift;
        save();
        renderShelf();
        const e2 = boundaryShift(state.shelf[at() - 1], ph);
        toast(`${at() + 1}番の頭のコード：${ph.shift == null ? '自動（' + (e2 ? shiftName(e2) : 'ぴったり') + '）' : shiftName(ph.shift)}`);
      };
      li.append(sb);
    }
    li.append(badges);
    // 小節数が分かるよう、短いフレーズは幅も短く
    const maxBars = Math.max(...state.shelf.map((p) => p.bars));
    li.querySelector('canvas').style.width = `${(ph.bars / maxBars) * 100}%`;
    bindDrag(li);
    ul.append(li);
  });
  drawShelfRows();
}

function drawShelfRows(playStep = -1) {
  const rows = $('shelf').children;
  for (let i = 0; i < rows.length; i++) {
    let step = -1;
    if (songRanges && songRows) {
      const k = songRows.indexOf(i);
      const r = songRanges[k];
      if (r && playStep >= r[0] && playStep < r[1]) step = playStep - r[0];
    }
    rows[i].classList.toggle('playing', step >= 0);
    const ph = rows[i]._phrase;
    // メロディなしの区間は伴奏を描く
    if (ph) drawRoll(rows[i].querySelector('canvas'), [ph.notes.length ? { phrase: ph } : { phrase: ph, acc: buildSeq([ph], true).acc, accFocus: true }], { playStep: step });
  }
}

function playPhrases(indices) {
  if (!audio.isUnlocked() || !indices.length) return;
  const seq = buildSeq(indices.map((i) => state.shelf[i]), state.padOn);
  if (!state.melodyOn) seq.notes = [];
  songRanges = seq.ranges;
  songRows = indices;
  songPlaying = true;
  $('btnPlaySong').textContent = '■ 停止';
  audio.play({ ...seq, loop: false, onEnd: stopSong }, state.settings.bpm);
}

function playSong() {
  playPhrases(state.shelf.map((_, i) => i));
}

function playRow(i) {
  playPhrases([i]);
}

function stopSong() {
  if (songPlaying) audio.stop();
  songPlaying = false;
  songRanges = null;
  songRows = null;
  $('btnPlaySong').textContent = '▶ 通し再生';
  drawShelfRows();
}

// ---------- 伴奏の棚 ----------
// 試聴・表示用のフレーズ：棚の最後のフレーズ（なければ進行の頭2小節・メロディなし）
function accPreviewPhrase() {
  const last = lastKept();
  if (last) return last;
  const prog = progression();
  return { bars: 2, notes: [], chords: [prog[0], prog[1 % prog.length]] };
}

// 構成音違いを比べるための、曲で使っているコード（重複なし）
function voiceCtx() {
  const seen = new Map();
  for (const ph of [...state.shelf, ...accPreview()]) for (const c of ph.chords) if (c) seen.set(c.label, c);
  return { chords: [...seen.values()], scale: keyScalePcs(), guitar: !!state.settings.guitarAcc };
}

// 伴奏の棚の1つを、リズムはそのままで構成音だけ変えた候補から選び直す
function startAccReplace(t) {
  state.accReplace = { id: t.id };
  state.accTargetId = null;
  state.accDeck = voiceVariants(t, 5, [], voiceCtx());
  state.accReplace.shown = [...state.accDeck];
  setMode('acc');
  showView('viewSwipe');
}

function endAccReplace() {
  state.accReplace = null;
  state.accDeck = [];
  save();
  showView('viewShelf');
}

function renderAccShelf() {
  const ul = $('accShelf');
  ul.innerHTML = '';
  $('accEmpty').classList.toggle('hidden', state.accLib.length > 0);
  const base = accPreviewPhrase();
  state.accLib.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'row accrow';
    const uses = state.shelf.filter((p) => accOf(p).id === t.id).length;
    li.innerHTML = `<canvas></canvas><button class="play" aria-label="試聴">▶</button><button class="near">近いの</button><button class="voice">構成音</button><button class="all">全体</button><button class="del" aria-label="削除">✕</button>
      <span class="name">${i + 1}. ${accName(t)}</span><span class="use">${uses ? `${uses}フレーズで使用中` : '未使用'}${t.id === state.accDefault.id ? '・これからの標準' : ''}</span>`;
    li.querySelector('.play').onclick = () => {
      if (!audio.isUnlocked()) return;
      stopSong();
      const seq = buildSeq([base], true, t);
      audio.play({ ...seq, loop: false }, state.settings.bpm);
    };
    li.querySelector('.near').onclick = () => {
      state.accDeck = [...accVariants(t, 5), ...state.accDeck];
      state.accTargetId = null;
      setMode('acc');
      showView('viewSwipe');
      toast(`「${accName(t)}」に近い伴奏を5つ用意`);
    };
    li.querySelector('.voice').onclick = () => startAccReplace(t);
    li.querySelector('.all').onclick = () => {
      applyAccToAll(t);
      renderShelf();
    };
    li.querySelector('.del').onclick = () => {
      state.accLib = state.accLib.filter((x) => x.id !== t.id);
      save();
      renderShelf();
    };
    ul.append(li);
    drawRoll(li.querySelector('canvas'), [{ phrase: base, acc: buildSeq([base], true, t).acc, accFocus: true }], { labels: false });
  });
}

// フレーズの ♫：伴奏の棚から選ぶ
let pickTarget = null;
function openPicker(ph) {
  pickTarget = ph;
  $('pickTitle').textContent = `棚の${state.shelf.indexOf(ph) + 1}番の伴奏`;
  renderPickList();
  $('accPicker').classList.add('open');
  $('accPicker').setAttribute('aria-hidden', 'false');
  $('pickBackdrop').classList.remove('hidden');
}

function renderPickList() {
  const ph = pickTarget;
  const list = $('pickList');
  list.innerHTML = '';
  const options = [state.accDefault, ...state.accLib.filter((t) => t.id !== state.accDefault.id)];
  options.forEach((t) => {
    const b = document.createElement('button');
    const on = accOf(ph).id === t.id;
    const label = t === state.accDefault ? `<small>標準</small> ${accName(t)}` : `${state.accLib.indexOf(t) + 1}. ${accName(t)}`;
    b.innerHTML = `${label}<span class="check">${on ? '✓' : ''}</span>`;
    b.classList.toggle('on', on);
    b.onclick = () => {
      ph.acc = t;
      save();
      renderPickList();
      const k = state.shelf.indexOf(ph);
      if (k >= 0) playRow(k);
    };
    list.append(b);
  });
  if (!state.accLib.length) {
    const p = document.createElement('div');
    p.className = 'pick-hint';
    p.textContent = '伴奏の棚が空です。下のボタンからスワイプで探して♥してください。';
    list.append(p);
  }
}

function closePicker() {
  $('accPicker').classList.remove('open');
  $('accPicker').setAttribute('aria-hidden', 'true');
  $('pickBackdrop').classList.add('hidden');
  pickTarget = null;
  renderShelf();
}

// ドラッグで並べ替え（タッチ対応のため Pointer Events で自前実装）
function bindDrag(li) {
  const handle = li.querySelector('.handle');
  const ul = $('shelf');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const index = state.shelf.indexOf(li._phrase);
    if (index < 0) return;
    stopSong();
    handle.setPointerCapture(e.pointerId);
    const rows = [...ul.children];
    const rowH = li.getBoundingClientRect().height + 8;
    const startY = e.clientY;
    const startScroll = ul.scrollTop;
    let target = index;
    li.classList.add('dragging');
    for (const r of rows) if (r !== li) r.style.transition = 'transform 0.15s';

    const move = (ev) => {
      const rect = ul.getBoundingClientRect();
      if (ev.clientY < rect.top + 40) ul.scrollTop -= 8;
      else if (ev.clientY > rect.bottom - 40) ul.scrollTop += 8;
      const dy = ev.clientY - startY + (ul.scrollTop - startScroll);
      li.style.transform = `translateY(${dy}px)`;
      target = Math.max(0, Math.min(rows.length - 1, index + Math.round(dy / rowH)));
      rows.forEach((r, j) => {
        if (r === li) return;
        let shift = 0;
        if (index < target && j > index && j <= target) shift = -rowH;
        if (index > target && j < index && j >= target) shift = rowH;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (target !== index) {
        const [ph] = state.shelf.splice(index, 1);
        state.shelf.splice(target, 0, ph);
        relayout();
        save();
      }
      renderShelf();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function exportMidi() {
  if (!state.shelf.length) {
    toast('棚が空です');
    return;
  }
  const seq = buildSeq(state.shelf, true);
  const bytes = buildMidi({
    bpm: state.settings.bpm,
    tracks: [
      { name: 'Melody', program: 0, notes: seq.notes, vel: 100 },
      { name: 'Accomp', program: 0, notes: seq.allAcc.filter((a) => a.inst !== 'bass'), vel: 70 },
      { name: 'Bass', program: 33, notes: seq.allAcc.filter((a) => a.inst === 'bass'), vel: 90 },
    ],
  });
  downloadMidi(bytes, `phrase-swipe-${fileStamp()}.mid`);
  toast('MIDIを書き出しました');
}

function fileStamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
}

// ギターコード サポート（guiter_support）用：棚の曲をメロディと伴奏を分けて実音のまま書き出す。
// 押さえ方・弦への割り当て・8分への丸めは読み込む側で行う
function exportForGuitar() {
  if (!state.shelf.length) {
    toast('棚が空です');
    return;
  }
  const seq = buildSeq(state.shelf, true);
  const bars = [];
  for (const ph of state.shelf) for (let b = 0; b < ph.bars; b++) {
    const c = ph.chords[b % ph.chords.length];
    bars.push({ rootPc: c.rootPc, pcs: c.pcs, label: c.label });
  }
  const { key, scale, bpm } = state.settings;
  const data = {
    app: 'phrase-swipe',
    version: 1,
    exported: new Date().toISOString(),
    name: curSong() ? songName(curSong()) : `Phrase Swipe ${fileStamp()}`,
    key,
    scale,
    bpm,
    stepsPerBar: STEPS_PER_BAR, // s・d は16分音符単位
    bars,
    melody: seq.notes.map(({ p, s, d }) => ({ p, s, d })),
    accomp: seq.allAcc.map(({ p, s, d, inst }) => ({ p, s, d, inst })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `phrase-swipe-guitar-${fileStamp()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('書き出しました。ギターコード サポートの「フレーズ→TAB」で読み込めます');
}

// ---------- 設定 ----------
function openSheet(open) {
  $('sheet').classList.toggle('open', open);
  $('sheet').setAttribute('aria-hidden', String(!open));
  $('sheetBackdrop').classList.toggle('hidden', !open);
  if (open) syncSettingsForm();
}

let draft = null;
function syncSettingsForm() {
  draft = { ...state.settings };
  const keyEl = $('setKey');
  keyEl.innerHTML = '';
  KEY_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.dataset.v = i;
    keyEl.append(b);
  });
  $('setBpm').value = draft.bpm;
  $('setAccVol').value = draft.accVol;
  $('setGuitarAcc').checked = !!draft.guitarAcc;
  $('setProg').value = draft.prog;
  progStart = null;
  refreshForm();
}

// 先頭コードを選ぶと、そこから続く4コード進行の一覧を出す（設定と区切りで共用）
function fillProgPicker(startEl, listEl, { key, scale, current, start, onStart, onPick }) {
  const starts = START_DEGREES[scale];
  const first = (current || '').split(/[\s\-–,|]+/)[0];
  if (!start || !starts.includes(start)) start = starts.includes(first) ? first : starts[0];
  startEl.innerHTML = '';
  for (const d of starts) {
    const b = document.createElement('button');
    const c = parseProgression(d, key, scale)[0];
    b.innerHTML = `${d}<small>${c ? c.label : ''}</small>`;
    b.classList.toggle('on', d === start);
    b.onclick = () => onStart(d);
    startEl.append(b);
  }
  listEl.innerHTML = '';
  for (const p of PROGRESSIONS[scale][start] || []) {
    const b = document.createElement('button');
    const names = parseProgression(p, key, scale).map((c) => c.label).join(' ');
    b.innerHTML = `<b>${p}</b><span>${names}</span>${PROG_NAMES[p] ? `<em>${PROG_NAMES[p]}</em>` : ''}`;
    b.classList.toggle('on', p === current);
    b.onclick = () => onPick(p);
    listEl.append(b);
  }
  return start;
}

let progStart = null;
function renderProgList() {
  progStart = fillProgPicker($('progStart'), $('progList'), {
    key: draft.key,
    scale: draft.scale,
    current: draft.prog,
    start: progStart,
    onStart: (d) => {
      progStart = d;
      refreshForm();
    },
    onPick: (p) => {
      draft.prog = p;
      $('setProg').value = p;
      refreshForm();
    },
  });
}

// ---------- 進行の区切り（曲の途中で進行を変える） ----------
let secTarget = null; // null: 次のフレーズから / フレーズ: 棚の区切りを編集
let secStartSel = null;
function openSecSheet(target) {
  secTarget = target;
  secStartSel = null;
  const k = target ? state.shelf.indexOf(target) + 1 : 0;
  $('secTitle').textContent = target ? `棚の${k}番から使うコード進行` : 'ここから使うコード進行';
  $('secHint').textContent = target
    ? `今は ${target.progText}。選ぶとこのフレーズから新しい進行の1つ目のコードで始まり、後ろのフレーズのコードも付け直します`
    : '次のフレーズから、選んだ進行の1つ目のコードで始めます（Aメロ→サビのような切り替え）';
  $('btnSecRemove').classList.toggle('hidden', !(target && target.progChange));
  $('secProg').value = target ? target.progChange || target.progText : nextProgText();
  renderSecSheet();
  $('secSheet').classList.add('open');
  $('secSheet').setAttribute('aria-hidden', 'false');
  $('secBackdrop').classList.remove('hidden');
}

function renderSecSheet() {
  const { key, scale } = state.settings;
  const current = secTarget ? secTarget.progChange : state.pendingProg;
  secStartSel = fillProgPicker($('secStart'), $('secList'), {
    key,
    scale,
    current,
    start: secStartSel,
    onStart: (d) => {
      secStartSel = d;
      renderSecSheet();
    },
    onPick: applySec,
  });
  const chords = parseProgression($('secProg').value, key, scale);
  $('secPreview').classList.toggle('err', !chords.length);
  $('secPreview').textContent = chords.length ? `${chords.length}コード: ${chords.map((c) => c.label).join(' → ')}` : '度数を読み取れません（例: IV-V-iii-vi）';
}

function closeSecSheet() {
  $('secSheet').classList.remove('open');
  $('secSheet').setAttribute('aria-hidden', 'true');
  $('secBackdrop').classList.add('hidden');
}

function applySec(text) {
  const t = secTarget;
  closeSecSheet();
  if (t) {
    t.progChange = text;
    relayout();
    save();
    renderShelf();
    toast(`棚の${state.shelf.indexOf(t) + 1}番から ${text} に`);
  } else {
    state.pendingProg = text;
    state.forcePos = null;
    state.deck = state.deck.filter(fitsSlot);
    save();
    renderDeck();
    toast(`次のフレーズから ${text} に切り替えます`);
  }
}

function refreshForm() {
  for (const b of $('setKey').children) b.classList.toggle('on', +b.dataset.v === draft.key);
  for (const b of $('setScale').children) b.classList.toggle('on', b.dataset.v === draft.scale);
  for (const b of $('setBars').children) b.classList.toggle('on', b.dataset.v === String(draft.bars));
  $('bpmOut').textContent = draft.bpm;
  $('accVolOut').textContent = `${draft.accVol > 0 ? '+' : ''}${draft.accVol} dB`;
  const chords = parseProgression(draft.prog, draft.key, draft.scale);
  const pv = $('progPreview');
  pv.classList.toggle('err', !chords.length);
  pv.textContent = chords.length ? `${chords.length}コード: ${chords.map((c) => c.label).join(' → ')}` : '度数を読み取れません（例: I-V-vi-IV）';
  renderProgList();
}

function bindSettings() {
  $('setKey').addEventListener('click', (e) => {
    if (e.target.dataset.v == null) return;
    draft.key = +e.target.dataset.v;
    refreshForm();
  });
  $('setScale').addEventListener('click', (e) => {
    if (!e.target.dataset.v) return;
    draft.scale = e.target.dataset.v;
    // スケールを変えたら、そのスケールの先頭コードの定番に
    if (!PROGRESSIONS[draft.scale][draft.prog.split(/[\s\-–,|]+/)[0]]) {
      draft.prog = PROGRESSIONS[draft.scale][START_DEGREES[draft.scale][0]][0];
      $('setProg').value = draft.prog;
    }
    progStart = null;
    refreshForm();
  });
  $('setBars').addEventListener('click', (e) => {
    if (!e.target.dataset.v) return;
    draft.bars = e.target.dataset.v === 'random' ? 'random' : +e.target.dataset.v;
    refreshForm();
  });
  $('setBpm').addEventListener('input', (e) => {
    draft.bpm = +e.target.value;
    refreshForm();
  });
  // 伴奏の音量はその場で聞き比べられるよう即反映（閉じても保存）
  $('setAccVol').addEventListener('input', (e) => {
    draft.accVol = +e.target.value;
    state.settings.accVol = draft.accVol;
    audio.setAccVolume(draft.accVol);
    save();
    refreshForm();
  });
  // ギター向けの伴奏：その場で切り替えて聴き比べられるように即反映
  $('setGuitarAcc').addEventListener('change', (e) => {
    draft.guitarAcc = e.target.checked;
    state.settings.guitarAcc = draft.guitarAcc;
    save();
    toast(draft.guitarAcc ? 'ギターで弾ける押さえ方で伴奏します' : 'ふつうの伴奏に戻しました');
  });
  $('setProg').addEventListener('input', (e) => {
    draft.prog = e.target.value;
    refreshForm();
  });
  $('btnApply').onclick = () => {
    if (!parseProgression(draft.prog, draft.key, draft.scale).length) return;
    const regen = ['key', 'scale', 'prog', 'bars'].some((k) => draft[k] !== state.settings[k]);
    const harmonyChanged = ['key', 'scale', 'prog'].some((k) => draft[k] !== state.settings[k]);
    state.settings = { ...draft };
    if (regen) state.deck = [];
    if (harmonyChanged) {
      // 棚にも新しい進行を当てはめる（キー・スケールが変わったらメロディも移す）
      state.shelf = state.shelf.map((ph) => transposePhrase(ph, state.settings.key, state.settings.scale));
      state.forcePos = null;
      relayout();
      updateLastBar();
    }
    state.accDeck = [];
    save();
    updateInfo();
    openSheet(false);
    if (!$('viewSwipe').classList.contains('hidden')) renderDeck();
    else renderShelf();
  };
  $('btnSettings').onclick = () => openSheet(true);
  $('sheetBackdrop').onclick = () => openSheet(false);
}

// ---------- 曲の切り替え ----------
function renderSongBar() {
  const sel = $('songSel');
  sel.innerHTML = '';
  for (const song of state.songs) {
    const o = document.createElement('option');
    o.value = song.id;
    const n = song.id === state.songId ? state.shelf.length : (song.shelf || []).length;
    o.textContent = `${songName(song)}（${n}）`;
    sel.append(o);
  }
  sel.value = state.songId;
  $('btnSongDel').disabled = state.songs.length < 2;
}

// 曲を替えたら、候補・探索中の状態は作り直す
function afterSongChange() {
  stopSong();
  audio.stop();
  state.deck = [];
  state.near = null;
  state.nearDeck = [];
  state.accDeck = [];
  state.accReplace = null;
  state.accTargetId = null;
  relayout();
  syncSettingsForm();
  updateInfo();
  updateAccLabels();
  updateCounts();
  save();
  renderSongBar();
  renderShelf();
}

function switchSong(id) {
  if (id === state.songId) return;
  const song = state.songs.find((x) => x.id === id);
  if (!song) return;
  snapshotSong();
  applySong(song);
  afterSongChange();
  toast(`「${songName(song)}」に切り替え`);
}

function newSong() {
  snapshotSong();
  const n = state.songs.length + 1;
  // キー・BPM・進行・標準の伴奏は今の曲から引き継ぐ
  const song = { id: newSongId(), name: `曲${n}`, shelf: [], accDefault: state.accDefault, forcePos: null, pendingProg: null };
  for (const k of SONG_SETTINGS) song[k] = state.settings[k];
  state.songs.push(song);
  applySong(song);
  afterSongChange();
  toast(`「${song.name}」を作りました（キー・進行は設定で変えられます）`);
}

function renameSong() {
  const song = curSong();
  if (!song) return;
  const name = prompt('曲の名前', songName(song));
  if (name == null || !name.trim()) return;
  song.name = name.trim().slice(0, 40);
  save();
  renderSongBar();
  updateInfo();
}

function deleteSong() {
  const song = curSong();
  if (!song || state.songs.length < 2) return;
  if (!confirm(`「${songName(song)}」を削除しますか？（棚のフレーズも消えます）`)) return;
  const i = state.songs.indexOf(song);
  state.songs.splice(i, 1);
  applySong(state.songs[Math.max(0, i - 1)]);
  afterSongChange();
}

function updateInfo() {
  const s = state.settings;
  const song = curSong();
  $('info').textContent = `${song ? songName(song) + ' · ' : ''}${KEY_NAMES[s.key]} ${s.scale === 'major' ? 'Major' : 'minor'} · ${s.bpm} BPM · ${s.prog}`;
}

// ---------- 共通 ----------
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

function showView(id) {
  for (const t of document.querySelectorAll('.tab[data-view]')) t.classList.toggle('active', t.dataset.view === id);
  $('viewSwipe').classList.toggle('hidden', id !== 'viewSwipe');
  $('viewShelf').classList.toggle('hidden', id !== 'viewShelf');
  audio.stop();
  if (id === 'viewSwipe') {
    stopSong();
    // 棚の編集で担当コードが変わっていたら候補を入れ替える
    state.deck = state.deck.filter(fitsSlot);
    renderDeck();
  } else {
    // 棚に戻ったら「このフレーズだけ」の指定と、近いのの探索は解除
    state.accTargetId = null;
    state.near = null;
    state.nearDeck = [];
    renderShelf();
  }
}

// 再生位置のアニメーション
function frame() {
  if (!$('viewSwipe').classList.contains('hidden')) {
    const top = topCard();
    if (top) drawRoll(top.querySelector('canvas'), segmentsFor(top), { playStep: deciding ? -1 : audio.currentStep() });
  } else if (songPlaying) {
    drawShelfRows(audio.currentStep());
  }
  requestAnimationFrame(frame);
}

function init() {
  const ver = document.querySelector('meta[name="app-version"]');
  $('appVersion').textContent = `ver ${ver ? ver.content : '?'}`;
  load();
  if (!state.songs.length) {
    // 曲が1つだった頃のデータは「曲1」に
    state.songs = [{ id: newSongId(), name: '曲1' }];
    state.songId = state.songs[0].id;
    snapshotSong();
  }
  relayout();
  updateInfo();
  updateCounts();
  bindSettings();
  $('tglContext').setAttribute('aria-pressed', String(state.contextOn));
  $('tglPad').setAttribute('aria-pressed', String(state.padOn));
  $('tglPad2').setAttribute('aria-pressed', String(state.padOn));
  for (const t of document.querySelectorAll('.tab[data-view]')) t.onclick = () => showView(t.dataset.view);
  $('btnKeep').onclick = () => decide('keep');
  $('btnNope').onclick = () => decide('nope');
  $('btnSimilar').onclick = similar;
  $('btnVoice').onclick = voicings;
  $('btnRepeat').onclick = repeatLast;
  $('btnRest').onclick = () => {
    const open = $('restOpts').classList.toggle('hidden') === false;
    $('btnRest').setAttribute('aria-expanded', String(open));
  };
  for (const b of $('restOpts').querySelectorAll('button'))
    b.onclick = () => {
      addRest(+b.dataset.bars);
      $('restOpts').classList.add('hidden');
      $('btnRest').setAttribute('aria-expanded', 'false');
    };
  $('btnEnding').onclick = endingsOfLast;
  $('btnPlayCard').onclick = togglePlay;
  $('btnAccAll').onclick = () => applyAccToAll();
  // 合いの手：動かすと今のカードにすぐ反映（離したら鳴らし直す）。次の候補もこの強さの前後で作る
  const showFit = () => ($('fitOut').textContent = `${Math.round(state.accFit * 100)}%`);
  $('fitRange').value = Math.round(state.accFit * 100);
  showFit();
  $('fitRange').addEventListener('input', (e) => {
    state.accFit = +e.target.value / 100;
    showFit();
    const t = state.accDeck[0];
    const top = topCard();
    if (state.mode !== 'acc' || !t || !top || !top._acc) return;
    t.fit = state.accFit;
    top.querySelector('.tag').textContent = accName(t);
    top._segs = accSegs(t);
  });
  $('fitRange').addEventListener('change', () => {
    save();
    playCurrent();
  });
  $('btnPickClose').onclick = closePicker;
  $('btnSecClose').onclick = closeSecSheet;
  $('secBackdrop').onclick = closeSecSheet;
  $('secProg').addEventListener('input', renderSecSheet);
  $('btnSecCustom').onclick = () => {
    const v = $('secProg').value.trim();
    if (!parseProgression(v, state.settings.key, state.settings.scale).length) return;
    applySec(v);
  };
  $('btnSecRemove').onclick = () => {
    const t = secTarget;
    closeSecSheet();
    if (!t) return;
    delete t.progChange;
    relayout();
    save();
    renderShelf();
    toast('区切りを消しました（前の進行が続きます）');
  };
  $('pickBackdrop').onclick = closePicker;
  $('btnPickSwipe').onclick = () => {
    const ph = pickTarget;
    closePicker();
    state.accTargetId = ph ? ph.id : null;
    setMode('acc');
    showView('viewSwipe');
  };
  for (const b of $('shelfSeg').children) b.onclick = () => {
    state.shelfTab = b.dataset.tab;
    renderShelf();
  };
  // タブから伴奏に切り替えたときは曲全体が対象
  for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => {
    state.accTargetId = null;
    state.near = null;
    state.nearDeck = [];
    setMode(b.dataset.mode);
  };
  $('tglContext').onclick = () => setContext(!state.contextOn);
  $('tglPad').onclick = () => setPad(!state.padOn);
  $('tglPad2').onclick = () => setPad(!state.padOn);
  $('tglMelody').onclick = () => {
    state.melodyOn = !state.melodyOn;
    updateAccLabels();
    save();
    if (songPlaying) playSong();
    if (!state.melodyOn && !state.padOn) toast('メロディも伴奏もOFFです');
  };
  $('btnPlaySong').onclick = () => (songPlaying ? stopSong() : playSong());
  $('btnMidi').onclick = exportMidi;
  $('btnGuitar').onclick = exportForGuitar;
  $('songSel').onchange = (e) => switchSong(e.target.value);
  $('btnSongNew').onclick = newSong;
  $('btnSongName').onclick = renameSong;
  $('btnSongDel').onclick = deleteSong;
  $('btnClear').onclick = () => {
    if (!state.shelf.length || !confirm('キープ棚を全部消しますか？')) return;
    state.shelf = [];
    state.deck = [];
    updateCounts();
    save();
    renderShelf();
  };
  window.addEventListener('resize', () => {
    if (!$('viewShelf').classList.contains('hidden')) drawShelfRows();
  });
  setMode('melody');
  renderDeck();
  requestAnimationFrame(frame);

  audio.setAccVolume(state.settings.accVol || 0);
  $('unlock').addEventListener('click', async () => {
    await audio.unlock();
    $('unlock').remove();
    playCurrent();
  });
}

init();
