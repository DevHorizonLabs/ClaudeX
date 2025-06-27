import { Box, Text, useInput } from 'ink'
import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { getTheme } from '../utils/theme'
import { getMessagesGetter } from '../messages'
import type { Message } from '../query'
import TextInput from './TextInput'
import { logError, getInMemoryErrors } from '../utils/log'
import { env } from '../utils/env'
import { getGitState, getIsGit, GitRepoState } from '../utils/git'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { getAnthropicApiKey, getGlobalConfig } from '../utils/config'
import { USER_AGENT } from '../utils/http'
import { logEvent } from '../services/statsig'
import { PRODUCT_NAME } from '../constants/product'
import { API_ERROR_MESSAGE_PREFIX, queryHaiku } from '../services/claude'
import { openBrowser } from '../utils/browser'
import { useExitOnCtrlCD } from '../hooks/useExitOnCtrlCD'
import { MACRO } from '../constants/macros'
import { GITHUB_ISSUES_REPO_URL } from '../constants/product'

type Props = {
  onDone(result: string): void
}

type Step = 'userInput' | 'consent' | 'submitting' | 'done'

type FeedbackData = {
  // 由于隐私考虑而移除。当我们有更健全的反馈数据查看工具可以去识别用户身份时再添加回来
  // user_id: string
  // session_id: string
  message_count: number
  datetime: string
  description: string
  platform: string
  gitRepo: boolean
  version: string | null
  transcript: Message[]
}

