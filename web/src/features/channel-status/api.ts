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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export interface ChannelStatusPoint {
  status: string
  latency_ms: number | null
  ping_latency_ms: number | null
  checked_at: string
}

export interface ChannelStatusItem {
  id: number
  name: string
  provider: string
  primary_model: string
  primary_status: string
  primary_latency_ms: number | null
  primary_ping_latency_ms: number | null
  availability_7d: number
  timeline: ChannelStatusPoint[]
}

export interface ChannelStatusSnapshot {
  enabled: boolean
  updated_at: string
  items: ChannelStatusItem[]
}

export async function getChannelStatus(
  signal?: AbortSignal
): Promise<ChannelStatusSnapshot> {
  const response = await api.get<{
    success: boolean
    data: ChannelStatusSnapshot
  }>('/api/channel-status', { signal })
  requireServerSuccess(response.data)
  return response.data.data
}
