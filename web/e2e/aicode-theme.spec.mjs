/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { expect, test } from '@playwright/test'

// HTTP fixtures exercise the actual router, theme controls and shared components.
// No application server, credentials, or database is used by these visual checks.
const user = {
  id: 1,
  username: 'aicode-demo',
  display_name: 'AICode Developer',
  role: 1,
  status: 1,
  group: 'default',
  quota: 5000000,
  used_quota: 100000,
  request_count: 12,
  setting: '{}',
  permissions: { sidebar_settings: true },
}

async function mockConsole(page) {
  await page
    .context()
    .addCookies([
      { name: 'new_api_has_session', value: '1', url: 'http://127.0.0.1:4173' },
    ])
  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'en')
  })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path === '/api/setup') data = { status: true, root_init: true }
    if (path === '/api/status') {
      data = {
        system_name: 'New API',
        logo: '/logo.png',
        version: 'v1.0.0-rc.47-aicode.2',
        quota_per_unit: 500000,
        display_in_currency: true,
        uptime_kuma_enabled: false,
      }
    }
    if (path === '/api/user/auth/refresh') {
      data = {
        access_token: 'visual-fixture-only',
        token_type: 'Bearer',
        access_expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
        session: {
          sid: 'visual-fixture',
          current: true,
          login_method: 'password',
          ip: '127.0.0.1',
          user_agent: 'browser-test',
          created_at: 1,
          last_active_at: 1,
          expires_at: 9999999999,
        },
      }
    }
    if (path === '/api/user/self') data = user
    if (path === '/api/home_page_content' || path === '/api/notice') data = ''
    if (path === '/api/token/') {
      data = { items: [], total: 0, page: 1, page_size: 10 }
    }
    if (path === '/api/user/self/groups') {
      data = { default: { desc: 'Default', ratio: 1 } }
    }
    await route.fulfill({ json: { success: true, data, message: '' } })
  })
}

async function surface(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, foreground: style.color }
    })
}

async function selectMode(page, mode) {
  await page.getByRole('button', { name: 'Open theme settings' }).click()
  await page.getByRole('radio', { name: `Select ${mode}`, exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveClass(new RegExp(mode))
}

test.beforeEach(async ({ page }) => {
  await mockConsole(page)
})

test('homepage theme control updates every surface and survives reload', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.aicode-shell')).toBeVisible()
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.getByRole('menuitem', { name: 'Light', exact: true }).click()
  const light = await surface(page, '.aicode-shell')
  const lightCard = await surface(page, '.aicode-node')
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.getByRole('menuitem', { name: 'Dark', exact: true }).click()
  expect(await surface(page, '.aicode-shell')).not.toEqual(light)
  expect(await surface(page, '.aicode-node')).not.toEqual(lightCard)
  const dark = await surface(page, '.aicode-shell')
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await surface(page, '.aicode-shell')).toEqual(dark)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.getByRole('menuitem', { name: 'System', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/light/)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await surface(page, '.aicode-shell')).toEqual(dark)
})

test('default palette keeps landing body text, code and buttons readable in both modes', async ({
  page,
}) => {
  for (const mode of ['light', 'dark']) {
    await page.addInitScript(
      (value) => localStorage.setItem('newapi:theme:v1:mode', value),
      mode
    )
    await page.goto('/')
    await expect(page.locator('.aicode-shell')).toBeVisible()
    for (const selector of [
      '.aicode-description',
      '.aicode-code-panel pre',
      '.aicode-primary',
    ]) {
      const ratio = await page
        .locator(selector)
        .first()
        .evaluate((element) => {
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          const luminance = (color) => {
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
            const channels = [...context.getImageData(0, 0, 1, 1).data]
              .slice(0, 3)
              .map((channel) => {
                const value = channel / 255
                return value <= 0.04045
                  ? value / 12.92
                  : ((value + 0.055) / 1.055) ** 2.4
              })
            return (
              channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
            )
          }
          let background = element
          while (
            background.parentElement &&
            getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)'
          ) {
            background = background.parentElement
          }
          const foregroundLuminance = luminance(getComputedStyle(element).color)
          const backgroundLuminance = luminance(
            getComputedStyle(background).backgroundColor
          )
          return (
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
          )
        })
      expect(ratio, `${mode} ${selector} contrast`).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('console, portal settings and homepage share the selected palette', async ({
  page,
}) => {
  await page.goto('/keys')
  await expect(page.locator('.aicode-console')).toBeVisible()
  await selectMode(page, 'light')
  const light = await surface(page, '[data-slot=sidebar-inset]')
  await selectMode(page, 'dark')
  const dark = await surface(page, '[data-slot=sidebar-inset]')
  expect(dark).not.toEqual(light)
  await page.getByRole('button', { name: 'Open theme settings' }).click()
  const dialog = page.getByRole('dialog')
  expect(await surface(page, '[role=dialog]')).not.toEqual(light)
  const preset = dialog.getByRole('radio', { name: 'Rose Garden', exact: true })
  await preset.click()
  await expect(page.locator('body')).toHaveAttribute(
    'data-theme-preset',
    'rose-garden'
  )
  const accent = await page
    .locator('body')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--primary'))
  await page.keyboard.press('Escape')
  await page.goto('/')
  await expect(page.locator('.aicode-shell')).toBeVisible()
  const homepageAccent = await page
    .locator('.aicode-shell')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--primary'))
  expect(homepageAccent).toEqual(accent)
  expect(await surface(page, '.aicode-shell')).toEqual(dark)
})

for (const width of [1440, 768, 390]) {
  test(`console remains usable at ${width}px in light and dark modes`, async ({
    page,
  }) => {
    test.setTimeout(90000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    for (const mode of ['light', 'dark']) {
      await page.addInitScript(
        (value) => localStorage.setItem('newapi:theme:v1:mode', value),
        mode
      )
      for (const route of [
        '/dashboard',
        '/keys',
        '/wallet',
        '/profile',
        '/pricing',
      ]) {
        await page.goto(route)
        const title = {
          '/dashboard': 'Overview',
          '/keys': 'API Keys',
          '/wallet': 'Wallet',
          '/profile': 'AICode Developer',
          '/pricing': 'Model Square',
        }[route]
        await expect(
          page.getByRole('heading', { name: title, exact: true })
        ).toBeVisible()
        await expect(page.locator('html')).toHaveClass(new RegExp(mode))
        await expect(page.locator('body')).not.toContainText(
          'Something went wrong'
        )
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBe(width)
        if (route === '/keys') {
          await expect(page.locator('.aicode-console')).toBeVisible()
          const sidebar = page.locator('[data-slot=sidebar][data-state]')
          const previousState =
            width >= 768 ? await sidebar.getAttribute('data-state') : null
          await page
            .getByRole('button', { name: 'Toggle Sidebar' })
            .first()
            .click()
          if (width < 768) {
            await expect(page.getByRole('dialog')).toBeVisible()
            await page.keyboard.press('Escape')
            await expect(page.getByRole('dialog')).toHaveCount(0)
          } else {
            await expect(sidebar).toHaveAttribute(
              'data-state',
              previousState === 'collapsed' ? 'expanded' : 'collapsed'
            )
          }
        }
      }
    }
    expect(errors).toEqual([])
  })
}
