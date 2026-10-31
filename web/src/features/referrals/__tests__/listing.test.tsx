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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { InvitedUser } from '../api'
import { RebateLedger } from '../components/rebate-ledger'
import { InvitedUsers } from '../invited-users'
import { formatRebateTimestamp } from '../money'

const clients: QueryClient[] = []
const invitee: InvitedUser = {
  id: 42,
  username: 'invited-user',
  display_name: 'Invited User',
  created_at: 1700000000,
}

function response(items: InvitedUser[], total = items.length) {
  return {
    data: {
      success: true,
      message: '',
      data: { items, total, page: 1, page_size: 20 },
    },
  }
}

async function renderPage(ledger = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const router = createRouter({
    routeTree: createRootRoute({
      component: ledger ? RebateLedger : InvitedUsers,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 7, username: 'inviter', role: 1 })
})

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  localStorage.clear()
})

it('shows invited profiles and fetches the next page when the user advances', async () => {
  const longName = 'Long display name '.repeat(20)
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce(
      response([{ ...invitee, display_name: longName }], 21)
    )
    .mockResolvedValueOnce(
      response([{ ...invitee, id: 43, username: 'next-page-user' }], 21)
    )
  await renderPage()
  const table = await screen.findByRole('table')
  expect(await within(table).findByText('invited-user')).toBeVisible()
  expect(within(table).getByText(longName.trim())).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(await screen.findByText('next-page-user')).toBeVisible()
  expect(screen.queryByText('invited-user')).not.toBeInTheDocument()
  expect(get).toHaveBeenLastCalledWith('/api/user/self/invites', {
    params: { p: 2, page_size: 20 },
  })
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
})

it('shows loading until the request resolves and then shows the invitation empty state', async () => {
  let resolveRequest!: (value: ReturnType<typeof response>) => void
  vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve
      })
  )
  const view = await renderPage()
  expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  expect(screen.queryByText('No invited users yet')).not.toBeInTheDocument()
  await act(async () => {
    resolveRequest(response([]))
  })
  expect(await screen.findByText('No invited users yet')).toBeVisible()
  expect(
    screen.getByText('Share your referral link to invite users.')
  ).toBeVisible()
  expect(
    screen.queryByRole('navigation', { name: 'Page' })
  ).not.toBeInTheDocument()
})

it('shows a retry action after a business failure and loads the recovered result', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Unable to load invitations' },
    })
    .mockResolvedValueOnce(response([invitee]))
  await renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('invited-user')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Retry' })
  ).not.toBeInTheDocument()
})

it('fetches a separate list when the signed-in account changes without showing the previous account data', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce(response([invitee]))
    .mockResolvedValueOnce(response([]))
  await renderPage()
  expect(await screen.findByText('invited-user')).toBeVisible()
  act(() => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 8, username: 'other-inviter', role: 1 })
  })
  expect(screen.queryByText('invited-user')).not.toBeInTheDocument()
  expect(await screen.findByText('No invited users yet')).toBeVisible()
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
})

it('shows each recharge rebate separately with the corresponding balance snapshots and isolates accounts', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          total: 2,
          items: [
            {
              id: 1,
              trade_no: 'order-first',
              payer_name: 'invited-user',
              paid_money: '100',
              currency: 'CNY',
              rate_bps: 500,
              rebate_quota: 2500000,
              balance_before: 10000000,
              balance_after: 12500000,
              created_at: 1700000000,
              credited_at: 1700000001,
              kind: 'rebate',
              status: 'credited',
              reason: '',
            },
            {
              id: 2,
              trade_no: 'order-second',
              payer_name: 'invited-user',
              paid_money: '200',
              currency: 'CNY',
              rate_bps: 500,
              rebate_quota: 5000000,
              balance_before: 12500000,
              balance_after: 17500000,
              created_at: 1700000100,
              credited_at: 1700000101,
              kind: 'rebate',
              status: 'credited',
              reason: '',
            },
          ],
        },
      },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { total: 0, items: [] } },
    })
  await renderPage(true)
  const first = (await screen.findByText('order-first')).closest('tr')
  const second = screen.getByText('order-second').closest('tr')
  if (!first || !second) throw new Error('Missing rebate rows')
  expect(first).not.toBe(second)
  const table = screen.getByRole('table')
  expect(
    within(table).getByRole('columnheader', { name: 'Balance before rebate' })
  ).toBeVisible()
  expect(
    within(table).getByRole('columnheader', { name: 'Balance after rebate' })
  ).toBeVisible()
  const firstCells = within(first).getAllByRole('cell')
  const secondCells = within(second).getAllByRole('cell')
  expect(firstCells[7].textContent).toBe(secondCells[6].textContent)
  expect(firstCells[6].textContent).not.toBe(firstCells[7].textContent)
  expect(secondCells[6].textContent).not.toBe(secondCells[7].textContent)
  i18next.addResourceBundle('zhCN', 'translation', {
    'Recharge date': '充值时间',
  })
  await act(async () => {
    await i18next.changeLanguage('zhCN')
  })
  expect(within(first).getByText('2023/11/15 06:13:20')).toBeVisible()
  await act(async () => {
    await i18next.changeLanguage('en')
  })
  i18next.removeResourceBundle('zhCN', 'translation')
  act(() => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 8, username: 'other-inviter', role: 1 })
  })
  expect(screen.queryByText('order-first')).not.toBeInTheDocument()
  expect(await screen.findByText('No recharge rebate records')).toBeVisible()
})

it.each([
  ['en', '11/15/2023, 06:13:20'],
  ['zhCN', '2023/11/15 06:13:20'],
  ['zhTW', '2023/11/15\u200906:13:20'],
  ['fr', '15/11/2023 06:13:20'],
  ['ja', '2023/11/15 06:13:20'],
  ['ru', '15.11.2023, 06:13:20'],
  ['vi', '06:13:20 15/11/2023'],
])('formats rebate dates in Beijing time for %s', (language, expected) => {
  expect(formatRebateTimestamp(1700000000, toIntlLocale(language))).toBe(
    expected
  )
  expect(formatRebateTimestamp(0, toIntlLocale(language))).toBe('-')
})

it('falls back to the runtime locale for an invalid interface language', () => {
  expect(toIntlLocale('not_a_locale')).toBeUndefined()
  expect(
    formatRebateTimestamp(1700000000, toIntlLocale('not_a_locale'))
  ).toContain('06:13:20')
})

it('shows a redemption face amount in wallet units and identifies its source without disclosing the code', async () => {
  vi.spyOn(api, 'get').mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        total: 1,
        items: [
          {
            id: 3,
            trade_no: 'redemption:12',
            payer_name: 'invited-user',
            paid_money: '50000000',
            currency: 'QTA',
            rate_bps: 500,
            rebate_quota: 2500000,
            balance_before: 10000000,
            balance_after: 12500000,
            created_at: 1700000000,
            credited_at: 1700000001,
            kind: 'rebate',
            status: 'credited',
            reason: '',
          },
        ],
      },
    },
  })
  await renderPage(true)
  const row = (await screen.findByText('redemption:12')).closest('tr')
  if (!row) throw new Error('Missing redemption row')
  expect(within(row).getByText('Redemption code')).toBeVisible()
  const cells = within(row).getAllByRole('cell')
  expect(cells[3].textContent).toContain('100')
  expect(cells[3].textContent).not.toContain('50000000')
  expect(cells[3].textContent).not.toContain('QTA')
  expect(cells[5].textContent).toContain('5')
  expect(cells[6].textContent).toContain('20')
  expect(cells[7].textContent).toContain('25')
})
