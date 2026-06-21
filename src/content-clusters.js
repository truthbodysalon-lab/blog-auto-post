import fs from 'fs';
import path from 'path';

// =====================================
// コンテンツクラスター定義
// 各ピラーに紐づくサブトピックでトピカルオーソリティを構築
// =====================================
export const CONTENT_CLUSTERS = {
  '肩こり': {
    pillarKeyword: '長岡市 肩こり 整体',
    subtopics: [
      { id: 'katakori-01', keyword: '長岡市 肩こり 原因', theme: '背骨の歪みと筋膜が引き起こす肩こりのメカニズム' },
      { id: 'katakori-02', keyword: '長岡市 肩こり ストレッチ', theme: '30秒でできるセルフケアストレッチ3選' },
      { id: 'katakori-03', keyword: '長岡市 デスクワーク 肩こり', theme: 'デスクワーカーの慢性肩こり対策' },
      { id: 'katakori-04', keyword: '長岡市 スマホ 肩こり', theme: 'スマホ首・スマホ肩こりの改善' },
      { id: 'katakori-05', keyword: '長岡市 肩こり 頭痛 関係', theme: '肩こりが頭痛を引き起こす仕組み' },
      { id: 'katakori-06', keyword: '長岡市 産後 肩こり', theme: '産後ママの肩こり・腕の疲れ' },
      { id: 'katakori-07', keyword: '長岡市 40代 50代 肩こり', theme: '40〜50代女性に多い慢性肩こり' },
      { id: 'katakori-08', keyword: '長岡市 肩こり マッサージ 違い', theme: '整体とマッサージ・湿布の違い' },
      { id: 'katakori-09', keyword: '長岡市 肩こり 薬 治らない', theme: '薬・湿布で治らない肩こりの根本原因' },
      { id: 'katakori-10', keyword: '長岡市 肩こり 自律神経', theme: '肩こりと自律神経失調の関係' },
      { id: 'katakori-11', keyword: '長岡市 冬 肩こり 悪化', theme: '雪国・寒さで肩こりが悪化する理由' },
      { id: 'katakori-12', keyword: '長岡市 肩こり 放置 危険', theme: '慢性肩こりを放置するリスク' },
    ],
  },
  '頭痛': {
    pillarKeyword: '長岡市 頭痛 整体',
    subtopics: [
      { id: 'zutsu-01', keyword: '長岡市 緊張型頭痛 整体', theme: '緊張型頭痛の原因と整体での改善' },
      { id: 'zutsu-02', keyword: '長岡市 片頭痛 首 肩', theme: '片頭痛と首・肩こりの深い関係' },
      { id: 'zutsu-03', keyword: '長岡市 気圧 頭痛 雨の日', theme: '気圧変化・雨の日に頭痛が起きるメカニズム' },
      { id: 'zutsu-04', keyword: '長岡市 後頭部 頭痛 原因', theme: '後頭部が痛い頭痛の原因と対処法' },
      { id: 'zutsu-05', keyword: '長岡市 頭痛薬 効かない', theme: '頭痛薬に頼らない根本改善' },
      { id: 'zutsu-06', keyword: '長岡市 肩こり 頭痛 同時', theme: '肩こりと頭痛が同時に出る原因' },
      { id: 'zutsu-07', keyword: '長岡市 首 歪み 頭痛', theme: '首の歪み・ストレートネックと頭痛' },
      { id: 'zutsu-08', keyword: '長岡市 デスクワーク 頭痛 毎日', theme: '毎日頭痛が出るデスクワーカーへ' },
      { id: 'zutsu-09', keyword: '長岡市 朝 頭痛 原因', theme: '朝起きたときの頭痛・起床時頭痛' },
      { id: 'zutsu-10', keyword: '長岡市 頭痛 自律神経 整体', theme: '自律神経と慢性頭痛の関係' },
      { id: 'zutsu-11', keyword: '長岡市 梅雨 頭痛 対策', theme: '梅雨・低気圧シーズンの頭痛対策' },
      { id: 'zutsu-12', keyword: '長岡市 頭痛 睡眠不足 関係', theme: '睡眠不足・寝すぎと頭痛の関係' },
    ],
  },
  '姿勢': {
    pillarKeyword: '長岡市 姿勢矯正 整体',
    subtopics: [
      // --- 猫背 ---
      { id: 'shisei-01', keyword: '長岡市 猫背 改善 整体', theme: '猫背の原因と整体での根本改善' },
      { id: 'shisei-11', keyword: '長岡市 猫背 肩こり 頭痛', theme: '猫背が引き起こす肩こり・頭痛の仕組み' },
      { id: 'shisei-12', keyword: '長岡市 猫背 大人 治し方', theme: '大人の猫背を整体で改善する方法' },
      { id: 'shisei-13', keyword: '長岡市 スマホ 猫背 悪化', theme: 'スマホ・PCで猫背が進行するメカニズム' },
      { id: 'shisei-14', keyword: '長岡市 猫背 骨盤 歪み 関係', theme: '猫背と骨盤の歪みはセットで起きる' },
      // --- 反り腰 ---
      { id: 'shisei-06', keyword: '長岡市 反り腰 原因 改善', theme: '反り腰の原因と整体での改善方法' },
      { id: 'shisei-15', keyword: '長岡市 反り腰 腰痛 関係', theme: '反り腰が慢性腰痛を引き起こす理由' },
      { id: 'shisei-16', keyword: '長岡市 反り腰 産後 改善', theme: '産後に反り腰が悪化する原因と対策' },
      { id: 'shisei-17', keyword: '長岡市 反り腰 チェック 症状', theme: '反り腰のセルフチェックと代表的な症状' },
      { id: 'shisei-18', keyword: '長岡市 反り腰 骨盤 前傾', theme: '骨盤前傾・反り腰を整体で根本から整える' },
      // --- その他姿勢 ---
      { id: 'shisei-02', keyword: '長岡市 ストレートネック 改善', theme: 'ストレートネック（スマホ首）の改善' },
      { id: 'shisei-03', keyword: '長岡市 巻き肩 治し方', theme: '巻き肩の原因と改善ストレッチ' },
      { id: 'shisei-04', keyword: '長岡市 テレワーク 姿勢 悪化', theme: 'テレワーク・在宅勤務で姿勢が崩れる理由' },
      { id: 'shisei-05', keyword: '長岡市 姿勢 肩こり 頭痛 関係', theme: '姿勢の崩れが肩こり・頭痛を引き起こす仕組み' },
      { id: 'shisei-07', keyword: '長岡市 姿勢矯正 グッズ 効果', theme: '姿勢矯正グッズvsの整体の違い' },
      { id: 'shisei-08', keyword: '長岡市 子供 姿勢 改善', theme: '子供・10代の姿勢悪化と対策' },
      { id: 'shisei-09', keyword: '長岡市 O脚 改善 整体', theme: 'O脚・X脚と骨盤の歪みの関係' },
      { id: 'shisei-10', keyword: '長岡市 姿勢 自律神経 影響', theme: '猫背・姿勢の崩れが自律神経に与える影響' },
    ],
  },
  '骨盤矯正': {
    pillarKeyword: '長岡市 骨盤矯正 整体',
    subtopics: [
      { id: 'kotsuban-01', keyword: '長岡市 骨盤 歪み 原因', theme: '骨盤が歪む原因とその影響' },
      { id: 'kotsuban-02', keyword: '長岡市 産後 骨盤矯正 いつから', theme: '産後の骨盤矯正はいつから始めるべきか' },
      { id: 'kotsuban-03', keyword: '長岡市 生理痛 骨盤 歪み', theme: '生理痛・PMS改善に骨盤矯正が効く理由' },
      { id: 'kotsuban-04', keyword: '長岡市 骨盤矯正 ダイエット 効果', theme: '骨盤矯正がダイエットにつながる仕組み' },
      { id: 'kotsuban-05', keyword: '長岡市 腰痛 骨盤 歪み', theme: '慢性腰痛と骨盤の歪みの深い関係' },
      { id: 'kotsuban-06', keyword: '長岡市 冷え性 骨盤 関係', theme: '骨盤の歪みと冷え性の関係' },
      { id: 'kotsuban-07', keyword: '長岡市 更年期 骨盤 ゆるみ', theme: '更年期と骨盤のゆるみ・不調' },
      { id: 'kotsuban-08', keyword: '長岡市 骨盤矯正ベルト 整体 違い', theme: '骨盤矯正ベルトと整体の根本的な違い' },
      { id: 'kotsuban-09', keyword: '長岡市 骨盤 左右差 症状', theme: '骨盤の左右差が引き起こす体の歪み症状' },
      { id: 'kotsuban-10', keyword: '長岡市 座り方 骨盤 歪み', theme: '座り方の癖が骨盤歪みを悪化させる' },
    ],
  },
};

