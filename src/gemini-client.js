/**
 * Gemini呼び出しの共通クライアント。
 *
 * 各生成スクリプトが同じリトライループをコピーして持っていた結果、
 * 「応答が途中で切れてJSONが壊れる」事故が再生成されないまま即失敗していた
 * （2026-08-15 HPBブログ下書き生成の停止）。Geminiを呼ぶ処理はこのモジュールに集約し、
 * 以下を全スクリプトで共通に保証する。
 *
 *   1. thinkingトークンが出力枠を食って本文が途中で切れるのを防ぐ（thinkingBudget: 0）
 *   2. 出力枠を明示する（maxOutputTokens）
 *   3. finishReason が STOP 以外の応答は不完全とみなす
 *   4. パース・検証を通らない応答はリトライループの内側で再生成する
 *   5. 枠上限(429)・高負荷(503)・廃止(404)は「生きている」別モデルへ切替える
 *   6. Geminiが全滅したら Claude を最終段として1回だけ試す（ANTHROPIC_API_KEY がある場合のみ）
 *
 * 呼び出し側は成功した結果だけを受け取る。検証条件は validate に渡すこと
 * （validate が throw すると呼び出し側にエラーを返さず再生成をやり直す）。
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isAnthropicAvailable, generateWithClaude } from './anthropic-fallback.js';

// 無料枠はモデルごとに別々の1日上限。429時に別モデルへ切替えて枯渇を回避する。
// ⚠️ 提供終了したモデルを並べると枠上限時にまとめて404で落ちて意味をなさない
//    （2026-08-15時点で gemini-2.0-flash / gemini-2.5-flash-lite は404）。
//    候補を足すときは必ず generateContent が実際に通ることを確認してから追加すること。
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];

const MAX_ATTEMPTS     = 6;
const API_WAITS        = [8000, 15000, 25000, 25000, 25000];
const BAD_OUTPUT_WAIT  = 3000;
const DEFAULT_MAX_TOKENS = 16384;

/**
 * JSONとして解釈する。前後に余計な文字が付いていても中身を拾う。
 * 応答が途中で切れている場合はここで失敗する。
 */
export function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSONパース失敗:\n' + text.slice(0, 500));
    return JSON.parse(match[0]);
  }
}

async function callWithRetry(prompt, { temperature, maxOutputTokens, responseMimeType, waits, label, extract }) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY が未設定です');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const candidates = MODEL_CANDIDATES.filter((m, i, a) => a.indexOf(m) === i);
  const apiWaits = waits || API_WAITS;
  const tag = label ? `[${label}] ` : '';

  const makeModel = (name) => genAI.getGenerativeModel({
    model: name,
    generationConfig: {
      temperature,
      maxOutputTokens,
      // thinkingトークンが出力枠を食うと本文が途中で切れてパースに失敗する
      thinkingConfig: { thinkingBudget: 0 },
      ...(responseMimeType ? { responseMimeType } : {}),
    },
  });

  // Gemini全滅時の最終段。ANTHROPIC_API_KEY 未設定なら従来どおり元のエラーをそのまま投げる。
  // Claude呼び出しは1回のみ。応答は Gemini と同じ extract（パース・validate）に通す。
  const claudeFallback = async (geminiError) => {
    if (!isAnthropicAvailable()) throw geminiError;
    let text;
    try {
      text = await generateWithClaude(prompt, { maxOutputTokens, label });
    } catch (claudeError) {
      throw new Error(`${tag}Gemini全滅かつClaudeも失敗しました。Gemini: ${geminiError.message.split('\n')[0]} / Claude: ${claudeError.message.split('\n')[0]}`);
    }
    return extract(text);
  };

  let modelIdx = 0;
  let model = makeModel(candidates[modelIdx]);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;

    // API呼び出し: 枠上限はモデル切替、一時障害は待ってリトライ
    try {
      response = (await model.generateContent(prompt)).response;
    } catch (e) {
      const msg         = e.message || '';
      const lower       = msg.toLowerCase();
      const isQuota     = msg.includes('429') || lower.includes('quota');
      const isBusy      = msg.includes('503') || lower.includes('overloaded') || lower.includes('high demand');
      const isGone      = msg.includes('404') || lower.includes('no longer available');
      const isRetryable = isQuota || msg.includes('503') || msg.includes('overloaded');
      if ((isQuota || isBusy || isGone) && modelIdx < candidates.length - 1) {
        const prev = candidates[modelIdx];
        modelIdx++;
        model = makeModel(candidates[modelIdx]);
        console.log(`⚠️ ${tag}${prev} が ${isQuota ? '枠上限(429)' : isBusy ? '高負荷(503)' : '廃止(404)'} → ${candidates[modelIdx]} に切替えて再試行`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (!isRetryable || attempt === MAX_ATTEMPTS) return claudeFallback(e);
      const wait = apiWaits[attempt - 1] || apiWaits[apiWaits.length - 1];
      console.log(`⏳ ${tag}API一時エラー (試行${attempt}/${MAX_ATTEMPTS})、${wait / 1000}秒後にリトライ...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    // 応答内容の検証: 切断や不正な形式は再生成しないと直らないので必ずリトライする
    try {
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        throw new Error(`応答が異常終了 (finishReason=${finishReason})`);
      }
      return extract(response.text());
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) return claudeFallback(e);
      console.log(`⏳ ${tag}応答が不正 (試行${attempt}/${MAX_ATTEMPTS}): ${e.message.split('\n')[0]} → 再生成します`);
      await new Promise(r => setTimeout(r, BAD_OUTPUT_WAIT));
    }
  }

  return claudeFallback(new Error(`${tag}生成に失敗しました（${MAX_ATTEMPTS}回試行）`));
}

/**
 * JSONを生成させて、パース済みオブジェクトを返す。
 * @param {string} prompt
 * @param {{temperature?: number, maxOutputTokens?: number, waits?: number[], label?: string,
 *          validate?: (obj: any) => void}} [options]
 *   validate は不備があれば throw すること（その応答は破棄して再生成される）
 */
export function generateJson(prompt, options = {}) {
  const { temperature = 0.85, maxOutputTokens = DEFAULT_MAX_TOKENS, waits, label, validate } = options;
  return callWithRetry(prompt, {
    temperature, maxOutputTokens, waits, label,
    responseMimeType: 'application/json',
    extract: (text) => {
      const obj = parseJsonLoose(text);
      if (validate) validate(obj);
      return obj;
    },
  });
}

/**
 * プレーンテキストを生成させて返す。
 * @param {string} prompt
 * @param {{temperature?: number, maxOutputTokens?: number, waits?: number[], label?: string,
 *          validate?: (text: string) => void}} [options]
 *   validate は不備があれば throw すること（その応答は破棄して再生成される）
 */
export function generateText(prompt, options = {}) {
  const { temperature = 0.85, maxOutputTokens = DEFAULT_MAX_TOKENS, waits, label, validate } = options;
  return callWithRetry(prompt, {
    temperature, maxOutputTokens, waits, label,
    extract: (text) => {
      const out = text.trim();
      if (!out) throw new Error('空の応答');
      if (validate) validate(out);
      return out;
    },
  });
}
