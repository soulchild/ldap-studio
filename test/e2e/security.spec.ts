import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp } from './app'

let launched: LaunchedApp

test.beforeAll(async () => {
  launched = await launchApp()
})

test.afterAll(async () => {
  await launched?.close()
})

// Without sandboxing or context isolation, require/process/module would be reachable here.
test('the renderer has no Node.js access, only window.api', async () => {
  const globals = await launched.window.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    module: typeof (globalThis as { module?: unknown }).module,
    api: typeof window.api?.invoke,
  }))
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    api: 'function',
  })
})

test('navigation away from the app is blocked', async () => {
  const before = launched.window.url()
  await launched.window.evaluate(() => {
    window.location.href = 'https://example.com/'
  })
  await launched.window.waitForTimeout(500)
  expect(launched.window.url()).toBe(before)
})

test('window.open does not create a window', async () => {
  await launched.window.evaluate(() => window.open('https://example.com/'))
  await launched.window.waitForTimeout(300)
  expect(launched.app.windows()).toHaveLength(1)
})

test('the content security policy blocks inline scripts', async () => {
  const ran = await launched.window.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__inlineRan = true'
    document.body.append(script)
    return (window as { __inlineRan?: boolean }).__inlineRan === true
  })
  expect(ran).toBe(false)
})

test('IPC calls work through window.api', async () => {
  const result = await launched.window.evaluate(() => window.api.invoke('profiles.list', {}))
  expect(result).toEqual({ ok: true, value: [] })
})
