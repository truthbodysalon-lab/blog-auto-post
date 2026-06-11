/**
 * Google オートコンプリート API
 * ラッコキーワードと同じデータソース（Googleサジェスト）を直接取得
 */

// 症状×切り口のシードクエリ
const SEED_QUERIES = {
  '肩こり': [
    '肩こり 長岡市',
    '肩こり 整体 新潟',
    '肩こり 原因 デスクワーク',
    '肩こり 解消 女性',
    '慢性肩こり 整体',
    '肩こり 頭痛 整体',
    '肩甲骨 こり 改善',
  ],
  '頭痛': [
    '頭痛 長岡市',
    '頭痛 整体 新潟',
    '緊張型頭痛 原因',
    '頭痛 解消 整体',
    '後頭部 頭痛 原因',
    '片頭痛 整体',
  ],
  '姿勢': [
    '猫背 整体 長岡市',
    '姿勢 矯正 新潟',
    '巻き肩 改善 整体',
    'ストレートネック 整体',
    '姿勢 改善 女性',
    '反り腰 整体',
  ],
  '骨盤矯正': [
    '骨盤矯正 長岡市',
    '骨盤 歪み 整体 新潟',
    '産後 骨盤矯正',
    '骨盤 歪み 原因 女性',
    '骨盤矯正 効果',
  ],
};

// キーワードから主軸症状を推定
const SYMPTOM_DETECT = [
  { patterns: ['肩こり', '肩甲骨', '肩・首', '首こり', '肩まわり'], core: '肩こり' },
  { patterns: ['頭痛', '片頭痛', '偏頭痛', '頭重', '後頭部'], core: '頭痛' },
  { patterns: ['姿勢', '猫背', '巻き肩', 'ストレートネック', '反り腰', '背骨'], core: '姿勢' },
  { patterns: ['骨盤', '産後', '骨格', '歪み'], core: '骨盤矯正' },
];

export function detectCoreSymptom(keyword) {
  for (const { patterns, core } of SYMPTOM_DETECT) {
    if (patterns.some(p => keyword.includes(p))) return core;
  }
  return null;
}

async function fetchSuggestions(seedQuery) {
  const url = `https://suggestqueries.google.com/complete/search?q=${encodeURIComponent(seedQuery)}&client=chrome&hl=ja&gl=jp`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  // Google Suggest API は Shift_JIS で返してくる
  const text = new TextDecoder('shift_jis').decode(buf);
  const json = JSON.parse(text);
  return (json[1] || []).map(s => (typeof s === 'string' ? s : s[0]));
}

export async function fetchAutoCompleteKeywords() {
  const results = [];

  for (const [coreSymptom, seeds] of Object.entries(SEED_QUERIES)) {
    for (const seed of seeds) {
      try {
        console.log(`  📡 オートコンプリート: "${seed}"`);
        const suggestions = await fetchSuggestions(seed);

        for (const term of suggestions) {
          if (!term || term.length < 4 || term.length > 40) continue;
          const core = detectCoreSymptom(term) || coreSymptom;
          results.push({ term, coreSymptom: core, source: 'autocomplete', seedQuery: seed });
        }
        await new Promise(r => setTimeout(r, 500)); // レート制限配慮
      } catch (e) {
        console.warn(`  ⚠️ オートコンプリートエラー [${seed}]: ${e.message.slice(0, 60)}`);
      }
    }
  }

  // 重複除去
  const seen = new Set();
  return results.filter(k => {
    if (seen.has(k.term)) return false;
    seen.add(k.term);
    return true;
  });
}
