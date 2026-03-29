"""
LLM provider helpers for Winfinity.
API keys are passed per-request and never persisted server-side.
"""
import requests

PROVIDERS = {
    'openai': {
        'name': 'OpenAI',
        'models': [
            # Flagship chat
            'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
            'gpt-4o', 'gpt-4o-mini',
            # Reasoning (o-series) — no temperature, uses developer role
            'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini',
        ],
        'default': 'gpt-4o',
        'key_label': 'API Key',
    },
    'anthropic': {
        'name': 'Anthropic (Claude)',
        'models': [
            'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
            'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
        ],
        'default': 'claude-sonnet-4-6',
        'key_label': 'API Key',
    },
    'google': {
        'name': 'Google (Gemini)',
        'models': [
            'gemini-3.1-flash-lite-preview',
            'gemini-2.5-pro-preview', 'gemini-2.5-flash-preview',
            'gemini-2.0-flash', 'gemini-2.0-flash-lite',
            'gemini-1.5-pro', 'gemini-1.5-flash',
        ],
        'default': 'gemini-2.0-flash',
        'key_label': 'API Key',
    },
    'groq': {
        'name': 'Groq',
        'models': [
            'llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant',
            'deepseek-r1-distill-llama-70b', 'mixtral-8x7b-32768', 'gemma2-9b-it',
        ],
        'default': 'llama-3.3-70b-versatile',
        'key_label': 'API Key',
    },
    'xai': {
        'name': 'xAI (Grok)',
        'models': ['grok-3', 'grok-3-mini', 'grok-2-latest'],
        'default': 'grok-3',
        'key_label': 'API Key',
    },
    'ollama': {
        'name': 'Ollama (Local)',
        'models': [
            'llama3.2:latest', 'llama3.3', 'llama3.2', 'llama3.1',
            'mistral', 'mistral-nemo',
            'phi4', 'phi3',
            'gemma3', 'gemma2',
            'deepseek-r1', 'deepseek-r1:7b',
            'qwen2.5', 'qwen2.5-coder',
        ],
        'default': 'llama3.2:latest',
        'key_label': None,
    },
}

# OpenAI o-series reasoning models require different API params
_OPENAI_REASONING_MODELS = {'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini'}
# Older o1 models don't support system/developer role or json_object
_OPENAI_LEGACY_REASONING = {'o1-preview', 'o1-mini'}


def call_llm(provider: str, model: str, api_key: str,
             system: str, user: str,
             ollama_url: str = 'http://localhost:11434',
             auth_type: str = 'apikey') -> str | None:
    """Call the specified AI provider. Returns raw text response or None on failure.
    auth_type: 'apikey' (default) or 'oauth' (Google only — api_key holds the OAuth token).
    """
    try:
        if provider == 'openai':
            return _openai_compat('https://api.openai.com/v1/chat/completions',
                                  api_key, model, system, user)
        elif provider == 'anthropic':
            return _anthropic(api_key, model, system, user)
        elif provider == 'google':
            return _google(api_key, model, system, user, auth_type=auth_type)
        elif provider == 'groq':
            return _openai_compat('https://api.groq.com/openai/v1/chat/completions',
                                  api_key, model, system, user)
        elif provider == 'xai':
            return _openai_compat('https://api.x.ai/v1/chat/completions',
                                  api_key, model, system, user)
        elif provider == 'ollama':
            base = (ollama_url or 'http://localhost:11434').rstrip('/')
            return _openai_compat(f'{base}/v1/chat/completions', '', model, system, user)
    except Exception:
        return None
    return None


def _openai_compat(url: str, api_key: str, model: str,
                   system: str, user: str) -> str | None:
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    is_reasoning = model in _OPENAI_REASONING_MODELS
    is_legacy_o1 = model in _OPENAI_LEGACY_REASONING

    if is_legacy_o1:
        # o1-preview / o1-mini: no system role, no response_format, no temperature
        payload = {
            'model': model,
            'messages': [{'role': 'user', 'content': f'{system}\n\n{user}'}],
            'max_completion_tokens': 2048,
        }
    elif is_reasoning:
        # o1, o3, o3-mini, o4-mini: developer role, json_object OK, no temperature
        payload = {
            'model': model,
            'messages': [
                {'role': 'developer', 'content': system},
                {'role': 'user',      'content': user},
            ],
            'response_format': {'type': 'json_object'},
            'max_completion_tokens': 2048,
        }
    else:
        # Standard GPT models
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user',   'content': user},
            ],
            'response_format': {'type': 'json_object'},
            'temperature': 0.3,
            'max_tokens': 2048,
        }

    r = requests.post(url, headers=headers, json=payload, timeout=90)
    if r.ok:
        return r.json()['choices'][0]['message']['content']
    return None


def _anthropic(api_key: str, model: str, system: str, user: str) -> str | None:
    r = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        timeout=90,
        json={
            'model': model,
            'max_tokens': 2048,
            'system': system,
            'messages': [{'role': 'user', 'content': user}],
        },
    )
    if r.ok:
        return r.json()['content'][0]['text']
    return None


def _google(api_key: str, model: str, system: str, user: str,
            auth_type: str = 'apikey') -> str | None:
    url     = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    headers = {'Content-Type': 'application/json'}
    params  = {}

    if auth_type == 'oauth':
        # OAuth token — passed as Bearer in Authorization header
        headers['Authorization'] = f'Bearer {api_key}'
    else:
        # Standard API key — passed as query parameter
        params['key'] = api_key

    r = requests.post(
        url,
        headers=headers,
        params=params,
        timeout=90,
        json={
            'system_instruction': {'parts': [{'text': system}]},
            'contents': [{'parts': [{'text': user}]}],
            'generationConfig': {
                'responseMimeType': 'application/json',
                'temperature': 0.3,
            },
        },
    )
    if r.ok:
        candidates = r.json().get('candidates', [])
        if candidates:
            return candidates[0]['content']['parts'][0]['text']
    return None
