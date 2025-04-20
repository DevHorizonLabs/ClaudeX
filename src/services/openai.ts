import { OpenAI } from 'openai'
import {
  getGlobalConfig,
  GlobalConfig,
  getActiveApiKey,
  markApiKeyAsFailed,
  getApiKeys,
} from '../utils/config'
import { ProxyAgent, fetch, Response } from 'undici'
import { setSessionState, getSessionState } from '../utils/sessionState'
import { logEvent } from '../services/statsig'

enum ModelErrorType {
  MaxLength = '1024',
  MaxCompletionTokens = 'max_completion_tokens',
  StreamOptions = 'stream_options',
  Citations = 'citations',
  RateLimit = 'rate_limit',
}

function getModelErrorKey(
  baseURL: string,
  model: string,
  type: ModelErrorType,
): string {
  return `${baseURL}:${model}:${type}`
}

function hasModelError(
  baseURL: string,
  model: string,
  type: ModelErrorType,
): boolean {
  return !!getSessionState('modelErrors')[
    getModelErrorKey(baseURL, model, type)
  ]
}

function setModelError(
  baseURL: string,
  model: string,
  type: ModelErrorType,
  error: string,
) {
  setSessionState('modelErrors', {
    [getModelErrorKey(baseURL, model, type)]: error,
  })
}

// More flexible error detection system
type ErrorDetector = (errMsg: string) => boolean
type ErrorFixer = (
  opts: OpenAI.ChatCompletionCreateParams,
) => Promise<void> | void
type RateLimitHandler = (
  opts: OpenAI.ChatCompletionCreateParams,
  response: Response,
  type: 'large' | 'small',
  config: GlobalConfig,
  attempt: number,
  maxAttempts: number,
) => Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>>

interface ErrorHandler {
  type: ModelErrorType
  detect: ErrorDetector
  fix: ErrorFixer
}

// Specialized handler for rate limiting
const handleRateLimit: RateLimitHandler = async (
  opts,
  response,
  type,
  config,
  attempt,
  maxAttempts,
) => {
  const retryAfter = response?.headers.get('retry-after')
  const delay =
    retryAfter && !isNaN(parseInt(retryAfter))
      ? parseInt(retryAfter) * 1000
      : Math.pow(2, attempt) * 1000
  logEvent('rate_limited', {
    delay: String(delay),
    attempt: String(attempt),
    maxAttempts: String(maxAttempts),
  })
  setSessionState(
    'currentError',
    `(${attempt} / ${maxAttempts}) Rate limited. Retrying in ${delay / 1000} seconds...`,
  )
  await new Promise(resolve => setTimeout(resolve, delay))
  return getCompletion(type, opts, attempt + 1, maxAttempts)
}

// Standard error handlers
const ERROR_HANDLERS: ErrorHandler[] = [
  {
    type: ModelErrorType.MaxLength,
    detect: errMsg =>
      errMsg.includes('Expected a string with maximum length 1024'),
    fix: async opts => {
      const toolDescriptions = {}
      for (const tool of opts.tools || []) {
        if (tool.function.description.length <= 1024) continue
        let str = ''
        let remainder = ''
        for (let line of tool.function.description.split('\n')) {
          if (str.length + line.length < 1024) {
            str += line + '\n'
          } else {
            remainder += line + '\n'
          }
        }
        logEvent('truncated_tool_description', {
          name: tool.function.name,
          original_length: String(tool.function.description.length),
          truncated_length: String(str.length),
          remainder_length: String(remainder.length),
        })
        tool.function.description = str
        toolDescriptions[tool.function.name] = remainder
      }
      if (Object.keys(toolDescriptions).length > 0) {
        let content = '<additional-tool-usage-instructions>\n\n'
        for (const [name, description] of Object.entries(toolDescriptions)) {
          content += `<${name}>\n${description}\n</${name}>\n\n`
        }
        content += '</additional-tool-usage-instructions>'

        for (let i = opts.messages.length - 1; i >= 0; i--) {
          if (opts.messages[i].role === 'system') {
            opts.messages.splice(i + 1, 0, {
              role: 'system',
              content,
            })
            break
          }
        }
      }
    },
  },
  {
    type: ModelErrorType.MaxCompletionTokens,
    detect: errMsg => errMsg.includes("Use 'max_completion_tokens'"),
    fix: async opts => {
      opts.max_completion_tokens = opts.max_tokens
      delete opts.max_tokens
    },
  },
  {
    type: ModelErrorType.StreamOptions,
    detect: errMsg => errMsg.includes('stream_options'),
    fix: async opts => {
      delete opts.stream_options
    },
  },
  {
    type: ModelErrorType.Citations,
    detect: errMsg =>
      errMsg.includes('Extra inputs are not permitted') &&
      errMsg.includes('citations'),
    fix: async opts => {
      if (!opts.messages) return

      for (const message of opts.messages) {
        if (!message) continue

        if (Array.isArray(message.content)) {
          for (const item of message.content) {
            // Convert to unknown first to safely access properties
            if (item && typeof item === 'object') {
              const itemObj = item as unknown as Record<string, unknown>
              if ('citations' in itemObj) {
                delete itemObj.citations
              }
            }
          }
        } else if (message.content && typeof message.content === 'object') {
          // Convert to unknown first to safely access properties
          const contentObj = message.content as unknown as Record<
            string,
            unknown
          >
          if ('citations' in contentObj) {
            delete contentObj.citations
          }
        }
      }
    },
  },
]

