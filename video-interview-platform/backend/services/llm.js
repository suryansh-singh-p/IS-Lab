/**
 * LLM client factory.
 * Returns an OpenAI-compatible client pointed at the configured provider.
 *
 * Supported providers (LLM_PROVIDER env):
 *   ollama      — local Ollama server (default for Docker)
 *   openrouter  — OpenRouter cloud API
 *   openai      — OpenAI cloud API
 *
 * Related env vars:
 *   LLM_PROVIDER   ollama | openrouter | openai   (default: ollama)
 *   LLM_BASE_URL   full base URL                  (default: http://ollama:11434/v1)
 *   LLM_MODEL      model name to use              (default: llama3.2:3b)
 *   LLM_API_KEY    API key (not needed for Ollama) (default: ollama)
 */
const OpenAI = require('openai');
const config = require('../config');

const PROVIDER_DEFAULTS = {
    ollama: {
        baseURL: 'http://ollama:11434/v1',
        apiKey: 'ollama'
    },
    openrouter: {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.openRouterApiKey || ''
    },
    openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: config.openaiApiKey || ''
    }
};

const provider = config.llmProvider;
const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.ollama;

const baseURL = config.llmBaseUrl || defaults.baseURL;
const apiKey  = config.llmApiKey  || defaults.apiKey;

const llm = new OpenAI({ baseURL, apiKey });

console.log(`[LLM] Provider: ${provider} | Base URL: ${baseURL} | Model: ${config.llmModel}`);

module.exports = llm;
