import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../utils/theme'
import { Select } from './CustomSelect/select'
import { Newline } from 'ink'
import { PRODUCT_NAME } from '../constants/product'
import { useExitOnCtrlCD } from '../hooks/useExitOnCtrlCD'
import {
  getGlobalConfig,
  saveGlobalConfig,
  addApiKey,
  ProviderType,
} from '../utils/config.js'
import models, { providers } from '../constants/models'
import TextInput from './TextInput'
import OpenAI from 'openai'
import chalk from 'chalk'
type Props = {
  onDone: () => void
  abortController?: AbortController
}

type ModelInfo = {
  model: string
  provider: string
  [key: string]: any
}

// Define model type options
type ModelTypeOption = 'both' | 'large' | 'small'

// Define reasoning effort options
type ReasoningEffortOption = 'low' | 'medium' | 'high'

// Custom hook to handle Escape key navigation
function useEscapeNavigation(
  onEscape: () => void,
  abortController?: AbortController,
) {
  // Use a ref to track if we've handled the escape key
  const handledRef = useRef(false)

  useInput(
    (input, key) => {
      if (key.escape && !handledRef.current) {
        handledRef.current = true
        // Reset after a short delay to allow for multiple escapes
        setTimeout(() => {
          handledRef.current = false
        }, 100)
        onEscape()
      }
    },
    { isActive: true },
  )
}

function printModelConfig() {
  const config = getGlobalConfig()
  let res = `  ⎿  ${config.largeModelName} | ${config.largeModelMaxTokens} ${config.largeModelReasoningEffort ? config.largeModelReasoningEffort : ''}`
  res += `  |  ${config.smallModelName} | ${config.smallModelMaxTokens} ${config.smallModelReasoningEffort ? config.smallModelReasoningEffort : ''}`
  console.log(chalk.gray(res))
}

