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
import { Card, CardContent } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import {
  getDailyRebates,
  type RebateDaily,
  type RebateFilters as Filters,
} from '../api'
import { formatRebatePayment } from '../money'
import { RebateFilters } from './rebate-filters'

const EMPTY_DAYS: RebateDaily[] = []

export function RebateDailyTable() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userID = useAuthStore((state) => state.auth.user?.id)
  const [filters, setFilters] = useState<Filters>({})
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const query = useQuery({
    queryKey: ['referral-rebates', userID, 'daily', filters, pagination],
    queryFn: () =>
      getDailyRebates(filters, pagination.pageIndex + 1, pagination.pageSize),
  })
  const columns = useMemo<ColumnDef<RebateDaily>[]>(
    () => [
      { accessorKey: 'day', header: t('Date') },
      {
        id: 'source',
        header: t('Recharge source'),
        cell: ({ row }) =>
          row.original.currency === 'QTA'
            ? t('Redemption code')
            : t('Online payment'),
      },
      {
        accessorKey: 'inviter_name',
        header: t('Rebate recipient'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.inviter_name}</TruncatedCell>
        ),
      },
      {
        id: 'paid_money',
        header: t('Recharge amount'),
        cell: ({ row }) =>
          formatRebatePayment(
            row.original.paid_money,
            row.original.currency,
            locale
          ),
      },
      {
        id: 'rebate_quota',
        header: t('Net rebate amount'),
        cell: ({ row }) =>
          formatQuotaWithCurrency(Number(row.original.rebate_quota), {
            locale,
            digitsLarge: 4,
            digitsSmall: 6,
            abbreviate: false,
          }),
      },
      {
        id: 'pending_quota',
        header: t('Pending rebate amount'),
        cell: ({ row }) =>
          formatQuotaWithCurrency(Number(row.original.pending_quota), {
            locale,
            digitsLarge: 4,
            digitsSmall: 6,
            abbreviate: false,
          }),
      },
      {
        accessorKey: 'count',
        header: t('Recharge count'),
        cell: ({ row }) => formatNumber(row.original.count, locale),
      },
    ],
    [t, locale]
  )
  const { table } = useDataTable({
    data: query.data?.items ?? EMPTY_DAYS,
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
    <div className='space-y-4 pt-4'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Daily totals use the rebate credit date in Beijing time (UTC+8). Reversals reduce net rebates on the reversal date.'
        )}
      </p>
      <RebateFilters
        admin
        onApply={(values) => {
          setFilters(values)
          setPagination((previous) => ({ ...previous, pageIndex: 0 }))
        }}
      />
      {query.isError ? (
        <ErrorState
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : (
        <>
          <div className='grid gap-3 md:grid-cols-2'>
            {query.data?.summary?.map((summary) => (
              <Card key={summary.currency}>
                <CardContent className='space-y-2 pt-4'>
                  <p className='font-medium'>
                    {t('Selected period totals')} ·{' '}
                    {summary.currency === 'QTA'
                      ? t('Redemption code')
                      : summary.currency || '-'}
                  </p>
                  <dl className='grid grid-cols-2 gap-2 text-sm'>
                    <dt>{t('Recharge amount')}</dt>
                    <dd>
                      {formatRebatePayment(
                        summary.paid_money,
                        summary.currency,
                        locale
                      )}
                    </dd>
                    <dt>{t('Net rebate amount')}</dt>
                    <dd>
                      {formatQuotaWithCurrency(Number(summary.rebate_quota), {
                        locale,
                        digitsLarge: 4,
                        digitsSmall: 6,
                        abbreviate: false,
                      })}
                    </dd>
                    <dt>{t('Pending rebate amount')}</dt>
                    <dd>
                      {formatQuotaWithCurrency(Number(summary.pending_quota), {
                        locale,
                        digitsLarge: 4,
                        digitsSmall: 6,
                        abbreviate: false,
                      })}
                    </dd>
                    <dt>{t('Rebate recipients')}</dt>
                    <dd>{formatNumber(summary.recipients, locale)}</dd>
                    <dt>{t('Recharge count')}</dt>
                    <dd>{formatNumber(summary.count, locale)}</dd>
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
          <DataTableView
            table={table}
            isLoading={query.isPending}
            containerProps={{ 'aria-busy': query.isPending }}
            emptyTitle={t('No recharge rebate records')}
            emptyDescription={t(
              'Records appear after an invited user completes a new recharge.'
            )}
            tableContainerClassName='overflow-x-auto'
          />
          {query.isSuccess && query.data.total > 0 && (
            <DataTablePagination table={table} compact />
          )}
        </>
      )}
    </div>
  )
}
