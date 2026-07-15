import { assertServerOnly } from './assert-server-only'
import { parseEnvironment, type RuntimeEnvironment } from './environment'

assertServerOnly()

export function loadRuntimeEnvironment(): RuntimeEnvironment {
  return parseEnvironment(process.env)
}
