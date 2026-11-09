// AI providers + fallback chain.
//
// runChain() tries each {provider, model} in order until one returns usable
// output. Failures (429 quota, 5xx, timeout, bad JSON, missing key) move on to
// the next step. Usage is collected in `usage` and saved by the caller in one
// DB batch (D1 free plan allows only 50 queries per invocation).
//
// Supported providers:
//   gemini      Google AI Studio (key: gemini_api_key)
//   groq        Groq, OpenAI-compatible (key: groq_api_key)
//   openrouter  OpenRouter, OpenAI-compatible (key: openrouter_api_key)
//   workers-ai  Cloudflare Workers AI via the AI binding (no key)

import { getSetting } from '../settings.js';
import { todayIST } from '../time.js';

const TIMEOUT_MS = 12000;

/** Create a per-invocation tracker: external-call budget + usage counters. */
export function newAiRun({ externalBudget = 40, deadlineMs = null } = {}) {
  return {
    externalLeft: externalBudget,              // Workers free plan: 50 external fetches per invocation
    deadline: deadlineMs ? Date.now() + deadlineMs : null,
    usage: new Map(),                          // 'provider:model' -> {calls, failures}
    keys: {},                                  // cached API keys
  };
}

function noteUsage(run, name, ok) {
  const u = run.usage.get(name) || { calls: 0, failures: 0 };
  u.calls++;
  if (!ok) u.failures++;
  run.usage.set(name, u);
}

/** D1 statements that save this run's usage (add them to your batch). */
export function usageStatements(run) {
  const day = todayIST();
  return [...run.usage.entries()].map(([provider, u]) => [
    `INSERT INTO ai_usage (day, provider, calls, failures) VALUES (?, ?, ?, ?)
     ON CONFLICT(day, provider) DO UPDATE SET calls = calls + excluded.calls, failures = failures + excluded.failures`,
    day, provider, u.calls, u.failures,
  ]);
}

async function apiKey(env, run, provider) {
  const setting = { gemini: 'gemini_api_key', groq: 'groq_api_key', openrouter: 'openrouter_api_key' }[provider];
  if (!setting) return null;
  if (!(provider in run.keys)) run.keys[provider] = await getSetting(env, setting);
  return run.keys[provider];
}

/**
 * Try the chain stored in setting `chainKey` ('chain_grade' | 'chain_chat').
 *   prompt = { system, messages: [{role:'user'|'assistant', content}], json: bool, maxTokens }
 *   validate(text) -> parsed value, or throws if unusable (then the next model is tried)
 * Returns { value, provider } or null if every step failed.
 */
export async function runChain(env, run, chainKey, prompt, validate = (t) => t) {
  const chain = await getSetting(env, chainKey);
  const errors = [];
  for (const step of chain) {
    const name = `${step.provider}:${step.model}`;
    if (run.deadline && Date.now() > run.deadline - 3000) { errors.push(`${name}: out of time`); break; }
    try {
      const text = await callProvider(env, run, step, prompt);
      const value = validate(text);
      noteUsage(run, name, true);
      return { value, provider: name };
    } catch (err) {
      if (err.skip) { errors.push(`${name}: ${err.message}`); continue; }  // not attempted (no key / budget)
      noteUsage(run, name, false);
      errors.push(`${name}: ${err.message}`);
      console.warn('AI step failed', name, err.message);
    }
  }
  console.warn('AI chain exhausted', chainKey, errors.join(' | '));
  return null;
}

/** Call a single provider/model directly (also used by the admin "Test" button). */
export async function callProvider(env, run, step, prompt) {
  if (step.provider === 'workers-ai') return callWorkersAi(env, step.model, prompt);

  const key = await apiKey(env, run, step.provider);
  if (!key) throw skip('no API key set');
  if (run.externalLeft <= 0) throw skip('call budget used up');
  run.externalLeft--;

  if (step.provider === 'gemini') return callGemini(key, step.model, prompt);
  if (step.provider === 'groq') {
    return callOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', key, step.model, prompt);
  }
  if (step.provider === 'openrouter') {
    return callOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', key, step.model, prompt, {
      'HTTP-Referer': env.FRONTEND_ORIGIN || 'https://github.com', 'X-Title': 'PAL Fitness',
    });
  }
  throw skip('unknown provider');
}

function skip(message) {
  const e = new Error(message);
  e.skip = true;
  return e;
}

async function httpJson(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'timeout' : 'network error');
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status} ${body}`);
  }
  return res.json();
}

// --- Google Gemini ----------------------------------------------------------
async function callGemini(key, model, { system, messages, json, maxTokens = 2048 }) {
  const body = {
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';

  const data = await httpJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }
  );
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
  if (!text) throw new Error('empty response' + (data?.candidates?.[0]?.finishReason ? ` (${data.candidates[0].finishReason})` : ''));
  return text;
}

// --- OpenAI-compatible (Groq, OpenRouter) -----------------------------------
async function callOpenAiCompatible(url, key, model, { system, messages, maxTokens = 2048 }, extraHeaders = {}) {
  const body = {
    model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    temperature: 0.6,
    max_tokens: maxTokens,
  };
  if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';   // keep reasoning short & fast
  const data = await httpJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('empty response');
  return text;
}

// --- Cloudflare Workers AI ---------------------------------------------------
async function callWorkersAi(env, model, { system, messages, maxTokens = 1024 }) {
  if (!env.AI) throw skip('AI binding missing');
  const call = env.AI.run(model, {
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    max_tokens: maxTokens,
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS + 8000));
  const out = await Promise.race([call, timeout]);
  let text = out?.response ?? out?.choices?.[0]?.message?.content ?? out?.result?.response;
  if (text && typeof text === 'object') text = JSON.stringify(text);
  if (!text || !String(text).trim()) throw new Error('empty response');
  return String(text).trim();
}

// ---------------------------------------------------------------------------
// Defensive JSON parsing (some models wrap JSON in prose or ``` fences)
// ---------------------------------------------------------------------------
export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* try harder */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* continue */ } }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new Error('invalid JSON');
}
