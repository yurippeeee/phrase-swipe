// 先頭コードごとの定番4コード進行
export const START_DEGREES = {
  major: ['I', 'ii', 'iii', 'IV', 'V', 'vi'],
  minor: ['i', 'iv', 'v', 'VI', 'III', 'VII'],
};

export const PROGRESSIONS = {
  major: {
    I: ['I-V-vi-IV', 'I-vi-IV-V', 'I-IV-V-IV', 'I-IV-vi-V', 'I-iii-IV-V', 'I-V-IV-V', 'I-vi-ii-V', 'I-IV-I-V', 'I-iii-vi-IV', 'I-bVII-IV-I'],
    ii: ['ii-V-I-vi', 'ii-V-I-I', 'ii-V-iii-vi', 'ii-IV-V-I', 'ii-V-IV-I', 'ii-iii-IV-V'],
    iii: ['iii-vi-IV-V', 'iii-vi-ii-V', 'iii-IV-V-I', 'iii-IV-ii-V', 'iii-vi-IV-I'],
    IV: ['IV-V-iii-vi', 'IV-V-I-vi', 'IV-I-V-vi', 'IV-V-vi-I', 'IV-iii-ii-I', 'IV-V-I-I', 'IV-vi-V-I', 'IV-I-ii-V'],
    V: ['V-vi-IV-I', 'V-IV-I-I', 'V-vi-iii-IV', 'V-I-IV-I', 'V-IV-vi-I', 'V-vi-IV-V'],
    vi: ['vi-IV-V-I', 'vi-IV-I-V', 'vi-V-IV-V', 'vi-ii-V-I', 'vi-iii-IV-I', 'vi-IV-V-iii', 'vi-V-IV-iii'],
  },
  minor: {
    i: ['i-VI-III-VII', 'i-iv-v-i', 'i-VII-VI-VII', 'i-VI-iv-V', 'i-iv-VII-III', 'i-III-VII-VI', 'i-VII-VI-V', 'i-iv-VI-V'],
    iv: ['iv-VII-III-VI', 'iv-v-i-i', 'iv-i-v-i', 'iv-VI-VII-i', 'iv-VII-i-i'],
    v: ['v-iv-i-i', 'v-VI-iv-i', 'v-i-iv-VII', 'v-VI-VII-i'],
    VI: ['VI-VII-i-i', 'VI-VII-v-i', 'VI-III-VII-i', 'VI-iv-i-V', 'VI-VII-III-i', 'VI-VII-i-v'],
    III: ['III-VII-VI-VII', 'III-VI-iv-V', 'III-VII-i-i', 'III-iv-VI-VII'],
    VII: ['VII-VI-VII-i', 'VII-i-VI-VII', 'VII-III-VI-iv', 'VII-VI-v-i'],
  },
};

// 通称（よく知られたものだけ）
export const PROG_NAMES = {
  'IV-V-iii-vi': '王道進行',
  'vi-IV-V-I': '小室進行',
  'I-vi-IV-V': '50年代進行',
  'I-V-vi-IV': 'ポップ定番',
  'vi-IV-I-V': 'ポップ定番（短調始まり）',
  'ii-V-I-vi': 'ツーファイブ',
  'i-VI-III-VII': 'エピック',
  'i-VII-VI-VII': 'エオリアン',
};
