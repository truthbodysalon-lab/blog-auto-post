import fs from 'fs';
import path from 'path';
import { getNextSubtopic, recordSubtopicCovered, getClusterProgress } from './content-clusters.js';

const HISTORY_FILE = path.resolve('posts/history.json');
const KEYWORD_CACHE_FILE = path.resolve('keywords/cache.json');
const CACHE_MAX_AGE_DAYS = 8; // 8日以内のキャッシュを使用

// キーワードキャッシュを読み込む（古い or なければ null）
function loadKeywordCache() {
  try {
    if (!fs.existsSync(KEYWORD_CACHE_FILE)) return null;
    const cache = JSON.parse(fs.readFileSync(KEYWORD_CACHE_FILE, 'utf8'));
    if (!cache.updatedAt) return null;
    const age = (Date.now() - new Date(cache.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (age > CACHE_MAX_AGE_DAYS) {
      console.log(`⚠️ キーワードキャッシュが${Math.round(age)}日前のため静的リストを使用`);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

// キャッシュからキーワードバリエーションを生成
function buildVariantsFromCache(cache) {
  const variants = {};
  for (const [core, keywords] of Object.entries(cache.bySymptom || {})) {
    if (!keywords || keywords.length === 0) continue;
    // スコア上位からキーワードを選択（最大6件）
    variants[core] = keywords.slice(0, 6).map(k => k.term);
  }
  return variants;
}

const CORE_SYMPTOMS = ['肩こり', '頭痛', '姿勢', '骨盤矯正'];

const SYMPTOM_VARIANTS = {
  '肩こり': ['肩こり', '慢性的な肩こり', '肩・首のこり', '肩甲骨周りのこり'],
  '頭痛': ['頭痛', '緊張型頭痛', '片頭痛', '後頭部の頭痛'],
  '姿勢': ['猫背・姿勢の崩れ', '巻き肩', 'ストレートネック', '反り腰'],
  '骨盤矯正': ['骨盤の歪み', '骨盤矯正', '骨盤の左右差', '産後の骨盤の歪み'],
};

const ANGLES = [
  { name: '原因解説', desc: 'なぜ起きるのか、構造的・神経的な仕組みを解説' },
  { name: 'セルフケア', desc: '自宅で30秒〜3分でできる具体的なストレッチや習慣' },
  { name: '失敗談・落とし穴', desc: 'やってはいけないNG行動と、なぜそれが逆効果か' },
  { name: '比較', desc: 'マッサージ・湿布・薬・他院との違い、それぞれの限界' },
  { name: 'Q&A形式', desc: 'よくある質問3〜5個を院長が回答する形式' },
  { name: '事例ストーリー', desc: '40代女性会社員の典型例など、ペルソナの体験談' },
  { name: '季節・天候の影響', desc: '気圧・寒暖差・エアコン等が体に与える影響' },
  { name: 'ライフスタイル別', desc: 'デスクワーク/育児/介護/スマホ過多etc特定シーンに絞る' },
  { name: '解剖学解説', desc: '筋膜・骨格・神経の仕組みを図解的に分かりやすく' },
  { name: '来店誘導', desc: '当院の施術の流れ、初回オファー、Q&Aを丁寧に紹介' },
];

const LIFESTYLES = [
  'デスクワーク中心の働く女性',
  '小さなお子さんがいるママ',
  '親の介護をしている方',
  'スマホ・PCを長時間使う方',
  '40〜50代で更年期症状にも悩む方',
  '立ち仕事の販売職・看護師など',
  '車の運転が多い方',
  '在宅ワーク・テレワーク中心の方',
];

// 月別の季節テーマ（長岡市の地域特性を加味）
const MONTHLY_SEASONAL = {
  1: {
    keyword: '厳冬期の血行不良・筋肉のこわばり',
    nagaoka: '長岡市は豪雪地帯。雪かきや寒さで筋肉が固まりやすい',
    trend: '寒さによる肩こり悪化、年始の体重増加、初詣後の疲れ',
  },
  2: {
    keyword: '寒さのピーク・花粉症シーズン開始',
    nagaoka: '長岡市の厳しい寒さが続く時期。雪かきによる腰痛・肩こりが急増',
    trend: '花粉症と頭痛の関係、春への準備、節分・バレンタインのイベント疲れ',
  },
  3: {
    keyword: '春の気温変動・春バテ・新年度準備',
    nagaoka: '長岡市の雪解けが始まり、急激な気温変化で自律神経が乱れやすい',
    trend: '春バテ・新年度準備のストレス、花粉症の本格化、3月末の年度末疲れ',
  },
  4: {
    keyword: '新生活の緊張・寒暖差・花粉症終盤',
    nagaoka: '長岡市は雪解け後の気温差が激しく、体への負担が大きい季節',
    trend: '新生活の緊張による肩こり、入学・入社・異動によるストレス、花粉症と頭痛',
  },
  5: {
    keyword: 'GW・連休明けの疲れ・五月病',
    nagaoka: '長岡市の爽やかな季節も、GW明けの気温変化と疲労が重なりやすい',
    trend: '五月病・連休疲れ、新生活1ヶ月で体に出てきた疲労、気圧変化による頭痛',
  },
  6: {
    keyword: '梅雨・低気圧・蒸し暑さ',
    nagaoka: '長岡市の梅雨は気圧変動が大きく、頭痛・だるさが出やすい',
    trend: '気圧性頭痛、梅雨のだるさ・むくみ、雨の日の関節痛・肩こり',
  },
  7: {
    keyword: '夏バテ・エアコン冷え・熱中症',
    nagaoka: '長岡市の夏は暑く、エアコンとの寒暖差が自律神経に影響',
    trend: 'エアコン冷えによる肩こり・頭痛、夏バテと骨盤の歪み、長岡まつり前後の疲れ',
  },
  8: {
    keyword: '猛暑・夏休み疲れ・お盆明け',
    nagaoka: '長岡市の花火大会（日本一）後の疲れ、猛暑日が続く時期',
    trend: '夏休み・お盆明けのリセット疲れ、熱帯夜による睡眠不足と頭痛',
  },
  9: {
    keyword: '秋の気温変化・台風・残暑疲れ',
    nagaoka: '長岡市の秋は日中と夜間の気温差が大きく、体調が崩れやすい',
    trend: '残暑疲れのリセット、秋の気圧変動による頭痛、秋バテ・食欲の変化',
  },
  10: {
    keyword: '秋の寒暖差・乾燥・運動不足',
    nagaoka: '長岡市の秋冬の切り替わり。急に気温が下がり筋肉が硬直しやすい',
    trend: '気温急変による肩こり悪化、乾燥による体のこわばり、スポーツシーズンの怪我',
  },
  11: {
    keyword: '冷え込み・初雪・年末準備',
    nagaoka: '長岡市に初雪が降る時期。雪かき準備・冷えによる腰痛・肩こりが増加',
    trend: '冷えによる骨盤の歪み悪化、年末に向けたストレス性頭痛、デスクワーク増加',
  },
  12: {
    keyword: '師走の疲労・忘年会・年末の体の悲鳴',
    nagaoka: '長岡市の本格的な雪シーズン開始。雪かきと年末疲れが重なる時期',
    trend: '年末の肩こり・頭痛ピーク、忘年会での疲れ、正月前にリセットしたい需要',
  },
};

function getMonthSeasonal() {
  const month = new Date().getMonth() + 1;
  const data = MONTHLY_SEASONAL[month];
  if (!data) return '季節の変わり目';
  return `${data.keyword}（${data.nagaoka}）。トレンド: ${data.trend}`;
}

export function getMonthlySeasonalData() {
  const month = new Date().getMonth() + 1;
  return MONTHLY_SEASONAL[month] || { keyword: '季節の変わり目', nagaoka: '長岡市の季節変化', trend: '体調管理' };
}

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function appendHistory(entry) {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const history = loadHistory();
  history.push({ ...entry, savedAt: new Date().toISOString() });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-200), null, 2));
}

export function getRecentTitles(n = 10) {
  return loadHistory().slice(-n).map(h => h.title);
}

function pickFromArray(arr, exclude = []) {
  const candidates = arr.filter(a => !exclude.includes(typeof a === 'string' ? a : a.name));
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function buildSymptomQueue(count) {
  const baseDistribution = [
    '肩こり', '頭痛', '姿勢', '骨盤矯正',
    '肩こり', '頭痛', '姿勢', '骨盤矯正',
    '肩こり', '頭痛',
  ].slice(0, count);

  const shuffled = [...baseDistribution];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (let i = 1; i < shuffled.length; i++) {
    if (shuffled[i] === shuffled[i - 1]) {
      const swapIdx = shuffled.findIndex((s, idx) => idx > i && s !== shuffled[i - 1]);
      if (swapIdx > -1) [shuffled[i], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[i]];
    }
  }

  const variantCursors = Object.fromEntries(CORE_SYMPTOMS.map(s => [s, 0]));
  return shuffled.map(coreSymptom => {
    const variants = SYMPTOM_VARIANTS[coreSymptom];
    const idx = variantCursors[coreSymptom] % variants.length;
    variantCursors[coreSymptom]++;
    return { core: coreSymptom, variant: variants[idx] };
  });
}

function loadContentStrategy() {
  try {
    const f = path.resolve('content-strategy.json');
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

// 戦略データを反映した角度選択（使用回数が少ない角度を優先）
function pickAngleWithStrategy(angles, usedAngles, strategy) {
  const underused = strategy?.underusedAngles || [];
  // まず不足角度の中から未使用のものを優先
  const prioritized = angles.filter(a => underused.includes(a.name) && !usedAngles.includes(a.name));
  if (prioritized.length > 0) return prioritized[Math.floor(Math.random() * prioritized.length)];
  return pickFromArray(angles, usedAngles);
}

export function generateDailyTopics(count = 10) {
  const usedAngles = [];
  const usedLifestyles = [];
  const seasonal = getMonthSeasonal();
  const symptomQueue = buildSymptomQueue(count);

  // コンテンツ戦略（週次で更新）
  const strategy = loadContentStrategy();
  if (strategy) {
    console.log(`📈 コンテンツ戦略使用中 (更新: ${strategy.updatedAt?.slice(0,10)})`);
    if (strategy.underusedAngles?.length > 0) console.log(`  強化角度: ${strategy.underusedAngles.join(', ')}`);
    if (strategy.overusedPatterns?.length > 0) console.log(`  避けるパターン: ${strategy.overusedPatterns.join(', ')}`);
  }

  // クラスタープログレスを表示
  try {
    const progress = getClusterProgress();
    console.log('📊 クラスターカバレッジ:');
    for (const [symptom, p] of Object.entries(progress)) {
      console.log(`  ${symptom}: ${p.covered}/${p.total} (${p.pct}%) → 次: ${p.nextTarget?.keyword || '-'}`);
    }
  } catch {}

  // キーワードキャッシュがあれば使用
  const cache = loadKeywordCache();
  const cachedVariants = cache ? buildVariantsFromCache(cache) : null;
  if (cachedVariants) {
    console.log('📊 キーワードキャッシュ使用中（リサーチベース）');
  } else {
    console.log('📋 静的キーワードリスト使用中');
  }

  const topics = [];
  for (let i = 0; i < count; i++) {
    const { core, variant } = symptomQueue[i];
    const angle = pickAngleWithStrategy(ANGLES, usedAngles, strategy);
    const lifestyle = pickFromArray(LIFESTYLES, usedLifestyles);

    // クラスターから未カバーのサブトピックを取得（SEO1位狙いキーワード）
    let subtopicKeyword = null;
    let subtopicTheme = null;
    let subtopicId = null;
    try {
      const nextSub = getNextSubtopic(core);
      if (nextSub) {
        subtopicKeyword = nextSub.keyword;
        subtopicTheme = nextSub.theme;
        subtopicId = nextSub.id;
      }
    } catch {}

    // 優先順位: 戦略トレンド > クラスターサブトピック > キーワードキャッシュ > 静的バリアント
    let symptomVariant = variant;
    if (strategy?.trendingTopics?.[core]?.length > 0) {
      const trendVars = strategy.trendingTopics[core];
      symptomVariant = trendVars[i % trendVars.length];
    } else if (subtopicTheme) {
      symptomVariant = subtopicTheme;
    } else if (cachedVariants && cachedVariants[core]?.length > 0) {
      symptomVariant = cachedVariants[core][i % cachedVariants[core].length];
    }

    usedAngles.push(angle.name);
    usedLifestyles.push(lifestyle);
    if (usedAngles.length >= ANGLES.length) usedAngles.length = 0;
    if (usedLifestyles.length >= LIFESTYLES.length) usedLifestyles.length = 0;

    const publishHour = [7, 8, 10, 11, 13, 14, 16, 17, 19, 20][i];
    const publishMinute = Math.floor(Math.random() * 60);

    topics.push({
      slot: i + 1,
      category: '整体',
      symptom: symptomVariant,
      coreSymptom: core,
      angle: angle.name,
      angleDesc: angle.desc,
      lifestyle,
      seasonal,
      publishHour,
      publishMinute,
      overusedPatterns: strategy?.overusedPatterns || [],
      titleTemplates: strategy?.titleTemplates || [],
      // SEO1位狙いクラスター情報
      subtopicKeyword,
      subtopicTheme,
      subtopicId,
    });
  }

  return topics;
}

// 投稿完了後にクラスターカバレッジを記録
export function recordTopicPosted(topic) {
  if (!topic.subtopicId) return;
  try {
    recordSubtopicCovered(topic.coreSymptom, topic.subtopicId);
    console.log(`✅ クラスター記録: ${topic.coreSymptom} / ${topic.subtopicId}`);
  } catch (e) {
    console.warn(`⚠️ クラスター記録失敗: ${e.message}`);
  }
}

export function isDuplicateTitle(newTitle, threshold = 0.7) {
  const recent = loadHistory().slice(-30);
  const norm = s => s.replace(/[\s　・！!？?｜|【】「」]/g, '').toLowerCase();
  const a = norm(newTitle);
  for (const h of recent) {
    const b = norm(h.title || '');
    if (!b) continue;
    const minLen = Math.min(a.length, b.length);
    let same = 0;
    for (let i = 0; i < minLen; i++) if (a[i] === b[i]) same++;
    if (minLen > 5 && same / minLen > threshold) return true;
  }
  return false;
}