export function ModelSelector({
  onDone: onDoneProp,
  abortController,
}: Props): React.ReactNode {
  const config = getGlobalConfig()
  const theme = getTheme()
  const onDone = () => {
    printModelConfig()
    onDoneProp()
  }
  // Initialize the exit hook but don't use it for Escape key
  const exitState = useExitOnCtrlCD(() => process.exit(0))

  // Screen navigation stack
  const [screenStack, setScreenStack] = useState<
    Array<
      | 'modelType'
      | 'provider'
      | 'apiKey'
      | 'resourceName'
      | 'baseUrl'
      | 'model'
      | 'modelInput'
      | 'modelParams'
      | 'confirmation'
    >
  >(['modelType'])

  // Current screen is always the last item in the stack
  const currentScreen = screenStack[screenStack.length - 1]

  // Function to navigate to a new screen
  const navigateTo = (
    screen:
      | 'modelType'
      | 'provider'
      | 'apiKey'
      | 'resourceName'
      | 'baseUrl'
      | 'model'
      | 'modelInput'
      | 'modelParams'
      | 'confirmation',
  ) => {
    setScreenStack(prev => [...prev, screen])
  }

  // Function to go back to the previous screen
  const goBack = () => {
    if (screenStack.length > 1) {
      // Remove the current screen from the stack
      setScreenStack(prev => prev.slice(0, -1))
    } else {
      // If we're at the first screen, call onDone to exit
      onDone()
    }
  }

  // State for model configuration
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(
    config.primaryProvider ?? 'anthropic',
  )
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [apiKey, setApiKey] = useState<string>('')

  // New state for model parameters
  const [maxTokens, setMaxTokens] = useState<string>(
    config.maxTokens?.toString() || '',
  )
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortOption>('medium')
  const [supportsReasoningEffort, setSupportsReasoningEffort] =
    useState<boolean>(false)

  // Form focus state
  const [activeFieldIndex, setActiveFieldIndex] = useState(0)
  const [maxTokensCursorOffset, setMaxTokensCursorOffset] = useState<number>(0)

  // UI state
  const [modelTypeToChange, setModelTypeToChange] =
    useState<ModelTypeOption>('both')

  // Search and model loading state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelLoadError, setModelLoadError] = useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState<string>('')
  const [modelSearchCursorOffset, setModelSearchCursorOffset] =
    useState<number>(0)
  const [cursorOffset, setCursorOffset] = useState<number>(0)
  const [apiKeyEdited, setApiKeyEdited] = useState<boolean>(false)

  // State for Azure-specific configuration
  const [resourceName, setResourceName] = useState<string>('')
  const [resourceNameCursorOffset, setResourceNameCursorOffset] =
    useState<number>(0)
  const [customModelName, setCustomModelName] = useState<string>('')
  const [customModelNameCursorOffset, setCustomModelNameCursorOffset] =
    useState<number>(0)

  // State for Ollama-specific configuration
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>(
    'http://localhost:11434/v1',
  )
  const [ollamaBaseUrlCursorOffset, setOllamaBaseUrlCursorOffset] =
    useState<number>(0)

  // 1. 新增 openaiCompatibleBaseUrl 状态
  const [openaiCompatibleBaseUrl, setOpenaiCompatibleBaseUrl] =
    useState<string>('')
  const [
    openaiCompatibleBaseUrlCursorOffset,
    setOpenaiCompatibleBaseUrlCursorOffset,
  ] = useState<number>(0)

  // Model type options
  const modelTypeOptions = [
    { label: '同时配置大模型和小模型', value: 'both' },
    { label: '仅配置大模型', value: 'large' },
    { label: '仅配置小模型', value: 'small' },
  ]

  // Reasoning effort options
  const reasoningEffortOptions = [
    { label: '低 - 响应更快，推理较少', value: 'low' },
    { label: '中 - 平衡速度与推理深度', value: 'medium' },
    {
      label: '高 - 响应较慢，推理更深入',
      value: 'high',
    },
  ]

  // Get available providers from models.ts
  const availableProviders = Object.keys(providers)

  // Create provider options with nice labels
  const providerOptions = availableProviders.map(provider => {
    const modelCount = models[provider]?.length || 0
    const label = getProviderLabel(provider, modelCount)
    return {
      label,
      value: provider,
    }
  })

  useEffect(() => {
    if (!apiKeyEdited && selectedProvider) {
      if (process.env[selectedProvider.toUpperCase() + '_API_KEY']) {
        setApiKey(
          process.env[selectedProvider.toUpperCase() + '_API_KEY'] as string,
        )
      } else {
        setApiKey('')
      }
    }
  }, [selectedProvider, apiKey, apiKeyEdited])

  // Create a set of model names from our constants/models.ts for the current provider
  const ourModelNames = new Set(
    (models[selectedProvider as keyof typeof models] || []).map(
      (model: any) => model.model,
    ),
  )

  // Create model options from available models, filtered by search query
  const filteredModels = modelSearchQuery
    ? availableModels.filter(model =>
        model.model.toLowerCase().includes(modelSearchQuery.toLowerCase()),
      )
    : availableModels

  const modelOptions = filteredModels.map(model => {
    // Check if this model is in our constants/models.ts list
    const isInOurModels = ourModelNames.has(model.model)

    return {
      label: `${model.model}${getModelDetails(model)}`,
      value: model.model,
    }
  })

  function getModelDetails(model: ModelInfo): string {
    const details = []

    if (model.max_tokens) {
      details.push(`${formatNumber(model.max_tokens)} tokens`)
    }

    if (model.supports_vision) {
      details.push('vision')
    }

    if (model.supports_function_calling) {
      details.push('tools')
    }

    return details.length > 0 ? ` (${details.join(', ')})` : ''
  }

  function formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}K`
    }
    return num.toString()
  }

  function getProviderLabel(provider: string, modelCount: number): string {
    // Use provider names from the providers object if available
    if (providers[provider]) {
      return `${providers[provider].name} ${providers[provider].status === 'wip' ? '(开发中)' : ''} (${modelCount} 个模型)`
    }
    return `${provider}`
  }

  function handleModelTypeSelection(type: string) {
    setModelTypeToChange(type as ModelTypeOption)
    navigateTo('provider')
  }

  function handleProviderSelection(provider: string) {
    const providerType = provider as ProviderType
    setSelectedProvider(providerType)

    if (provider === 'custom') {
      saveConfiguration(
        providerType,
        selectedModel || config.largeModelName || '',
      )
      onDone()
    } else if (provider === 'ollama') {
      navigateTo('baseUrl')
    } else if (provider === 'openai_compatible') {
      navigateTo('apiKey')
    } else {
      navigateTo('apiKey')
    }
  }

  async function fetchGeminiModels() {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(
          errorData.error?.message || `API error: ${response.status}`,
        )
      }

      const { models } = await response.json()

      const geminiModels = models
        .filter((model: any) =>
          model.supportedGenerationMethods.includes('generateContent'),
        )
        .map((model: any) => ({
          model: model.name.replace('models/', ''),
          provider: 'gemini',
          max_tokens: model.outputTokenLimit,
          supports_vision:
            model.supportedGenerationMethods.includes('generateContent'),
          supports_function_calling:
            model.supportedGenerationMethods.includes('generateContent'),
        }))

      return geminiModels
    } catch (error) {
      setModelLoadError(
        error instanceof Error ? error.message : 'Unknown error',
      )
      throw error
    }
  }

  async function fetchOllamaModels() {
    try {
      const response = await fetch(`${ollamaBaseUrl}/models`)

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
      }

      const responseData = await response.json()

      // Properly handle Ollama API response format
      // Ollama API can return models in different formats based on version
      let models = []

      // Check if data field exists (newer Ollama versions)
      if (responseData.data && Array.isArray(responseData.data)) {
        models = responseData.data
      }
      // Check if models array is directly at the root (older Ollama versions)
      else if (Array.isArray(responseData.models)) {
        models = responseData.models
      }
      // If response is already an array
      else if (Array.isArray(responseData)) {
        models = responseData
      } else {
        throw new Error(
          'Invalid response from Ollama API: missing models array',
        )
      }

      // Transform Ollama models to our format
      const ollamaModels = models.map((model: any) => ({
        model:
          model.name ?? model.id ?? (typeof model === 'string' ? model : ''),
        provider: 'ollama',
        max_tokens: 4096, // Default value
        supports_vision: false,
        supports_function_calling: true,
        supports_reasoning_effort: false,
      }))

      // Filter out models with empty names
      const validModels = ollamaModels.filter(model => model.model)

      setAvailableModels(validModels)

      // Only navigate if we have models
      if (validModels.length > 0) {
        navigateTo('model')
      } else {
        setModelLoadError('No models found in your Ollama installation')
      }

      return validModels
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      if (errorMessage.includes('fetch')) {
        setModelLoadError(
          `Could not connect to Ollama server at ${ollamaBaseUrl}. Make sure Ollama is running and the URL is correct.`,
        )
      } else {
        setModelLoadError(`Error loading Ollama models: ${errorMessage}`)
      }

      console.error('Error fetching Ollama models:', error)
      return []
    }
  }

  async function fetchModels() {
    setIsLoadingModels(true)
    setModelLoadError(null)

    try {
      // For Gemini, use the separate fetchGeminiModels function
      if (selectedProvider === 'gemini') {
        const geminiModels = await fetchGeminiModels()
        setAvailableModels(geminiModels)
        navigateTo('model')
        return geminiModels
      }

      // For Azure, skip model fetching and go directly to model input
      if (selectedProvider === 'azure') {
        navigateTo('modelInput')
        return []
      }

      if (selectedProvider === 'openai_compatible') {
        navigateTo('baseUrl')
        return []
      }

      // For all other providers, use the OpenAI client
      const baseURL = providers[selectedProvider]?.baseURL

      const openai = new OpenAI({
        apiKey: apiKey || 'dummy-key-for-ollama', // Ollama doesn't need a real key
        baseURL: baseURL,
        dangerouslyAllowBrowser: true,
      })

      // Fetch the models
      const response = await openai.models.list()

      // Transform the response into our ModelInfo format
      const fetchedModels = []
      for (const model of response.data) {
        const modelInfo = models[selectedProvider as keyof typeof models]?.find(
          m => m.model === model.id,
        )
        fetchedModels.push({
          model: model.id,
          provider: selectedProvider,
          max_tokens: modelInfo?.max_output_tokens,
          supports_vision: modelInfo?.supports_vision || false,
          supports_function_calling:
            modelInfo?.supports_function_calling || false,
          supports_reasoning_effort:
            modelInfo?.supports_reasoning_effort || false,
        })
      }

      setAvailableModels(fetchedModels)

      // Navigate to model selection screen if models were loaded successfully
      navigateTo('model')

      return fetchedModels
    } catch (error) {
      // Properly display the error to the user
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      setModelLoadError(`Failed to load models: ${errorMessage}`)

      // For Ollama specifically, show more helpful guidance
      if (
        selectedProvider === 'ollama' &&
        errorMessage.includes('ECONNREFUSED')
      ) {
        setModelLoadError(
          `Could not connect to Ollama server at ${ollamaBaseUrl}. Make sure Ollama is running and the URL is correct.`,
        )
      }

      // Log for debugging, but errors are now shown in UI
      console.error('Error fetching models:', error)

      // Stay on the current screen when there's an error
      return []
    } finally {
      setIsLoadingModels(false)
    }
  }

  function handleApiKeySubmit(key: string) {
    setApiKey(key)

    // For Azure, go to resource name input next
    if (selectedProvider === 'azure') {
      navigateTo('resourceName')
      return
    }

    // For openai_compatible, go to baseUrl input next
    if (selectedProvider === 'openai_compatible') {
      navigateTo('baseUrl')
      return
    }

    // Fetch models with the provided API key
    fetchModels().catch(error => {
      setModelLoadError(`Error loading models: ${error.message}`)
    })
  }

  function handleResourceNameSubmit(name: string) {
    setResourceName(name)
    navigateTo('modelInput')
  }

  function handleOllamaBaseUrlSubmit(url: string) {
    setOllamaBaseUrl(url)
    setIsLoadingModels(true)
    setModelLoadError(null)

    // Use the dedicated Ollama model fetch function
    fetchOllamaModels().finally(() => {
      setIsLoadingModels(false)
    })
  }

  function handleCustomModelSubmit(model: string) {
    setCustomModelName(model)
    setSelectedModel(model)

    // No model info available, so set default values
    setSupportsReasoningEffort(false)
    setReasoningEffort(null)

    // Use the global config value or empty string for max tokens
    setMaxTokens(config.maxTokens?.toString() || '')
    setMaxTokensCursorOffset(config.maxTokens?.toString().length || 0)

    // Go to model parameters screen
    navigateTo('modelParams')
    // Reset active field index
    setActiveFieldIndex(0)
  }

  // 2. 新增模型选择和参数流程状态
  const [modelSelectionStep, setModelSelectionStep] = useState<
    'large' | 'small' | 'done'
  >('large')

  // 3. 进入模型选择时根据 modelTypeToChange 控制流程
  function handleModelSelection(model: string) {
    setSelectedModel(model)

    // Check if the selected model supports reasoning_effort
    const modelInfo = availableModels.find(m => m.model === model)
    setSupportsReasoningEffort(modelInfo?.supports_reasoning_effort || false)

    if (!modelInfo?.supports_reasoning_effort) {
      setReasoningEffort(null)
    }

    // Prepopulate max tokens with the model's default value if available
    if (modelInfo?.max_tokens) {
      setMaxTokens(modelInfo.max_tokens.toString())
      setMaxTokensCursorOffset(modelInfo.max_tokens.toString().length)
    } else {
      // If no model-specific max tokens, use the global config value or empty string
      setMaxTokens(config.maxTokens?.toString() || '')
      setMaxTokensCursorOffset(config.maxTokens?.toString().length || 0)
    }

    // Go to model parameters screen
    navigateTo('modelParams')
    // Reset active field index
    setActiveFieldIndex(0)
  }

  // 4. 参数设置提交时根据 modelTypeToChange 控制流程
  const handleModelParamsSubmit = () => {
    // 保存当前 step 的模型和参数
    if (modelTypeToChange === 'both') {
      if (modelSelectionStep === 'large') {
        // 保存大模型配置
        setLargeModelTemp({
          model: selectedModel,
          maxTokens,
          reasoningEffort,
        })
        // 进入小模型选择
        setModelSelectionStep('small')
        setSelectedModel('')
        setMaxTokens('')
        setReasoningEffort('medium')
        setSupportsReasoningEffort(false)
        navigateTo('model')
        return
      } else if (modelSelectionStep === 'small') {
        // 保存小模型配置
        setSmallModelTemp({
          model: selectedModel,
          maxTokens,
          reasoningEffort,
        })
        setModelSelectionStep('done')
        navigateTo('confirmation')
        return
      }
    } else {
      // large 或 small 只需一次
      navigateTo('confirmation')
    }
  }

  // 5. 新增临时状态保存 large/small 配置
  const [largeModelTemp, setLargeModelTemp] = useState<any>(null)
  const [smallModelTemp, setSmallModelTemp] = useState<any>(null)

  function saveConfiguration(provider: ProviderType, model: string) {
    let baseURL = providers[provider]?.baseURL || ''
    if (provider === 'azure') {
      baseURL = `https://${resourceName}.openai.azure.com/openai/deployments/${model}`
    } else if (provider === 'ollama') {
      baseURL = ollamaBaseUrl
    } else if (provider === 'openai_compatible') {
      baseURL = openaiCompatibleBaseUrl
    }
    const newConfig = { ...config }
    newConfig.primaryProvider = provider

    // Determine if the provider requires an API key
    const requiresApiKey = provider !== 'ollama'

    // Update the appropriate model based on the selection
    if (modelTypeToChange === 'both' || modelTypeToChange === 'large') {
      newConfig.largeModelName = model
      newConfig.largeModelBaseURL = baseURL
      if (apiKey && requiresApiKey) {
        newConfig.largeModelApiKeys = [apiKey]
      }
      if (maxTokens) {
        newConfig.largeModelMaxTokens = parseInt(maxTokens)
      }
      if (reasoningEffort) {
        newConfig.largeModelReasoningEffort = reasoningEffort
      } else {
        newConfig.largeModelReasoningEffort = undefined
      }
      newConfig.largeModelApiKeyRequired = requiresApiKey
    }

    if (modelTypeToChange === 'both' || modelTypeToChange === 'small') {
      newConfig.smallModelName = model
      newConfig.smallModelBaseURL = baseURL
      if (apiKey && requiresApiKey) {
        newConfig.smallModelApiKeys = [apiKey]
      }
      if (maxTokens) {
        newConfig.smallModelMaxTokens = parseInt(maxTokens)
      }
      if (reasoningEffort) {
        newConfig.smallModelReasoningEffort = reasoningEffort
      } else {
        newConfig.smallModelReasoningEffort = undefined
      }
      newConfig.smallModelApiKeyRequired = requiresApiKey
    }
    saveGlobalConfig(newConfig)
  }

  function handleConfirmation() {
    // Save the configuration and exit
    saveConfiguration(selectedProvider, selectedModel)
    onDone()
  }

  // Handle back navigation based on current screen
  const handleBack = () => {
    if (currentScreen === 'modelType') {
      // If we're at the first screen, call onDone to exit
      onDone()
    } else {
      // Remove the current screen from the stack
      setScreenStack(prev => prev.slice(0, -1))
    }
  }

  // Use escape navigation hook
  useEscapeNavigation(handleBack, abortController)

  // Handle cursor offset changes
  function handleCursorOffsetChange(offset: number) {
    setCursorOffset(offset)
  }

  // Handle API key changes
  function handleApiKeyChange(value: string) {
    setApiKeyEdited(true)
    setApiKey(value)
  }

  // Handle model search query changes
  function handleModelSearchChange(value: string) {
    setModelSearchQuery(value)
    // Update cursor position to end of text when typing
    setModelSearchCursorOffset(value.length)
  }

  // Handle model search cursor offset changes
  function handleModelSearchCursorOffsetChange(offset: number) {
    setModelSearchCursorOffset(offset)
  }

  // Handle input for Resource Name screen
  useInput((input, key) => {
    // Handle API key submission on Enter
    if (currentScreen === 'apiKey' && key.return) {
      if (apiKey) {
        handleApiKeySubmit(apiKey)
      }
      return
    }

    if (currentScreen === 'apiKey' && key.tab) {
      // Skip API key input and fetch models
      fetchModels().catch(error => {
        setModelLoadError(`Error loading models: ${error.message}`)
      })
      return
    }

    // Handle Resource Name submission on Enter
    if (currentScreen === 'resourceName' && key.return) {
      if (resourceName) {
        handleResourceNameSubmit(resourceName)
      }
      return
    }

    // Handle Ollama Base URL submission on Enter
    if (currentScreen === 'baseUrl' && key.return) {
      handleOllamaBaseUrlSubmit(ollamaBaseUrl)
      return
    }

    // Handle Custom Model Name submission on Enter
    if (currentScreen === 'modelInput' && key.return) {
      if (customModelName) {
        handleCustomModelSubmit(customModelName)
      }
      return
    }

    // Handle confirmation on Enter
    if (currentScreen === 'confirmation' && key.return) {
      handleConfirmation()
      return
    }

    // Handle paste event (Ctrl+V or Cmd+V)
    if (
      currentScreen === 'apiKey' &&
      ((key.ctrl && input === 'v') || (key.meta && input === 'v'))
    ) {
      // We can't directly access clipboard in terminal, but we can show a message
      setModelLoadError(
        "Please use your terminal's paste functionality or type the API key manually",
      )
      return
    }

    // Handle Tab key for form navigation in model params screen
    if (currentScreen === 'modelParams' && key.tab) {
      const formFields = getFormFieldsForModelParams()
      // Move to next field
      setActiveFieldIndex(current => (current + 1) % formFields.length)
      return
    }

    // Handle Enter key for form submission in model params screen
    if (currentScreen === 'modelParams' && key.return) {
      const formFields = getFormFieldsForModelParams()

      if (activeFieldIndex === formFields.length - 1) {
        // If on the Continue button, submit the form
        handleModelParamsSubmit()
      }
      return
    }
  })

  // Helper function to get form fields for model params
  function getFormFieldsForModelParams() {
    return [
      {
        name: 'maxTokens',
        label: 'Maximum Tokens',
        description: 'Maximum tokens in response. Empty = default.',
        placeholder: 'Default',
        value: maxTokens,
        component: 'textInput',
        componentProps: {
          columns: 10,
        },
      },
      ...(supportsReasoningEffort
        ? [
            {
              name: 'reasoningEffort',
              label: 'Reasoning Effort',
              description: 'Controls reasoning depth for complex problems.',
              value: reasoningEffort,
              component: 'select',
            },
          ]
        : []),
      {
        name: 'submit',
        label: 'Continue →',
        component: 'button',
      },
    ]
  }

  // 2. 新增 handleOpenaiCompatibleBaseUrlSubmit
  function handleOpenaiCompatibleBaseUrlSubmit(url: string) {
    setOpenaiCompatibleBaseUrl(url)
    setIsLoadingModels(true)
    setModelLoadError(null)

    // 用 openai_compatible baseURL 拉取 models
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: url,
      dangerouslyAllowBrowser: true,
    })
    openai.models
      .list()
      .then(response => {
        const fetchedModels = response.data.map((model: any) => ({
          model: model.id,
          provider: 'openai_compatible',
          max_tokens: model?.max_tokens,
          supports_vision: false,
          supports_function_calling: true,
          supports_reasoning_effort: false,
        }))
        setAvailableModels(fetchedModels)
        if (fetchedModels.length > 0) {
          navigateTo('model')
        } else {
          setModelLoadError('未在该 baseURL 下发现可用模型')
        }
      })
      .catch(error => {
        setModelLoadError('拉取模型失败: ' + (error?.message || error))
      })
      .finally(() => setIsLoadingModels(false))
  }

  // Render Model Type Selection Screen
  if (currentScreen === 'modelType') {
    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            模型选择{' '}
            {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>你想要配置哪些模型？</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                你可以将大模型和小模型配置为相同，也可以分别设置。
                <Newline />
                • 大模型：用于需要完整能力的复杂任务
                <Newline />• 小模型：用于简单任务以节省成本并提升响应速度
              </Text>
            </Box>

            <Select
              options={modelTypeOptions}
              onChange={handleModelTypeSelection}
            />

            <Box marginTop={1}>
              <Text dimColor>
                当前配置：
                <Newline />• 大模型:{' '}
                <Text color={theme.suggestion}>
                  {config.largeModelName || '未设置'}
                </Text>
                {config.largeModelName && (
                  <Text dimColor>
                    {' '}
                    （
                    {providers[config.primaryProvider]?.name ||
                      config.primaryProvider}
                    ）
                  </Text>
                )}
                <Newline />• 小模型:{' '}
                <Text color={theme.suggestion}>
                  {config.smallModelName || '未设置'}
                </Text>
                {config.smallModelName && (
                  <Text dimColor>
                    {' '}
                    （
                    {providers[config.primaryProvider]?.name ||
                      config.primaryProvider}
                    ）
                  </Text>
                )}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render API Key Input Screen
  if (currentScreen === 'apiKey') {
    const modelTypeText =
      modelTypeToChange === 'both'
        ? '两个模型'
        : `你的${modelTypeToChange === 'large' ? '大模型' : '小模型'}`

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            API Key 设置{' '}
            {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>
              请输入{getProviderLabel(selectedProvider, 0).split(' (')[0]}的API
              Key，用于{modelTypeText}：
            </Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                此密钥将被本地保存，用于访问{selectedProvider} API。
                <Newline />
                你的密钥不会被上传到我们的服务器。
                {selectedProvider === 'openai_compatible' && (
                  <>
                    <Newline />
                    如果你的服务不需要 API Key，可以随意输入一个占位值（如
                    "none"）。
                  </>
                )}
              </Text>
            </Box>

            <Box>
              <TextInput
                placeholder="sk-..."
                value={apiKey}
                onChange={handleApiKeyChange}
                onSubmit={handleApiKeySubmit}
                mask="*"
                columns={100}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={handleCursorOffsetChange}
                showCursor={true}
              />
            </Box>

            <Box marginTop={1}>
              <Text>
                <Text color={theme.suggestion} dimColor={!apiKey}>
                  [提交 API Key]
                </Text>
                <Text> - 按回车或点击以继续</Text>
              </Text>
            </Box>

            {isLoadingModels && (
              <Box>
                <Text color={theme.suggestion}>正在加载可用模型...</Text>
              </Box>
            )}
            {modelLoadError && (
              <Box>
                <Text color="red">错误: {modelLoadError}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>
                按 <Text color={theme.suggestion}>回车</Text> 继续，
                <Text color={theme.suggestion}>Tab</Text> 跳过密钥，或
                <Text color={theme.suggestion}>Esc</Text> 返回
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render Model Selection Screen
  if (currentScreen === 'model') {
    const modelTypeText =
      modelTypeToChange === 'both'
        ? '大模型和小模型'
        : `你的${modelTypeToChange === 'large' ? '大模型' : '小模型'}`

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            模型选择{' '}
            {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
          </Text>
          {modelTypeToChange === 'both' && (
            <Text color={theme.suggestion}>
              {modelSelectionStep === 'large'
                ? '正在设置 1大模型（用于复杂任务）'
                : modelSelectionStep === 'small'
                  ? '正在设置1小模型（用于简单任务）'
                  : ''}
            </Text>
          )}
          <Box flexDirection="column" gap={1}>
            <Text bold>
              请选择
              {
                getProviderLabel(
                  selectedProvider,
                  availableModels.length,
                ).split(' (')[0]
              }
              的模型，用于{modelTypeText}：
            </Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                {modelTypeToChange === 'both' ? (
                  <>此模型将同时用于主要交互和简单任务。</>
                ) : modelTypeToChange === 'large' ? (
                  <>此模型将用于需要完整能力的复杂任务。</>
                ) : (
                  <>此模型将用于简单任务以节省成本并提升响应速度。</>
                )}
              </Text>
            </Box>

            <Box marginY={1}>
              {modelTypeToChange === 'both' && (
                <Text color={theme.suggestion}>
                  {modelSelectionStep === 'large'
                    ? '正在设置大模型（用于复杂任务）'
                    : modelSelectionStep === 'small'
                      ? '正在设置小模型（用于简单任务）'
                      : ''}
                  <Newline />
                </Text>
              )}
              <Text bold>搜索模型：</Text>
              <TextInput
                placeholder="输入以筛选模型..."
                value={modelSearchQuery}
                onChange={handleModelSearchChange}
                columns={100}
                cursorOffset={modelSearchCursorOffset}
                onChangeCursorOffset={handleModelSearchCursorOffsetChange}
                showCursor={true}
                focus={true}
              />
            </Box>

            {modelOptions.length > 0 ? (
              <>
                <Select
                  options={modelOptions}
                  onChange={handleModelSelection}
                />
                <Text dimColor>
                  显示 {modelOptions.length} / {availableModels.length} 个模型
                </Text>
              </>
            ) : (
              <Box>
                {availableModels.length > 0 ? (
                  <Text color="yellow">没有匹配的模型，请尝试其他关键词。</Text>
                ) : (
                  <Text color="yellow">当前提供商无可用模型。</Text>
                )}
              </Box>
            )}

            <Box marginTop={1}>
              <Text dimColor>
                按 <Text color={theme.suggestion}>Esc</Text> 返回
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  if (currentScreen === 'modelParams') {
    // Define form fields
    const formFields = getFormFieldsForModelParams()

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            模型参数{' '}
            {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>为 {selectedModel} 配置参数：</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                使用 <Text color={theme.suggestion}>Tab</Text> 切换字段，按
                <Text color={theme.suggestion}>回车</Text> 提交。
              </Text>
            </Box>

            <Box flexDirection="column">
              {formFields.map((field, index) => (
                <Box flexDirection="column" marginY={1} key={field.name}>
                  {field.component !== 'button' ? (
                    <>
                      <Text
                        bold
                        color={
                          activeFieldIndex === index ? theme.success : undefined
                        }
                      >
                        {field.label === 'Maximum Tokens'
                          ? '最大 Token 数'
                          : field.label === 'Reasoning Effort'
                            ? '推理深度'
                            : field.label}
                      </Text>
                      {field.description && (
                        <Text color={theme.secondaryText}>
                          {field.description ===
                          'Maximum tokens in response. Empty = default.'
                            ? '回复的最大 token 数。留空为默认。'
                            : field.description ===
                                'Controls reasoning depth for complex problems.'
                              ? '控制复杂问题的推理深度。'
                              : field.description}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text
                      bold
                      color={
                        activeFieldIndex === index ? theme.success : undefined
                      }
                    >
                      {field.label === 'Continue →' ? '继续 →' : field.label}
                    </Text>
                  )}
                  <Box marginY={1}>
                    {activeFieldIndex === index ? (
                      field.component === 'textInput' ? (
                        <TextInput
                          value={maxTokens}
                          onChange={value => setMaxTokens(value)}
                          placeholder={
                            field.placeholder === 'Default'
                              ? '默认'
                              : field.placeholder
                          }
                          columns={field.componentProps?.columns || 50}
                          showCursor={true}
                          focus={true}
                          cursorOffset={maxTokensCursorOffset}
                          onChangeCursorOffset={setMaxTokensCursorOffset}
                          onSubmit={() => {
                            if (index === formFields.length - 1) {
                              handleModelParamsSubmit()
                            } else {
                              setActiveFieldIndex(index + 1)
                            }
                          }}
                        />
                      ) : field.component === 'select' ? (
                        <Select
                          options={reasoningEffortOptions}
                          onChange={value => {
                            setReasoningEffort(value as ReasoningEffortOption)
                            // Move to next field after selection
                            setTimeout(() => {
                              setActiveFieldIndex(index + 1)
                            }, 100)
                          }}
                          defaultValue={reasoningEffort}
                        />
                      ) : null
                    ) : field.name === 'maxTokens' ? (
                      <Text color={theme.secondaryText}>
                        当前：
                        <Text color={theme.suggestion}>
                          {maxTokens || '默认'}
                        </Text>
                      </Text>
                    ) : field.name === 'reasoningEffort' ? (
                      <Text color={theme.secondaryText}>
                        当前：
                        <Text color={theme.suggestion}>{reasoningEffort}</Text>
                      </Text>
                    ) : null}
                  </Box>
                </Box>
              ))}

              <Box marginTop={1}>
                <Text dimColor>
                  按 <Text color={theme.suggestion}>Tab</Text> 切换，
                  <Text color={theme.suggestion}>回车</Text> 继续，或
                  <Text color={theme.suggestion}>Esc</Text> 返回
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render Resource Name Input Screen
  if (currentScreen === 'resourceName') {
    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            Azure 资源设置{' '}
            {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>请输入你的 Azure OpenAI 资源名称：</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                这是你的 Azure OpenAI 资源名称（不含完整域名）。
                <Newline />
                例如，如果你的端点是
                "https://myresource.openai.azure.com"，请输入 "myresource"。
              </Text>
            </Box>

            <Box>
              <TextInput
                placeholder="myazureresource"
                value={resourceName}
                onChange={setResourceName}
                onSubmit={handleResourceNameSubmit}
                columns={100}
                cursorOffset={resourceNameCursorOffset}
                onChangeCursorOffset={setResourceNameCursorOffset}
                showCursor={true}
              />
            </Box>

            <Box marginTop={1}>
              <Text>
                <Text color={theme.suggestion} dimColor={!resourceName}>
                  [提交资源名称]
                </Text>
                <Text> - 按回车或点击以继续</Text>
              </Text>
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                按 <Text color={theme.suggestion}>回车</Text> 继续，或
                <Text color={theme.suggestion}>Esc</Text> 返回
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render Ollama Base URL Input Screen
  if (currentScreen === 'baseUrl') {
    if (selectedProvider === 'ollama') {
      return (
        <Box flexDirection="column" gap={1}>
          <Box
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderColor={theme.secondaryBorder}
            paddingX={2}
            paddingY={1}
          >
            <Text bold>
              Ollama 服务器设置{' '}
              {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
            </Text>
            <Box flexDirection="column" gap={1}>
              <Text bold>请输入你的 Ollama 服务器地址：</Text>
              <Box flexDirection="column" width={70}>
                <Text color={theme.secondaryText}>
                  这是你的 Ollama 服务器的地址。
                  <Newline />
                  本地 Ollama 默认地址为 http://localhost:11434/v1。
                </Text>
              </Box>

              <Box>
                <TextInput
                  placeholder="http://localhost:11434/v1"
                  value={ollamaBaseUrl}
                  onChange={setOllamaBaseUrl}
                  onSubmit={handleOllamaBaseUrlSubmit}
                  columns={100}
                  cursorOffset={ollamaBaseUrlCursorOffset}
                  onChangeCursorOffset={setOllamaBaseUrlCursorOffset}
                  showCursor={!isLoadingModels}
                  focus={!isLoadingModels}
                />
              </Box>

              <Box marginTop={1}>
                <Text>
                  <Text
                    color={
                      isLoadingModels ? theme.secondaryText : theme.suggestion
                    }
                  >
                    [提交服务器地址]
                  </Text>
                  <Text> - 按回车或点击以继续</Text>
                </Text>
              </Box>

              {isLoadingModels && (
                <Box marginTop={1}>
                  <Text color={theme.success}>正在连接 Ollama 服务器...</Text>
                </Box>
              )}

              {modelLoadError && (
                <Box marginTop={1}>
                  <Text color="red">错误: {modelLoadError}</Text>
                </Box>
              )}

              <Box marginTop={1}>
                <Text dimColor>
                  按 <Text color={theme.suggestion}>回车</Text> 继续，或
                  <Text color={theme.suggestion}>Esc</Text> 返回
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      )
    } else if (selectedProvider === 'openai_compatible') {
      return (
        <Box flexDirection="column" gap={1}>
          <Box
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderColor={theme.secondaryBorder}
            paddingX={2}
            paddingY={1}
          >
            <Text bold>
              OpenAI 兼容 API 设置{' '}
              {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
            </Text>
            <Box flexDirection="column" gap={1}>
              <Text bold>请输入你的 OpenAI 兼容 API baseURL：</Text>
              <Box flexDirection="column" width={70}>
                <Text color={theme.secondaryText}>
                  这是你的 one-api/new-api 兼容服务的 baseURL，例如
                  http://localhost:3000/v1。
                  <Newline />
                  需确保该地址可用且已配置 API Key。
                </Text>
              </Box>
              <Box>
                <TextInput
                  placeholder="http://localhost:3000/v1"
                  value={openaiCompatibleBaseUrl}
                  onChange={setOpenaiCompatibleBaseUrl}
                  onSubmit={handleOpenaiCompatibleBaseUrlSubmit}
                  columns={100}
                  cursorOffset={openaiCompatibleBaseUrlCursorOffset}
                  onChangeCursorOffset={setOpenaiCompatibleBaseUrlCursorOffset}
                  showCursor={!isLoadingModels}
                  focus={!isLoadingModels}
                />
              </Box>
              <Box marginTop={1}>
                <Text>
                  <Text
                    color={
                      isLoadingModels ? theme.secondaryText : theme.suggestion
                    }
                  >
                    [提交 baseURL]
                  </Text>
                  <Text> - 按回车或点击以继续</Text>
                </Text>
              </Box>
              {isLoadingModels && (
                <Box marginTop={1}>
                  <Text color={theme.success}>正在连接 OpenAI 兼容 API...</Text>
                </Box>
              )}
              {modelLoadError && (
                <Box marginTop={1}>
                  <Text color="red">错误: {modelLoadError}</Text>
                </Box>
              )}
              <Box marginTop={1}>
                <Text dimColor>
                  按 <Text color={theme.suggestion}>回车</Text> 继续，或
                  <Text color={theme.suggestion}>Esc</Text> 返回
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      )
    }
  }

  // Render Custom Model Input Screen
  if (currentScreen === 'modelInput') {
    const modelTypeText =
      modelTypeToChange === 'both'
        ? '大模型和小模型'
        : `你的${modelTypeToChange === 'large' ? '大模型' : '小模型'}`

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            Azure 模型设置{' '}
            {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>
              请输入 Azure OpenAI 部署名称，用于{modelTypeText}：
            </Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                这是你在 Azure OpenAI 资源中配置的部署名称。
                <Newline />
                例如："gpt-4"、"gpt-35-turbo" 等。
              </Text>
            </Box>

            <Box>
              <TextInput
                placeholder="gpt-4"
                value={customModelName}
                onChange={setCustomModelName}
                onSubmit={handleCustomModelSubmit}
                columns={100}
                cursorOffset={customModelNameCursorOffset}
                onChangeCursorOffset={setCustomModelNameCursorOffset}
                showCursor={true}
              />
            </Box>

            <Box marginTop={1}>
              <Text>
                <Text color={theme.suggestion} dimColor={!customModelName}>
                  [提交模型名称]
                </Text>
                <Text> - 按回车或点击以继续</Text>
              </Text>
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                按 <Text color={theme.suggestion}>回车</Text> 继续，或
                <Text color={theme.suggestion}>Esc</Text> 返回
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render Confirmation Screen
  if (currentScreen === 'confirmation') {
    // Determine what will be updated
    const updatingLarge =
      modelTypeToChange === 'both' || modelTypeToChange === 'large'
    const updatingSmall =
      modelTypeToChange === 'both' || modelTypeToChange === 'small'

    // Get provider display name
    const providerDisplayName = getProviderLabel(selectedProvider, 0).split(
      ' (',
    )[0]

    // Determine if provider requires API key
    const showsApiKey =
      selectedProvider !== 'ollama' && selectedProvider !== 'openai_compatible'

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            配置确认{' '}
            {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>请确认你的模型配置：</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>请在保存前检查你的选择。</Text>
            </Box>

            <Box flexDirection="column" marginY={1} paddingX={1}>
              <Text>
                <Text bold>提供商: </Text>
                <Text color={theme.suggestion}>{providerDisplayName}</Text>
              </Text>

              {selectedProvider === 'azure' && (
                <Text>
                  <Text bold>资源名称: </Text>
                  <Text color={theme.suggestion}>{resourceName}</Text>
                </Text>
              )}

              {selectedProvider === 'ollama' && (
                <Text>
                  <Text bold>服务器地址: </Text>
                  <Text color={theme.suggestion}>{ollamaBaseUrl}</Text>
                </Text>
              )}

              {selectedProvider === 'openai_compatible' && (
                <Text>
                  <Text bold>baseURL: </Text>
                  <Text color={theme.suggestion}>
                    {openaiCompatibleBaseUrl}
                  </Text>
                </Text>
              )}

              {modelTypeToChange === 'both' && largeModelTemp && (
                <Text>
                  <Text bold>大模型: </Text>
                  <Text color={theme.suggestion}>{largeModelTemp.model}</Text>
                  <Text dimColor>（用于复杂任务）</Text>
                </Text>
              )}

              {modelTypeToChange === 'both' && smallModelTemp && (
                <Text>
                  <Text bold>小模型: </Text>
                  <Text color={theme.suggestion}>{smallModelTemp.model}</Text>
                  <Text dimColor>（用于简单任务）</Text>
                </Text>
              )}

              {apiKey && showsApiKey && (
                <Text>
                  <Text bold>API Key: </Text>
                  <Text color={theme.suggestion}>****{apiKey.slice(-4)}</Text>
                </Text>
              )}

              {maxTokens && (
                <Text>
                  <Text bold>最大 Token 数: </Text>
                  <Text color={theme.suggestion}>{maxTokens}</Text>
                </Text>
              )}

              {supportsReasoningEffort && (
                <Text>
                  <Text bold>推理深度: </Text>
                  <Text color={theme.suggestion}>{reasoningEffort}</Text>
                </Text>
              )}
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                按 <Text color={theme.suggestion}>Esc</Text> 返回模型参数，或
                <Text color={theme.suggestion}>回车</Text> 保存配置
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render Provider Selection Screen
  return (
    <Box flexDirection="column" gap={1}>
      <Box
        flexDirection="column"
        gap={1}
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={2}
        paddingY={1}
      >
        <Text bold>
          提供商选择{' '}
          {exitState.pending ? `（再次按下${exitState.keyName}退出）` : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>
            请选择你想要用于
            {modelTypeToChange === 'both'
              ? '两个模型'
              : `你的${modelTypeToChange === 'large' ? '大模型' : '小模型'}`}
            的 AI 提供商：
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              选择你想要用于
              {modelTypeToChange === 'both'
                ? '大模型和小模型'
                : `你的${modelTypeToChange === 'large' ? '大模型' : '小模型'}`}
              的提供商。
              <Newline />
              这将决定你可用的模型列表。
            </Text>
          </Box>

          <Select
            options={providerOptions}
            onChange={handleProviderSelection}
          />

          <Box marginTop={1}>
            <Text dimColor>
              你可以稍后通过运行 <Text color={theme.suggestion}>/model</Text>{' '}
              再次更改
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
