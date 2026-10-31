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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { Referrals } from '..'
import type { InvitedUser } from '../api'

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

async function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const router = createRouter({
    routeTree: createRootRoute({ component: Referrals }),
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
