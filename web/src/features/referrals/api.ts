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
