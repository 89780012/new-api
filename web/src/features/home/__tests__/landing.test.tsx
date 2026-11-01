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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { AICodeLanding } from '../components/aicode-landing'

async function renderLanding(isAuthenticated = false) {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: createRootRoute({
      component: () => <AICodeLanding isAuthenticated={isAuthenticated} />,
    }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  await screen.findByRole('main')
}

afterEach(async () => {
  await i18next.changeLanguage('en')
})

test('visitors can register and explore the actual model catalog', async () => {
  await renderLanding()
  expect(screen.getAllByRole('link', { name: /Start building/ })).toHaveLength(
    2
  )
  for (const link of screen.getAllByRole('link', { name: /Start building/ })) {
    expect(link).toHaveAttribute('href', '/sign-up')
  }
  expect(screen.getByRole('link', { name: /Explore models/ })).toHaveAttribute(
    'href',
    '/pricing'
  )
  expect(
    screen.getByRole('link', { name: /Build with intelligence/ })
  ).toHaveAttribute('href', '/pricing')
  expect(
    screen.getByText('Model availability and pricing follow the live catalog.')
  ).toBeVisible()
})

test('signed-in users can open their dashboard from both calls to action', async () => {
  await renderLanding(true)
  for (const link of screen.getAllByRole('link', { name: /Go to Dashboard/ })) {
    expect(link).toHaveAttribute('href', '/dashboard')
  }
  expect(
    screen.queryByRole('link', { name: /Start building/ })
  ).not.toBeInTheDocument()
})

test('developers can switch examples with the keyboard and copy the selected request', async () => {
  const user = userEvent.setup()
  await renderLanding()
  const pythonTab = screen.getByRole('tab', { name: 'Python' })
  expect(pythonTab).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel')).toHaveTextContent(
    `base_url="${window.location.origin}/v1"`
  )
  pythonTab.focus()
  await user.keyboard('{ArrowRight}{Enter}')
  expect(screen.getByRole('tab', { name: 'cURL' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const panel = screen.getByRole('tabpanel')
  expect(panel).toHaveTextContent(
    `curl ${window.location.origin}/v1/chat/completions`
  )
  const example = within(panel).getByLabelText('curl').textContent
  expect(example).toContain('completions \\\n')
  await user.click(within(panel).getByRole('button', { name: 'Copy code' }))
  expect(await navigator.clipboard.readText()).toBe(example)
  expect(within(panel).getByRole('button', { name: 'Copied' })).toBeVisible()
})

test('the endpoint copy uses the current host and never includes a real API key', async () => {
  const user = userEvent.setup()
  await renderLanding()
  await user.click(screen.getByRole('button', { name: 'Copy API base URL' }))
  expect(await navigator.clipboard.readText()).toBe(
    `${window.location.origin}/v1`
  )
  expect(
    screen.getByText(/Replace YOUR_API_KEY and YOUR_MODEL_ID/)
  ).toBeVisible()
})

test('changing language updates the headline and accessible diagram description', async () => {
  i18next.addResourceBundle('en', 'translation', en.translation, true, true)
  i18next.addResourceBundle('zhCN', 'translation', zh.translation, true, true)
  await renderLanding()
  await i18next.changeLanguage('zhCN')
  expect(
    await screen.findByRole('heading', { level: 1, name: /连接智能/ })
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { name: '邀请好友，充值享返利' })
  ).toBeVisible()
  expect(
    screen.getAllByRole('link', { name: /立即参与邀请返利/ })
  ).toHaveLength(2)
  expect(
    screen.getByRole('img', { name: 'AICode 将你的应用连接至 AI 模型服务' })
  ).toBeVisible()
})

test('visitors see the referral offer in the hero and can join from the program section', async () => {
  await renderLanding()
  const hero = screen.getByRole('region', { name: /Intelligence, connected/ })
  expect(
    within(hero).getByRole('link', { name: /Join the referral program/ })
  ).toHaveAttribute('href', '/sign-up')
  const program = screen.getByRole('region', {
    name: 'Invite friends. Earn recharge rebates.',
  })
  expect(
    within(program).getByRole('link', { name: /Join the referral program/ })
  ).toHaveAttribute('href', '/sign-up')
  expect(within(program).getAllByRole('listitem')).toHaveLength(3)
  expect(
    within(program).getByText(/Rebates depend on the active program settings/)
  ).toBeVisible()
  expect(
    within(program).queryByRole('link', { name: 'Recharge rebate details' })
  ).not.toBeInTheDocument()
})

test('signed-in users can find their referral link and recharge rebate ledger', async () => {
  await renderLanding(true)
  const links = screen.getAllByRole('link', { name: /Get my referral link/ })
  expect(links).toHaveLength(2)
  for (const link of links) expect(link).toHaveAttribute('href', '/wallet')
  expect(
    screen.getByRole('link', { name: 'Recharge rebate details' })
  ).toHaveAttribute('href', '/referrals')
})
