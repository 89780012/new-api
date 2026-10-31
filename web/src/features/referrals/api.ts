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

export interface InvitedUser {
  id: number
  username: string
  display_name: string
  created_at: number
}

interface InvitedUsersPage {
  page: number
  page_size: number
  total: number
  items: InvitedUser[]
}

export async function getInvitedUsers(
  page: number,
  pageSize: number
): Promise<InvitedUsersPage> {
  const response = await api.get<{
    success: boolean
    message: string
    data: InvitedUsersPage
  }>('/api/user/self/invites', { params: { p: page, page_size: pageSize } })
  return requireServerSuccess(response.data).data
}

export interface RebateEntry {
  id: number
  trade_no: string
  inviter_id: number
  inviter_name: string
  payer_id: number
  payer_name: string
  paid_money: string
  currency: string
  rate_bps: number
  rebate_quota: number
  balance_before: number | null
  balance_after: number | null
  status: string
  kind: string
  reason: string
  original_id: number
  created_at: number
  credited_at: number
}

export interface RebateFilters {
  start_date?: string
  end_date?: string
  payer_id?: string
  inviter_id?: string
  status?: string
}

export interface RebateDaily {
  day: string
  inviter_id: number
  inviter_name: string
  currency: string
  paid_money: string
  rebate_quota: string
  pending_quota: string
  count: number
  recipients: number
}

interface RebatePage<T> {
  items: T[]
  total: number
  summary?: RebateDaily[]
}

export interface RebatePolicy {
  enabled: boolean
  rate_bps: number
  version: number
}

export async function getRebates(
  admin: boolean,
  filters: RebateFilters,
  page: number,
  pageSize: number
): Promise<RebatePage<RebateEntry>> {
  const response = await api.get<{
    success: boolean
    data: RebatePage<RebateEntry>
  }>(admin ? '/api/referral-rebates' : '/api/user/self/referral-rebates', {
    params: { ...filters, p: page, page_size: pageSize },
  })
  return requireServerSuccess(response.data).data
}

export async function getDailyRebates(
  filters: RebateFilters,
  page: number,
  pageSize: number
): Promise<RebatePage<RebateDaily>> {
  const response = await api.get<{
    success: boolean
    data: RebatePage<RebateDaily>
  }>('/api/referral-rebates/daily', {
    params: { ...filters, p: page, page_size: pageSize },
  })
  return requireServerSuccess(response.data).data
}

export async function getRebatePolicy(): Promise<RebatePolicy> {
  const response = await api.get<{ success: boolean; data: RebatePolicy }>(
    '/api/referral-rebates/settings'
  )
  return requireServerSuccess(response.data).data
}

export async function saveRebatePolicy(
  policy: Pick<RebatePolicy, 'enabled' | 'rate_bps'>
): Promise<RebatePolicy> {
  const response = await api.put<{ success: boolean; data: RebatePolicy }>(
    '/api/referral-rebates/settings',
    policy
  )
  return requireServerSuccess(response.data).data
}

export async function retryRebate(id: number): Promise<void> {
  const response = await api.post(`/api/referral-rebates/${id}/retry`)
  requireServerSuccess(response.data)
}

export async function reverseRebate(id: number, reason: string): Promise<void> {
  const response = await api.post(`/api/referral-rebates/${id}/reverse`, {
    reason,
  })
  requireServerSuccess(response.data)
}
