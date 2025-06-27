import { Command } from '../commands'
import { EOL, platform, homedir } from 'os'
import { execFileNoThrow } from '../utils/execFileNoThrow'
import chalk from 'chalk'
import { getTheme } from '../utils/theme'
import { env } from '../utils/env'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config'
import { markProjectOnboardingComplete } from '../ProjectOnboarding'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { safeParseJSON } from '../utils/json'
import { logError } from '../utils/log'

const terminalSetup: Command = {
  type: 'local',
  name: 'terminal-setup',
  userFacingName() {
    return 'terminal-setup'
  },
  description:
    'Install Shift+Enter key binding for newlines (iTerm2 and VSCode only)',
  isEnabled:
    (platform() === 'darwin' && env.terminal === 'iTerm.app') ||
    env.terminal === 'vscode',
  isHidden: false,
  async call() {
    let result = ''

    switch (env.terminal) {
      case 'iTerm.app':
        result = await installBindingsForITerm2()
        break
      case 'vscode':
        result = installBindingsForVSCodeTerminal()
        break
    }

    // Update global config to indicate Shift+Enter key binding is installed
    const config = getGlobalConfig()
    config.shiftEnterKeyBindingInstalled = true
    saveGlobalConfig(config)

    // Mark onboarding as complete
    markProjectOnboardingComplete()

    return result
  },
}

export function isShiftEnterKeyBindingInstalled(): boolean {
  return getGlobalConfig().shiftEnterKeyBindingInstalled === true
}

export function handleHashCommand(interpreted: string): void {
  // Appends the AI-interpreted content to CLAUDEX.md
  try {
    const kodingPath = join(process.cwd(), 'CLAUDEX.md')

    // Check if file exists, if not create it
    let existingContent = ''
    try {
      existingContent = readFileSync(kodingPath, 'utf-8').trim()
    } catch (error) {
      // File doesn't exist yet, that's fine
    }

    // Add a separator if the file already has content
    const separator = existingContent ? '\n\n' : ''

    // Add a timestamp if the interpreted content doesn't include one
    const now = new Date()
    // Get timezone abbreviation (EDT, EST, etc.)
    const timezoneMatch = now.toString().match(/\(([A-Z]+)\)/)
    const timezone = timezoneMatch
      ? timezoneMatch[1]
      : now
          .toLocaleTimeString('en-us', { timeZoneName: 'short' })
          .split(' ')
          .pop()

    const timestamp = interpreted.includes(now.getFullYear().toString())
      ? ''
      : `\n\n_Added on ${now.toLocaleString()} ${timezone}_`

    // Combine everything and write to file
    const newContent = `${existingContent}${separator}${interpreted}${timestamp}`
    writeFileSync(kodingPath, newContent, 'utf-8')

    console.log(chalk.hex(getTheme().success)(`Added note to CLAUDEX.md`))
  } catch (e) {
    logError(e)
    console.error(
      chalk.hex(getTheme().error)(
        `Failed to add note to CLAUDEX.md: ${e.message}`,
      ),
    )
  }
}

export default terminalSetup

async function installBindingsForITerm2(): Promise<string> {
  const { code } = await execFileNoThrow('defaults', [
    'write',
    'com.googlecode.iterm2',
    'GlobalKeyMap',
    '-dict-add',
    '0xd-0x20000-0x24',
    `<dict>
      <key>Text</key>
      <string>\\n</string>
      <key>Action</key>
      <integer>12</integer>
      <key>Version</key>
      <integer>1</integer>
      <key>Keycode</key>
      <integer>13</integer>
      <key>Modifiers</key>
      <integer>131072</integer>
    </dict>`,
  ])

  if (code !== 0) {
    throw new Error('Failed to install iTerm2 Shift+Enter key binding')
  }

  return `${chalk.hex(getTheme().success)(
    'Installed iTerm2 Shift+Enter key binding',
  )}${EOL}${chalk.dim('See iTerm2 → Preferences → Keys')}${EOL}`
}

type VSCodeKeybinding = {
  key: string
  command: string
  args: { text: string }
  when: string
}

function installBindingsForVSCodeTerminal(): string {
  const vscodeKeybindingsPath = join(
    homedir(),
    platform() === 'win32'
      ? join('AppData', 'Roaming', 'Code', 'User')
      : platform() === 'darwin'
        ? join('Library', 'Application Support', 'Code', 'User')
        : join('.config', 'Code', 'User'),
    'keybindings.json',
  )

  try {
    const content = readFileSync(vscodeKeybindingsPath, 'utf-8')
    const keybindings: VSCodeKeybinding[] =
      (safeParseJSON(content) as VSCodeKeybinding[]) ?? []

    // Check if keybinding already exists
    const existingBinding = keybindings.find(
      binding =>
        binding.key === 'shift+enter' &&
        binding.command === 'workbench.action.terminal.sendSequence' &&
        binding.when === 'terminalFocus',
    )
    if (existingBinding) {
      return `${chalk.hex(getTheme().warning)(
        'Found existing VSCode terminal Shift+Enter key binding. Remove it to continue.',
      )}${EOL}${chalk.dim(`See ${vscodeKeybindingsPath}`)}${EOL}`
    }

    // Add the keybinding
    keybindings.push({
      key: 'shift+enter',
      command: 'workbench.action.terminal.sendSequence',
      args: { text: '\\\r\n' },
      when: 'terminalFocus',
    })

    writeFileSync(
      vscodeKeybindingsPath,
      JSON.stringify(keybindings, null, 4),
      'utf-8',
    )

    return `${chalk.hex(getTheme().success)(
      'Installed VSCode terminal Shift+Enter key binding',
    )}${EOL}${chalk.dim(`See ${vscodeKeybindingsPath}`)}${EOL}`
  } catch (e) {
    logError(e)
    throw new Error('Failed to install VSCode terminal Shift+Enter key binding')
  }
}
