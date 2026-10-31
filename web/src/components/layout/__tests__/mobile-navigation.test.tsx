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
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { MobileDrawer } from '../components/mobile-drawer'

const clients: QueryClient[] = []

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  localStorage.clear()
})

async function renderDrawer(signedIn = true, referralsVisible = true) {
  const user = signedIn ? { id: 7, username: 'inviter', role: 1 } : null
  useAuthStore.getState().auth.setUser(user)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(STATUS_QUERY_KEY, {
    SidebarModulesAdmin: JSON.stringify({
      personal: { enabled: true, referrals: referralsVisible },
    }),
  })
  const onClose = vi.fn()
  const root = createRootRoute({ component: Outlet })
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <MobileDrawer
        isOpen
        onClose={onClose}
        homeUrl='/'
        displayLogo={null}
        displaySiteName='New API'
        loading={false}
        logoLoaded
        mobileLinksList={[]}
        showAuthButtons
        user={user}
      />
    ),
  })
  const referrals = createRoute({
    getParentRoute: () => root,
    path: '/referrals',
    component: () => <h1>Invited user list</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([index, referrals]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { onClose }
}

it('signed-in users can open invited users directly beside Wallet and close the mobile drawer', async () => {
  const { onClose } = await renderDrawer()
  expect(screen.getByRole('link', { name: 'Wallet' })).toHaveAttribute(
    'href',
    '/wallet'
  )
  const link = screen.getByRole('link', { name: 'My invited users' })
  expect(link).toHaveAttribute('href', '/referrals')
  await userEvent.click(link)
  expect(
    await screen.findByRole('heading', { name: 'Invited user list' })
  ).toBeInTheDocument()
  expect(onClose).toHaveBeenCalledOnce()
})

it('anonymous users do not see the invited users shortcut', async () => {
  await renderDrawer(false)
  expect(
    screen.queryByRole('link', { name: 'My invited users' })
  ).not.toBeInTheDocument()
})

it('sidebar settings can hide the mobile invited users shortcut independently of Wallet', async () => {
  await renderDrawer(true, false)
  expect(
    screen.queryByRole('link', { name: 'My invited users' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Wallet' })).toBeInTheDocument()
})
