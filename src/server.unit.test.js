const test = require('node:test');
const assert = require('node:assert');
const { extractModel, translateToAnthropic } = require('./server.js');

test('should extract Gemini model names exactly as provided', () => {
    assert.strictEqual(extractModel('/v1beta1/models/gemini-2.5-pro:streamGenerateContent'), 'gemini-2.5-pro');
    assert.strictEqual(extractModel('/v1beta1/models/gemini-3-pro-preview:generateContent'), 'gemini-3-pro-preview');
  });

  test('should pass through Claude models untouched', () => {
    assert.strictEqual(extractModel('/v1beta1/models/claude-3-opus@20240229:streamGenerateContent'), 'claude-3-opus@20240229');
    assert.strictEqual(extractModel('/v1beta1/models/claude-3-5-sonnet-v20241022:generateContent'), 'claude-3-5-sonnet-v20241022');
  });

  test('should pass through unknown models untouched', () => {
    assert.strictEqual(extractModel('/v1beta1/models/unknown-model-xyz:streamGenerateContent'), 'unknown-model-xyz');
  });

  test('should translate basic Gemini message', () => {
    const geminiReq = {
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
    };
    const anthropicReq = translateToAnthropic(geminiReq);
    
    assert.deepStrictEqual(anthropicReq.messages, [{ role: 'user', content: 'Hello' }]);
    assert.strictEqual(anthropicReq.anthropic_version, 'vertex-2023-10-16');
    assert.strictEqual(anthropicReq.max_tokens, 8192);
    assert.strictEqual(anthropicReq.stream, undefined);
    assert.strictEqual(anthropicReq.system, undefined);
  });

  test('should translate system instructions', () => {
    const geminiReq = {
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] }
    };
    const anthropicReq = translateToAnthropic(geminiReq);
    assert.strictEqual(anthropicReq.system, 'You are a helpful assistant.');
  });

  test('should handle JSON response format by appending to system prompt', () => {
    const geminiReq = {
      contents: [{ role: 'user', parts: [{ text: 'List files' }] }],
      generationConfig: { responseMimeType: 'application/json' }
    };
    const anthropicReq = translateToAnthropic(geminiReq);
    assert.ok(anthropicReq.system.includes('Respond ONLY with valid JSON'));
    assert.ok(anthropicReq.system.includes('Do not include any markdown formatting like ```json'));
  });

  test('should filter out empty messages but provide default space if completely empty', () => {
    const geminiReq = {
      contents: [
        { role: 'user', parts: [{ text: '' }] },
        { role: 'model', parts: [{ text: '  ' }] }
      ]
    };
    const anthropicReq = translateToAnthropic(geminiReq);
    // It should push a single empty user message so the API doesn't crash
    assert.deepStrictEqual(anthropicReq.messages, [{ role: 'user', content: ' ' }]);
  });
  
  test('should map temperature properly', () => {
    const geminiReq = {
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      generationConfig: { temperature: 0.0 }
    };
    const anthropicReq = translateToAnthropic(geminiReq);
    // Our logic adjusts strict 0 temperature to 0.001
    assert.strictEqual(anthropicReq.temperature, 0.001);
  });
