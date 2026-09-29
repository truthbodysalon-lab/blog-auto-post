/**
 * Gemini全滅時の最終フォールバック（Anthropic Claude）。
 *
 * Gemini flash系モデルが同時高負荷(503)・枠上限(429)で全モデルとも落ち、
 * 記事生成が月9回失敗した。モデル間フォールバックは正しく動いた上での全滅だったため、
 * プロバイダ単位のフォールバックとして Claude を最終段に置く。
 * ANTHROPIC_API_KEY が未設定なら isAnthropicAvailable() が false になり、呼び出し側は従来どおり失敗する。
 */
import Anthropic from '@anthropic-ai/sdk';

export function isAnthropicAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * @param {string} prompt
 * @param {{maxOutputTokens?: number, label?: string, temperature?: number}} [options]
 *   temperature 等のサンプリング指定は受け取っても無視する（claude-opus-5-5 は temperature/top_p/top_k を渡すと400になるため）。
 * @returns {Promise<string>} 生成テキスト
 */
export async function generateWithClaude(prompt, { maxOutputTokens, label } = {}) {
  const tag = label ? `[${label}] ` : '';
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  const client = new Anthropic(); // ANTHROPIC_API_KEY は SDK が自動で読む

  console.log(`🔁 ${tag}Gemini全滅 → Claude(${model})で再生成`);
  const response = await client.messages.create({
    model,
    max_tokens: maxOutputTokens || 16000, // 非ストリーミングなので巨大値は避ける（HTTPタイムアウト対策）
    messages: [{ role: 'user', content: prompt }],
  });

  // 安全分類器による拒否は content を読む前に判定する
  if (response.stop_reason === 'refusal') {
    throw new Error(`${tag}Claudeが応答を拒否しました (stop_reason=refusal): ${JSON.stringify(response.stop_details ?? null)}`);
  }
  if (response.stop_reason === 'max_tokens') {
    console.warn(`⚠️ ${tag}Claudeの出力が max_tokens で打ち切られました（途中で切れている可能性）`);
  }

  const text = (response.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (!text.trim()) throw new Error(`${tag}Claudeの応答テキストが空です (stop_reason=${response.stop_reason})`);

  console.log(`✅ ${tag}Claude(${model})で生成完了 (${text.length}文字)`);
  return text;
}
