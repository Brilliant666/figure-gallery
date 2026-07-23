import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('gallery is self-contained and exposes required private controls', async () => {
  const html = await readFile(path.join(toolRoot, 'static', 'gallery.html'), 'utf8')
  const home = await readFile(path.join(toolRoot, 'static', 'index.html'), 'utf8')
  const css = await readFile(path.join(toolRoot, 'static', 'styles.css'), 'utf8')
  const script = await readFile(path.join(toolRoot, 'static', 'gallery.js'), 'utf8')
  assert.doesNotMatch(html, /https?:\/\//i)
  assert.doesNotMatch(css, /https?:\/\//i)
  assert.doesNotMatch(script, /https?:\/\//i)
  assert.doesNotMatch(html, /download\s*=/i)
  assert.match(html, /lightbox/i)
  assert.match(html, /show-excluded/)
  assert.match(html, /Official sources/)
  assert.match(html, /Blocked by captcha/)
  assert.match(html, /design-filter/)
  assert.match(html, /scale-filter/)
  assert.match(script, /setPreferredCover/)
  assert.match(script, /editManualNote/)
  assert.match(script, /source-badge/)
  assert.match(script, /goodsmile\.com/)
  assert.match(script, /alter-web\.jp/)
  assert.match(script, /打开官方商品页/)
  assert.match(home, /开始官方来源收集/)
  assert.match(home, /confirmOfficialSourceAccess/)
  assert.match(home, /公开厂商官方商品页/)
  assert.match(home, /Hpoi 实时来源已停用/)
  assert.doesNotMatch(home, /character-url|name="characterUrl"/)
  assert.doesNotMatch(home, /confirmSourcePermission|明确书面许可/)
  assert.match(css, /repeat\(4,/)
  assert.match(css, /repeat\(3,/)
  assert.match(css, /repeat\(2,/)
})