// Rate limit specific detection
function isRateLimitError(errMsg: string): boolean {
  if (!errMsg) return false
  const lowerMsg = errMsg.toLowerCase()
  return (
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('429')
  )
}

// Model-specific feature flags - can be extended with more properties as needed
interface ModelFeatures {
  usesMaxCompletionTokens: boolean
}

// Map of model identifiers to their specific features
const MODEL_FEATURES: Record<string, ModelFeatures> = {
  // OpenAI thinking models
  o1: { usesMaxCompletionTokens: true },
  'o1-preview': { usesMaxCompletionTokens: true },
  'o1-mini': { usesMaxCompletionTokens: true },
  'o1-pro': { usesMaxCompletionTokens: true },
  'o3-mini': { usesMaxCompletionTokens: true },
  o3: { usesMaxCompletionTokens: true },
  'o4-mini': { usesMaxCompletionTokens: true },
}

// Helper to get model features based on model ID/name
function getModelFeatures(modelName: string): ModelFeatures {
  // Check for exact matches first
  if (MODEL_FEATURES[modelName]) {
    return MODEL_FEATURES[modelName]
  }

  // Check for partial matches (e.g., if modelName contains a known model ID)
  for (const [key, features] of Object.entries(MODEL_FEATURES)) {
    if (modelName.includes(key)) {
      return features
    }
  }

  // Default features for unknown models
  return { usesMaxCompletionTokens: false }
}

// Apply model-specific parameter transformations based on model features
function applyModelSpecificTransformations(
  opts: OpenAI.ChatCompletionCreateParams,
): void {
  if (!opts.model || typeof opts.model !== 'string') {
    return
  }

  const features = getModelFeatures(opts.model)

  // Apply transformations based on features
  if (
    features.usesMaxCompletionTokens &&
    'max_tokens' in opts &&
    !('max_completion_tokens' in opts)
  ) {
    opts.max_completion_tokens = opts.max_tokens
    delete opts.max_tokens
  }

  // Add more transformations here as needed
}

async function applyModelErrorFixes(
  opts: OpenAI.ChatCompletionCreateParams,
  baseURL: string,
) {
  for (const handler of ERROR_HANDLERS) {
    if (hasModelError(baseURL, opts.model, handler.type)) {
      await handler.fix(opts)
      return
    }
  }
}

