import * as React from 'react'
import { getTheme } from '../utils/theme'
import { Text } from 'ink'

export function PressEnterToContinue(): React.ReactNode {
  return (
    <Text color={getTheme().permission}>
      按 <Text bold>回车键</Text> 继续…
    </Text>
  )
}
