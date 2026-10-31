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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ChannelStatusContent } from '../index'

const clients: QueryClient[] = []
afterEach(async () => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  await i18next.changeLanguage('en')
})
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <ChannelStatusContent />
    </QueryClientProvider>
  )
}
const item = {
  id: 1,
  name: 'Long channel name',
  provider: 'openai',
  primary_model: 'test-model',
  primary_status: 'operational',
  primary_latency_ms: 0,
  primary_ping_latency_ms: null,
  availability_7d: 98.56,
  timeline: [
    { status: 'failed', checked_at: '2026-10-31T01:00:00Z', latency_ms: null },
    {
      status: 'operational',
      checked_at: '2026-10-31T02:00:00Z',
      latency_ms: 0,
    },
  ],
}
function response(items = [item], enabled = true) {
  return { data: { success: true, data: { items, enabled, updated_at: '' } } }
}
it('shows the unconfigured state without a refresh action', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(response([], false))
  show()
  expect(
    await screen.findByText('Channel status is not configured')
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Refresh' })
  ).not.toBeInTheDocument()
})
it('shows empty monitoring without a healthy status badge', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(response([]))
  show()
  expect(await screen.findByText('No Data')).toBeVisible()
  expect(screen.queryByText('Operational')).not.toBeInTheDocument()
})
it('displays zero and missing latency distinctly and refreshes status', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce(response())
    .mockResolvedValue(response([{ ...item, primary_status: 'failed' }]))
  show()
  expect(await screen.findByTitle(item.name)).toBeVisible()
  expect(screen.getByText('0')).toBeVisible()
  expect(screen.getByText('-')).toBeVisible()
  expect(screen.getByText('98.56%')).toBeVisible()
  const points = screen.getAllByRole('listitem')
  expect(points[0]).toHaveAccessibleName(/Failed.*01:00:00/)
  expect(points[1]).toHaveAccessibleName(/Operational.*02:00:00/)
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(await screen.findByText('Degraded')).toBeVisible()
})
it('shows loading until data arrives', async () => {
  let finish: (value: ReturnType<typeof response>) => void = () => undefined
  vi.spyOn(api, 'get').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  show()
  expect(screen.getByText('Loading...')).toBeVisible()
  finish(response())
  expect(await screen.findByTitle(item.name)).toBeVisible()
})
it('retries a failed response without exposing upstream details', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: false, message: 'private detail' },
  })
  show()
  expect(
    await screen.findByText('Channel status is temporarily unavailable')
  ).toBeVisible()
  expect(screen.queryByText('private detail')).not.toBeInTheDocument()
  vi.spyOn(api, 'get').mockResolvedValue(response())
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByTitle(item.name)).toBeVisible()
})
it('updates number formatting when the interface language changes', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(response())
  show()
  expect(await screen.findByText('98.56%')).toBeVisible()
  await i18next.changeLanguage('fr')
  expect(await screen.findByText('98,56%')).toBeVisible()
})