async function handleApiError(
  response: Response,
  error: any,
  type: 'large' | 'small',
  opts: OpenAI.ChatCompletionCreateParams,
  config: GlobalConfig,
  attempt: number,
  maxAttempts: number,
): Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>> {
  let errMsg = error.error?.message || error.message || error
  if (errMsg) {
    if (typeof errMsg !== 'string') {
      errMsg = JSON.stringify(errMsg)
    }

    // Check for authentication errors in both message and status code
    const isAuthError =
      response.status === 401 || // Unauthorized
      response.status === 403 || // Forbidden
      errMsg.toLowerCase().includes('authentication_error') ||
      errMsg.toLowerCase().includes('invalid api key') ||
      errMsg.toLowerCase().includes('unauthorized') ||
      errMsg.toLowerCase().includes('forbidden')

    if (isAuthError) {
      const apiKey = getActiveApiKey(config, type, false)
      if (apiKey) {
        markApiKeyAsFailed(apiKey, type)
        // Try with next key
        return getCompletion(type, opts, attempt + 1, maxAttempts)
      }
    }

    // Check for rate limiting
    if (isRateLimitError(errMsg)) {
      logEvent('rate_limit_error', {
        error_message: errMsg,
      })
      return handleRateLimit(opts, response, type, config, attempt, maxAttempts)
    }

    // Handle other errors
    const baseURL =
      type === 'large' ? config.largeModelBaseURL : config.smallModelBaseURL

    for (const handler of ERROR_HANDLERS) {
      if (handler.detect(errMsg)) {
        logEvent('model_error', {
          model: opts.model,
          error: handler.type,
          error_message: errMsg,
        })
        setSessionState(
          'currentError',
          `(${attempt} / ${maxAttempts}) Error: ${handler.type}. Retrying...`,
        )
        setModelError(baseURL, opts.model, handler.type, errMsg)
        return getCompletion(type, opts, attempt + 1, maxAttempts)
      }
    }
  }

  // If we get here, it's an unhandled error
  logEvent('unhandled_api_error', {
    model: opts.model,
    error: errMsg,
    error_message: errMsg,
  })

  throw new Error(
    `API request failed: ${error.error?.message || JSON.stringify(error)}`,
  )
}

