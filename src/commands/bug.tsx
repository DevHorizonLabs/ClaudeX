import { Command } from '../commands'
import { Bug } from '../components/Bug'
import * as React from 'react'
import { PRODUCT_NAME } from '../constants/product'

const bug = {
  type: 'local-jsx',
  name: 'bug',
  description: `提交关于${PRODUCT_NAME}的反馈`,
  isEnabled: true,
  isHidden: false,
  async call(onDone) {
    return <Bug onDone={onDone} />
  },
  userFacingName() {
    return 'bug'
  },
} satisfies Command

export default bug
