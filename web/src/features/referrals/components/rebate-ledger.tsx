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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTablePagination,
  DataTableView,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  getRebates,
  retryRebate,
  reverseRebate,
  type RebateEntry,
  type RebateFilters as Filters,
} from '../api'
import { formatRebatePayment, formatRebateTimestamp } from '../money'
import { RebateFilters } from './rebate-filters'
import { RebateStatus } from './rebate-status'

const EMPTY_ENTRIES: RebateEntry[] = []

export function RebateLedger(props: { admin?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userID = useAuthStore((state) => state.auth.user?.id)
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const canManage = Boolean(props.admin && role >= ROLE.SUPER_ADMIN)
  const [filters, setFilters] = useState<Filters>({})
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [reversing, setReversing] = useState<RebateEntry | null>(null)
  const [reason, setReason] = useState('')
  const client = useQueryClient()
  const query = useQuery({
    queryKey: [
      'referral-rebates',
      userID,
      props.admin ? 'admin' : 'self',
      filters,
      pagination,
    ],
    queryFn: () =>
      getRebates(
        Boolean(props.admin),
        filters,
        pagination.pageIndex + 1,
        pagination.pageSize
      ),
    enabled: userID != null,
  })
  const retry = useMutation({
    mutationFn: retryRebate,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['referral-rebates'] }),
  })
  const reverse = useMutation({
    mutationFn: (entry: { id: number; reason: string }) =>
      reverseRebate(entry.id, entry.reason),
    onSuccess: () => {
      setReversing(null)
      void client.invalidateQueries({ queryKey: ['referral-rebates'] })
    },
  })
  const columns = useMemo<ColumnDef<RebateEntry>[]>(() => {
    const columns: ColumnDef<RebateEntry>[] = [
      {
        accessorKey: 'created_at',
        header: t('Recharge date'),
        cell: ({ row }) =>
          formatRebateTimestamp(row.original.created_at, locale),
      },
      {
        accessorKey: 'payer_name',
        header: t('Recharging user'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.payer_name}</TruncatedCell>
        ),
      },
      {
        id: 'source',
        header: t('Recharge source'),
        cell: ({ row }) =>
          row.original.currency === 'QTA'
            ? t('Redemption code')
            : t('Online payment'),
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
        accessorKey: 'rate_bps',
        header: t('Rebate rate'),
        cell: ({ row }) =>
          `${formatNumber(row.original.rate_bps / 100, locale)}%`,
      },
      {
        accessorKey: 'rebate_quota',
        header: t('Rebate amount'),
        cell: ({ row }) =>
          formatQuotaWithCurrency(row.original.rebate_quota, {
            locale,
            digitsLarge: 4,
            digitsSmall: 6,
            abbreviate: false,
          }),
      },
      {
        accessorKey: 'balance_before',
        header: t('Balance before rebate'),
        cell: ({ row }) =>
          formatQuotaWithCurrency(row.original.balance_before, {
            locale,
            digitsLarge: 4,
            digitsSmall: 6,
            abbreviate: false,
          }),
      },
      {
        accessorKey: 'balance_after',
        header: t('Balance after rebate'),
        cell: ({ row }) =>
          formatQuotaWithCurrency(row.original.balance_after, {
            locale,
            digitsLarge: 4,
            digitsSmall: 6,
            abbreviate: false,
          }),
      },
      {
        accessorKey: 'credited_at',
        header: t('Rebate credited at'),
        cell: ({ row }) =>
          formatRebateTimestamp(row.original.credited_at, locale),
      },
      {
        id: 'kind',
        header: t('Type'),
        cell: ({ row }) =>
          row.original.kind === 'reversal'
            ? t('Rebate reversal')
            : t('Recharge rebate'),
      },
      {
        id: 'status',
        header: t('Status'),
        cell: ({ row }) => <RebateStatus entry={row.original} />,
      },
      {
        accessorKey: 'trade_no',
        header: t('Order number'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.trade_no}</TruncatedCell>
        ),
      },
    ]
    if (props.admin) {
      columns.splice(1, 0, {
        accessorKey: 'inviter_name',
        header: t('Rebate recipient'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.inviter_name}</TruncatedCell>
        ),
      })
    }
    if (canManage) {
      columns.push({
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <div className='flex gap-2'>
            {row.original.status === 'pending' && (
              <Button
                size='sm'
                variant='outline'
                disabled={retry.isPending}
                onClick={() => retry.mutate(row.original.id)}
              >
                {t('Retry rebate')}
              </Button>
            )}
            {row.original.kind === 'rebate' &&
              row.original.status === 'credited' && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => {
                    setReason('')
                    setReversing(row.original)
                  }}
                >
                  {t('Reverse rebate')}
                </Button>
              )}
          </div>
        ),
      })
    }
    return columns
  }, [t, locale, props.admin, canManage, retry])
  const { table } = useDataTable({
    data: query.data?.items ?? EMPTY_ENTRIES,
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
          'Each recharge is recorded separately, including redemption codes. Code rebates use the redeemed wallet amount; online rebates use the actual payment. Balance snapshots show the inviter wallet before and after the rebate.'
        )}
      </p>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Dates use Beijing time (UTC+8), based on credit date for credited rebates and recharge date for pending rebates. The default range is 31 days. Historical completed orders are not rebated retroactively.'
        )}
      </p>
      <RebateFilters
        admin={props.admin}
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
      <ConfirmDialog
        open={reversing != null}
        onOpenChange={(open) => {
          if (!open) setReversing(null)
        }}
        title={t('Reverse rebate')}
        desc={t(
          'Deduct this rebate from the recipient wallet and keep a separate reversal record. The original recharge is unchanged.'
        )}
        confirmText={t('Reverse rebate')}
        destructive
        isLoading={reverse.isPending}
        disabled={!reason.trim()}
        handleConfirm={() => {
          if (reversing) {
            reverse.mutate({ id: reversing.id, reason: reason.trim() })
          }
        }}
      >
        <Label htmlFor='rebate-reversal-reason'>{t('Reversal reason')}</Label>
        <Textarea
          id='rebate-reversal-reason'
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>
    </div>
  )
}