export async function getCompletion(
  type: 'large' | 'small',
  opts: OpenAI.ChatCompletionCreateParams,
  attempt: number = 0,
  maxAttempts: number = 5,
): Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>> {
  const config = getGlobalConfig()
  const failedKeys = getSessionState('failedApiKeys')[type]
  const availableKeys = getApiKeys(config, type)
  const allKeysFailed =
    failedKeys.length === availableKeys.length && availableKeys.length > 0

  if (attempt >= maxAttempts || allKeysFailed) {
    throw new Error('Max attempts reached or all API keys failed')
  }

  const apiKey = getActiveApiKey(config, type)
  if (!apiKey || apiKey.trim() === '') {
    return getCompletion(type, opts, attempt + 1, maxAttempts)
  }

  const apiKeyRequired =
    type === 'large'
      ? config.largeModelApiKeyRequired
      : config.smallModelApiKeyRequired
  const baseURL =
    type === 'large' ? config.largeModelBaseURL : config.smallModelBaseURL
  const provider = config.primaryProvider
  const isAzure = provider === 'azure'
  const proxy = config.proxy ? new ProxyAgent(config.proxy) : undefined

  // Define Azure-specific API endpoint with version
  const azureApiVersion = '2024-06-01'
  const endpoint = isAzure
    ? `/chat/completions?api-version=${azureApiVersion}`
    : '/chat/completions'

  // Set up headers based on provider
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Azure uses api-key header instead of Authorization: Bearer
  if (isAzure) {
    headers['api-key'] = apiKey
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  logEvent('get_completion', {
    messages: JSON.stringify(
      opts.messages.map(m => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content.slice(0, 100)
            : m.content
              ? JSON.stringify(
                  m.content?.map(c => ({
                    type: c.type,
                    text: c.text?.slice(0, 100),
                  })),
                )
              : '',
      })),
    ),
  })
  opts = structuredClone(opts)

  // Apply model-specific parameter transformations (e.g. max_tokens → max_completion_tokens for o1/o3/o4 models)
  applyModelSpecificTransformations(opts)

  // Ensure tool_choice is properly set for models that support tools
  if (opts.tools && opts.tools.length > 0 && !opts.tool_choice) {
    opts.tool_choice = 'auto'
  }

  await applyModelErrorFixes(opts, baseURL)

  // Make sure all tool messages have string content
  opts.messages = opts.messages.map(msg => {
    if (msg.role === 'tool') {
      // Ensure content is a string for all tool messages
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content:
            msg.content
              .map(c => c.text || '')
              .filter(Boolean)
              .join('\n\n') || '(empty content)',
        }
      } else if (typeof msg.content !== 'string') {
        // For non-array, non-string content, convert to JSON string
        return {
          ...msg,
          content:
            typeof msg.content === 'undefined'
              ? '(empty content)'
              : JSON.stringify(msg.content),
        }
      }
    }
    return msg
  })

  const handleResponse = async (response: Response) => {
    try {
      let responseData: any
      if (response.ok) {
        responseData = (await response.json()) as any
        if (responseData?.response?.includes('429')) {
          return handleRateLimit(
            opts,
            response,
            type,
            config,
            attempt,
            maxAttempts,
          )
        }
        // Only reset failed keys if this key was previously marked as failed
        const failedKeys = getSessionState('failedApiKeys')[type]
        if (apiKey && failedKeys.includes(apiKey)) {
          setSessionState('failedApiKeys', {
            ...getSessionState('failedApiKeys'),
            [type]: failedKeys.filter(k => k !== apiKey),
          })
        }
        return responseData
      } else {
        const error = (await response.json()) as {
          error?: { message: string }
          message?: string
        }
        return handleApiError(
          response,
          error,
          type,
          opts,
          config,
          attempt,
          maxAttempts,
        )
      }
    } catch (jsonError) {
      // If we can't parse the error as JSON, use the status text
      return handleApiError(
        response,
        {
          error: {
            message: `HTTP error ${response.status}: ${response.statusText}`,
          },
        },
        type,
        opts,
        config,
        attempt,
        maxAttempts,
      )
    }
  }

  try {
    if (opts.stream) {
      const response = await fetch(`${baseURL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...opts, stream: true }),
        dispatcher: proxy,
      })

      if (!response.ok) {
        try {
          const error = (await response.json()) as {
            error?: { message: string }
            message?: string
          }
          return handleApiError(
            response,
            error,
            type,
            opts,
            config,
            attempt,
            maxAttempts,
          )
        } catch (jsonError) {
          // If we can't parse the error as JSON, use the status text
          return handleApiError(
            response,
            {
              error: {
                message: `HTTP error ${response.status}: ${response.statusText}`,
              },
            },
            type,
            opts,
            config,
            attempt,
            maxAttempts,
          )
        }
      }

      // Only reset failed keys if this key was previously marked as failed
      const failedKeys = getSessionState('failedApiKeys')[type]
      if (apiKey && failedKeys.includes(apiKey)) {
        setSessionState('failedApiKeys', {
          ...getSessionState('failedApiKeys'),
          [type]: failedKeys.filter(k => k !== apiKey),
        })
      }

      // Create a stream that checks for errors while still yielding chunks
      const stream = createStreamProcessor(response.body as any)
      return (async function* errorAwareStream() {
        let hasReportedError = false

        try {
          for await (const chunk of stream) {
            // Safely check for errors
            if (chunk && typeof chunk === 'object') {
              const chunkObj = chunk as any
              if (chunkObj.error) {
                if (!hasReportedError) {
                  hasReportedError = true
                  const errorValue = chunkObj.error

                  // Log error
                  logEvent('stream_error', {
                    error:
                      typeof errorValue === 'string'
                        ? errorValue
                        : JSON.stringify(errorValue),
                  })

                  // Handle the error - this will return a new completion or stream
                  const errorResult = await handleApiError(
                    response,
                    errorValue,
                    type,
                    opts,
                    config,
                    attempt,
                    maxAttempts,
                  )

                  // If it's a stream, yield from it and return
                  if (Symbol.asyncIterator in errorResult) {
                    for await (const errorChunk of errorResult as AsyncIterable<OpenAI.ChatCompletionChunk>) {
                      yield errorChunk
                    }
                    return // End this generator after yielding all chunks from error result
                  } else {
                    // It's a regular completion, not a stream - we can't really use this in a streaming context
                    // Just log it and continue with the original stream (skipping error chunks)
                    console.warn(
                      'Error handler returned non-stream completion, continuing with original stream',
                    )
                  }
                }

                // Skip yielding this error chunk
                continue
              }
            }

            // Only yield good chunks
            yield chunk
          }
        } catch (e) {
          console.error('Error in stream processing:', e.message)
          // Rethrow to maintain error propagation
          throw e
        }
      })()
    }

    const response = await fetch(`${baseURL}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts),
      dispatcher: proxy,
    })

    logEvent('response.ok', {
      ok: String(response.ok),
      status: String(response.status),
      statusText: response.statusText,
    })

    if (!response.ok) {
      try {
        const error = (await response.json()) as {
          error?: { message: string }
          message?: string
        }
        return handleApiError(
          response,
          error,
          type,
          opts,
          config,
          attempt,
          maxAttempts,
        )
      } catch (jsonError) {
        // If we can't parse the error as JSON, use the status text
        return handleApiError(
          response,
          {
            error: {
              message: `HTTP error ${response.status}: ${response.statusText}`,
            },
          },
          type,
          opts,
          config,
          attempt,
          maxAttempts,
        )
      }
    }

    // Get the raw response data and check for errors even in OK responses
    const responseData = (await response.json()) as OpenAI.ChatCompletion

    // Check for error property in the successful response
    if (
      responseData &&
      typeof responseData === 'object' &&
      'error' in responseData
    ) {
      const errorValue = (responseData as any).error

      // Log the error
      logEvent('completion_error', {
        error:
          typeof errorValue === 'string'
            ? errorValue
            : JSON.stringify(errorValue),
      })

      // Handle the error
      return handleApiError(
        response,
        { error: errorValue },
        type,
        opts,
        config,
        attempt,
        maxAttempts,
      )
    }

    // Only reset failed keys if this key was previously marked as failed
    const failedKeys = getSessionState('failedApiKeys')[type]
    if (apiKey && failedKeys.includes(apiKey)) {
      setSessionState('failedApiKeys', {
        ...getSessionState('failedApiKeys'),
        [type]: failedKeys.filter(k => k !== apiKey),
      })
    }

    return responseData
  } catch (error) {
    // Handle network errors or other exceptions
    if (attempt < maxAttempts - 1) {
      const delay = Math.pow(2, attempt) * 1000
      await new Promise(resolve => setTimeout(resolve, delay))
      return getCompletion(type, opts, attempt + 1, maxAttempts)
    }
    throw new Error(`Network error: ${error.message || 'Unknown error'}`)
  }
}

