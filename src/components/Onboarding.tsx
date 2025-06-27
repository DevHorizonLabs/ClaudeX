import React, { useState } from 'react'
import { PRODUCT_NAME } from '../constants/product'
import { Box, Newline, Text, useInput } from 'ink'
import {
  getGlobalConfig,
  saveGlobalConfig,
  DEFAULT_GLOBAL_CONFIG,
  ProviderType,
} from '../utils/config.js'
import { OrderedList } from '@inkjs/ui'
import { useExitOnCtrlCD } from '../hooks/useExitOnCtrlCD'
import { MIN_LOGO_WIDTH } from './Logo'
import { Select } from './CustomSelect/select'
import { StructuredDiff } from './StructuredDiff'
import { getTheme, type ThemeNames } from '../utils/theme'
import { clearTerminal } from '../utils/terminal'
import { PressEnterToContinue } from './PressEnterToContinue'
import { ModelSelector } from './ModelSelector'
type StepId = 'theme' | 'usage' | 'providers' | 'model'

interface OnboardingStep {
  id: StepId
  component: React.ReactNode
}

type Props = {
  onDone(): void
}

export function Onboarding({ onDone }: Props): React.ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const config = getGlobalConfig()

  const [selectedTheme, setSelectedTheme] = useState(
    DEFAULT_GLOBAL_CONFIG.theme,
  )
  const theme = getTheme()
  function goToNextStep() {
    if (currentStepIndex < steps.length - 1) {
      const nextIndex = currentStepIndex + 1
      setCurrentStepIndex(nextIndex)
    }
  }

  function handleThemeSelection(newTheme: string) {
    saveGlobalConfig({
      ...config,
      theme: newTheme as ThemeNames,
    })
    goToNextStep()
  }

  function handleThemePreview(newTheme: string) {
    setSelectedTheme(newTheme as ThemeNames)
  }

  function handleProviderSelectionDone() {
    // After model selection is done, go to the next step
    goToNextStep()
  }

  function handleModelSelectionDone() {
    // After final model selection is done, complete onboarding
    onDone()
  }

  const exitState = useExitOnCtrlCD(() => process.exit(0))

  useInput(async (_, key) => {
    const currentStep = steps[currentStepIndex]
    if (
      key.return &&
      currentStep &&
      ['usage', 'providers', 'model'].includes(currentStep.id)
    ) {
      if (currentStep.id === 'model') {
        // Navigate to ModelSelector component
        setShowModelSelector(true)
      } else if (currentStepIndex === steps.length - 1) {
        onDone()
      } else {
        // HACK: for some reason there's now a jump here otherwise :(
        await clearTerminal()
        goToNextStep()
      }
    }
  })

  // Define all onboarding steps
  const themeStep = (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text>让我们开始吧。</Text>
      <Box flexDirection="column">
        <Text bold>选择您选中时看起来最好的选项：</Text>
        <Text dimColor>要稍后更改此设置，请运行 /config</Text>
      </Box>
      <Select
        options={[
          { label: '浅色文本', value: 'dark' },
          { label: '深色文本', value: 'light' },
          {
            label: '浅色文本（色盲友好）',
            value: 'dark-daltonized',
          },
          {
            label: '深色文本（色盲友好）',
            value: 'light-daltonized',
          },
        ]}
        onFocus={handleThemePreview}
        onChange={handleThemeSelection}
      />
      <Box flexDirection="column">
        <Box
          paddingLeft={1}
          marginRight={1}
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
        >
          <StructuredDiff
            patch={{
              oldStart: 1,
              newStart: 1,
              oldLines: 3,
              newLines: 3,
              lines: [
                'function greet() {',
                '-  console.log("Hello, World!");',
                '+  console.log("Hello, anon!");',
                '}',
              ],
            }}
            dim={false}
            width={40}
            overrideTheme={selectedTheme}
          />
        </Box>
      </Box>
    </Box>
  )

  const providersStep = (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Box flexDirection="column" width={70}>
        <Text color={theme.secondaryText}>
          接下来，让我们选择您首选的 AI 提供商和模型。
        </Text>
      </Box>
      <ModelSelector onDone={handleProviderSelectionDone} />
    </Box>
  )

  const usageStep = (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>有效使用 {PRODUCT_NAME}：</Text>
      <Box flexDirection="column" width={70}>
        <OrderedList>
          <OrderedList.Item>
            <Text>
              从您的项目目录开始
              <Newline />
              <Text color={theme.secondaryText}>
                需要时，文件会自动添加到上下文中。
              </Text>
              <Newline />
            </Text>
          </OrderedList.Item>
          <OrderedList.Item>
            <Text>
              将 {PRODUCT_NAME} 作为开发伙伴
              <Newline />
              <Text color={theme.secondaryText}>
                获取文件分析、编辑、bash 命令
                <Newline />
                和 git 历史的帮助。
                <Newline />
              </Text>
            </Text>
          </OrderedList.Item>
          <OrderedList.Item>
            <Text>
              提供清晰的上下文
              <Newline />
              <Text color={theme.secondaryText}>
                像对待其他工程师一样具体明确。 <Newline />
                上下文越好，结果越好。 <Newline />
              </Text>
            </Text>
          </OrderedList.Item>
        </OrderedList>
      </Box>
      <PressEnterToContinue />
    </Box>
  )

  const modelStep = (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>配置您的模型：</Text>
      <Box flexDirection="column" width={70}>
        <Text>
          您可以自定义 {PRODUCT_NAME} 用于不同任务的模型。
          <Newline />
          <Text color={theme.secondaryText}>
            让我们为大型和小型任务设置您首选的模型。
          </Text>
        </Text>
        <Box marginTop={1}>
          <Text>
            按 <Text color={theme.suggestion}>回车键</Text> 继续到模型选择屏幕。
          </Text>
        </Box>
      </Box>
      <PressEnterToContinue />
    </Box>
  )

  const steps: OnboardingStep[] = []
  steps.push({ id: 'theme', component: themeStep })
  steps.push({ id: 'usage', component: usageStep })

  steps.push({ id: 'model', component: modelStep })

  // If we're showing the model selector screen, render it directly
  if (showModelSelector) {
    return <ModelSelector onDone={handleModelSelectionDone} />
  }

  return (
    <Box flexDirection="column" gap={1}>
      <>
        <Box flexDirection="column" gap={1}>
          <Text bold>
            {PRODUCT_NAME}{' '}
            {exitState.pending ? `(再次按 ${exitState.keyName} 退出)` : ''}
          </Text>
          {steps[currentStepIndex]?.component}
        </Box>
      </>
    </Box>
  )
}

export function WelcomeBox(): React.ReactNode {
  const theme = getTheme()
  return (
    <Box
      borderColor={theme.claude}
      borderStyle="round"
      paddingX={1}
      width={MIN_LOGO_WIDTH}
    >
      <Text>
        <Text color={theme.claude}>✻</Text> 欢迎使用{' '}
        <Text bold>{PRODUCT_NAME}!</Text>
      </Text>
    </Box>
  )
}