const COVERAGE_FILE = path.resolve('rankings', 'cluster-coverage.json');

export function loadClusterCoverage() {
  try {
    if (!fs.existsSync(COVERAGE_FILE)) return {};
    return JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveClusterCoverage(coverage) {
  const dir = path.dirname(COVERAGE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COVERAGE_FILE, JSON.stringify(coverage, null, 2));
}

// 投稿後にカバレッジを更新（subtopic IDを記録）
export function recordSubtopicCovered(coreSymptom, subtopicId) {
  const coverage = loadClusterCoverage();
  if (!coverage[coreSymptom]) coverage[coreSymptom] = {};
  const current = coverage[coreSymptom][subtopicId] || 0;
  coverage[coreSymptom][subtopicId] = current + 1;
  coverage[coreSymptom]['_lastUpdated'] = new Date().toISOString();
  saveClusterCoverage(coverage);
}

// 最も薄いサブトピックを返す（優先度: 未カバー > カバー回数最小）
export function getNextSubtopic(coreSymptom) {
  const cluster = CONTENT_CLUSTERS[coreSymptom];
  if (!cluster) return null;

  const coverage = loadClusterCoverage()[coreSymptom] || {};
  const subtopics = cluster.subtopics;

  // 未カバーのものを優先
  const uncovered = subtopics.filter(s => !coverage[s.id]);
  if (uncovered.length > 0) {
    return uncovered[Math.floor(Math.random() * Math.min(3, uncovered.length))];
  }

  // 全カバー済みなら一番少ないものを選ぶ
  const sorted = [...subtopics].sort((a, b) => (coverage[a.id] || 0) - (coverage[b.id] || 0));
  return sorted[0];
}

// クラスターの進捗サマリーを生成
export function getClusterProgress() {
  const coverage = loadClusterCoverage();
  const summary = {};
  for (const [symptom, cluster] of Object.entries(CONTENT_CLUSTERS)) {
    const total = cluster.subtopics.length;
    const cov = coverage[symptom] || {};
    const covered = cluster.subtopics.filter(s => cov[s.id] > 0).length;
    const totalPosts = Object.entries(cov)
      .filter(([k]) => !k.startsWith('_'))
      .reduce((sum, [, n]) => sum + n, 0);
    summary[symptom] = {
      covered,
      total,
      pct: Math.round((covered / total) * 100),
      totalPosts,
      pillarKeyword: cluster.pillarKeyword,
      nextTarget: getNextSubtopic(symptom),
    };
  }
  return summary;
}