export function createStreamProcessor(
  stream: any,
): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
  if (!stream) {
    throw new Error('Stream is null or undefined')
  }

  return (async function* () {
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        let readResult
        try {
          readResult = await reader.read()
        } catch (e) {
          console.error('Error reading from stream:', e)
          break
        }

        const { done, value } = readResult
        if (done) {
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk

        let lineEnd = buffer.indexOf('\n')
        while (lineEnd !== -1) {
          const line = buffer.substring(0, lineEnd).trim()
          buffer = buffer.substring(lineEnd + 1)

          if (line === 'data: [DONE]') {
            continue
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (!data) continue

            try {
              const parsed = JSON.parse(data) as OpenAI.ChatCompletionChunk
              yield parsed
            } catch (e) {
              console.error('Error parsing JSON:', data, e)
            }
          }

          lineEnd = buffer.indexOf('\n')
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        const lines = buffer.trim().split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            const data = line.slice(6).trim()
            if (!data) continue

            try {
              const parsed = JSON.parse(data) as OpenAI.ChatCompletionChunk
              yield parsed
            } catch (e) {
              console.error('Error parsing final JSON:', data, e)
            }
          }
        }
      }
    } catch (e) {
      console.error('Unexpected error in stream processing:', e)
    } finally {
      try {
        reader.releaseLock()
      } catch (e) {
        console.error('Error releasing reader lock:', e)
      }
    }
  })()
}

export function streamCompletion(
  stream: any,
): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
  return createStreamProcessor(stream)
}
