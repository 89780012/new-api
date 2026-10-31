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
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  DataTableView,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { getInvitedUsers, type InvitedUser } from './api'

const EMPTY_USERS: InvitedUser[] = []

export function Referrals() {
  const { t, i18n } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const query = useQuery({
    queryKey: [
      'self',
      userID,
      'invites',
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      getInvitedUsers(pagination.pageIndex + 1, pagination.pageSize),
    enabled: userID != null,
  })
  const columns = useMemo<ColumnDef<InvitedUser>[]>(
    () => [
      {
        accessorKey: 'id',
        header: t('ID'),
        cell: ({ row }) => formatNumber(row.original.id, locale),
      },
      {
        accessorKey: 'username',
        header: t('Username'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.username}</TruncatedCell>
        ),
      },
      {
        accessorKey: 'display_name',
        header: t('Display Name'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.display_name || '-'}</TruncatedCell>
        ),
      },
      {
        accessorKey: 'created_at',
        header: t('Registration time'),
        cell: ({ row }) => formatTimestamp(row.original.created_at),
      },
    ],
    [t, locale]
  )
  const { table } = useDataTable({
    data: query.data?.items ?? EMPTY_USERS,
    columns,
    totalCount: query.data?.total ?? 0,
    manualPagination: true,
    enableSorting: false,
    enableRowSelection: false,
    pagination,
    onPaginationChange: setPagination,
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('My invited users')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4 p-3 sm:p-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Only users who registered through your referral link are shown.'
            )}
          </p>
          {query.isError ? (
            <ErrorState
              onRetry={() => {
                void query.refetch()
              }}
            />
          ) : (
            <>
              <DataTableView
                table={table}
                isLoading={query.isPending}
                containerProps={{ 'aria-busy': query.isPending }}
                emptyTitle={t('No invited users yet')}
                emptyDescription={t(
                  'Share your referral link to invite users.'
                )}
                tableContainerClassName='overflow-x-auto'
              />
              {query.isSuccess && query.data.total > 0 && (
                <DataTablePagination table={table} compact />
              )}
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