export function Bug({ onDone }: Props): React.ReactNode {
  const [step, setStep] = useState<Step>('userInput')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [description, setDescription] = useState('')
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [envInfo, setEnvInfo] = useState<{
    isGit: boolean
    gitState: GitRepoState | null
  }>({ isGit: false, gitState: null })
  const [title, setTitle] = useState<string | null>(null)
  const textInputColumns = useTerminalSize().columns - 4
  const messages = getMessagesGetter()()

  useEffect(() => {
    async function loadEnvInfo() {
      const isGit = await getIsGit()
      let gitState: GitRepoState | null = null
      if (isGit) {
        gitState = await getGitState()
      }
      setEnvInfo({ isGit, gitState })
    }
    void loadEnvInfo()
  }, [])

  const exitState = useExitOnCtrlCD(() => process.exit(0))

  const submitReport = useCallback(async () => {
    setStep('done')
    // setStep('submitting')
    // setError(null)
    // setFeedbackId(null)

    // const reportData = {
    //   message_count: messages.length,
    //   datetime: new Date().toISOString(),
    //   description,
    //   platform: env.platform,
    //   gitRepo: envInfo.isGit,
    //   terminal: env.terminal,
    //   version: MACRO.VERSION,
    //   transcript: messages,
    //   errors: getInMemoryErrors(),
    // }

    // const [result, t] = await Promise.all([
    //   submitFeedback(reportData),
    //   generateTitle(description),
    // ])

    // setTitle(t)

    // if (result.success) {
    //   if (result.feedbackId) {
    //     setFeedbackId(result.feedbackId)
    //     logEvent('tengu_bug_report_submitted', {
    //       feedback_id: result.feedbackId,
    //     })
    //   }
    //   setStep('done')
    // } else {
    //   console.log(result)
    //   setError('无法提交反馈。请稍后再试。')
    //   setStep('userInput')
    // }
  }, [description, envInfo.isGit, messages])

  useInput((input, key) => {
    // 当完成或出现错误时，允许任何按键关闭对话框
    // if (step === 'done') {
    //   if (key.return && feedbackId && title) {
    //     // 按下回车键时打开GitHub问题URL
    //     const issueUrl = createGitHubIssueUrl(feedbackId, title, description)
    //     void openBrowser(issueUrl)
    //   }
    //   onDone('<bash-stdout>Bug report submitted</bash-stdout>')
    //   return
    // }

    if (error) {
      onDone('<bash-stderr>提交错误报告时出错</bash-stderr>')
      return
    }

    if (key.escape) {
      onDone('<bash-stderr>错误报告已取消</bash-stderr>')
      return
    }

    if (step === 'consent' && (key.return || input === ' ')) {
      const issueUrl = createGitHubIssueUrl(
        feedbackId,
        description.slice(0, 80),
        description,
      )
      void openBrowser(issueUrl)
      onDone('<bash-stdout>错误报告已提交</bash-stdout>')
    }
  })

  const theme = getTheme()

  return (
    <>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.permission}
        paddingX={1}
        paddingBottom={1}
        gap={1}
      >
        <Text bold color={theme.permission}>
          提交错误报告
        </Text>
        {step === 'userInput' && (
          <Box flexDirection="column" gap={1}>
            <Text>
              在下面描述问题并复制/粘贴您看到的任何错误信息：
            </Text>
            <TextInput
              value={description}
              onChange={setDescription}
              columns={textInputColumns}
              onSubmit={() => setStep('consent')}
              onExitMessage={() =>
                onDone('<bash-stderr>错误报告已取消</bash-stderr>')
              }
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
            />
            {error && (
              <Box flexDirection="column" gap={1}>
                <Text color="red">{error}</Text>
                <Text dimColor>按任意键关闭</Text>
              </Box>
            )}
          </Box>
        )}

        {step === 'consent' && (
          <Box flexDirection="column">
            <Text>此报告将包括：</Text>
            <Box marginLeft={2} flexDirection="column">
              <Text>
                - 您的错误描述: <Text dimColor>{description}</Text>
              </Text>
              <Text>
                - 环境信息:{' '}
                <Text dimColor>
                  {env.platform}, {env.terminal}, v{MACRO.VERSION}
                </Text>
              </Text>
              {/* {envInfo.gitState && (
                <Text>
                  - Git仓库元数据:{' '}
                  <Text dimColor>
                    {envInfo.gitState.branchName}
                    {envInfo.gitState.commitHash
                      ? `, ${envInfo.gitState.commitHash.slice(0, 7)}`
                      : ''}
                    {envInfo.gitState.remoteUrl
                      ? ` @ ${envInfo.gitState.remoteUrl}`
                      : ''}
                    {!envInfo.gitState.isHeadOnRemote && ', 未同步'}
                    {!envInfo.gitState.isClean && ', 有本地更改'}
                  </Text>
                </Text>
              )} */}
              <Text>- 模型设置（不包含API密钥）</Text>
            </Box>
            {/* <Box marginTop={1}>
              <Text wrap="wrap" dimColor>
                我们将使用您的反馈来调试相关问题或改进{' '}
                {PRODUCT_NAME}的功能（例如，减少将来出现错误的风险）。
                Anthropic不会使用来自{PRODUCT_NAME}的反馈来训练生成式模型。
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text>
                按<Text bold>回车键</Text>确认并提交。
              </Text>
            </Box> */}
          </Box>
        )}

        {step === 'submitting' && (
          <Box flexDirection="row" gap={1}>
            <Text>正在提交报告…</Text>
          </Box>
        )}

        {step === 'done' && (
          <Box flexDirection="column">
            <Text color={getTheme().success}>感谢您的报告！</Text>
            {feedbackId && <Text dimColor>反馈ID: {feedbackId}</Text>}
            <Box marginTop={1}>
              <Text>按</Text>
              <Text bold>回车键</Text>
              <Text>
                创建GitHub问题，或按任意其他键关闭。
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      <Box marginLeft={3}>
        <Text dimColor>
          {exitState.pending ? (
            <>再次按 {exitState.keyName} 退出</>
          ) : step === 'userInput' ? (
            <>回车键继续 · Esc键取消</>
          ) : step === 'consent' ? (
            <>回车键打开浏览器创建GitHub问题 · Esc键取消</>
          ) : null}
        </Text>
      </Box>
    </>
  )
}

function createGitHubIssueUrl(
  feedbackId: string,
  title: string,
  description: string,
): string {
  const globalConfig = getGlobalConfig()
  const body = encodeURIComponent(`
## 错误描述
${description}

## 环境信息
- 平台: ${env.platform}
- 终端: ${env.terminal}
- 版本: ${MACRO.VERSION || '未知'}

## 模型
- 大模型
    - 基础URL: ${globalConfig.largeModelBaseURL}
    - 模型: ${globalConfig.largeModelName}
    - 最大令牌数: ${globalConfig.largeModelMaxTokens}
    - 推理努力值: ${globalConfig.largeModelReasoningEffort}
- 小模型
    - 基础URL: ${globalConfig.smallModelBaseURL}
    - 模型: ${globalConfig.smallModelName}
    - 最大令牌数: ${globalConfig.smallModelMaxTokens}
    - 推理努力值: ${globalConfig.smallModelReasoningEffort}
`)
  return `${GITHUB_ISSUES_REPO_URL}/new?title=${encodeURIComponent(title)}&body=${body}&labels=user-reported,bug`
}

async function generateTitle(description: string): Promise<string> {
  const response = await queryHaiku({
    systemPrompt: [
      '生成一个简洁的问题标题（最多80个字符），捕捉这个反馈的要点。不要包含引号或前缀，如"反馈："或"问题："。如果无法生成标题，请使用"用户反馈"。',
    ],
    userPrompt: description,
  })
  const title =
    response.message.content[0]?.type === 'text'
      ? response.message.content[0].text
      : '错误报告'
  if (title.startsWith(API_ERROR_MESSAGE_PREFIX)) {
    return `错误报告: ${description.slice(0, 60)}${description.length > 60 ? '...' : ''}`
  }
  return title
}

async function submitFeedback(
  data: FeedbackData,
): Promise<{ success: boolean; feedbackId?: string }> {
  return { success: true, feedbackId: '123' }
  // try {
  //   const apiKey = getAnthropicApiKey()
  //   if (!apiKey) {
  //     return { success: false }
  //   }

  //   const response = await fetch(
  //     'https://api.anthropic.com/api/claude_cli_feedback',
  //     {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //         'User-Agent': USER_AGENT,
  //         'x-api-key': apiKey,
  //       },
  //       body: JSON.stringify({
  //         content: JSON.stringify(data),
  //       }),
  //     },
  //   )

  //   if (response.ok) {
  //     const result = await response.json()
  //     if (result?.feedback_id) {
  //       return { success: true, feedbackId: result.feedback_id }
  //     }
  //     logError('提交反馈失败：请求未返回feedback_id')
  //     return { success: false }
  //   }

  //   logError('提交反馈失败：' + response.status)
  //   return { success: false }
  // } catch (err) {
  //   logError(
  //     '提交反馈时出错：' +
  //       (err instanceof Error ? err.message : '未知错误'),
  //   )
  //   return { success: false }
  // }
}
