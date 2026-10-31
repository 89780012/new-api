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
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { getChannelStatus } from './api'
import { MonitorCard } from './monitor-card'

export function ChannelStatusContent() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['channel-status'],
    queryFn: ({ signal }) => getChannelStatus(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    meta: { errorToast: false },
  })

  if (query.isPending) return <LoadingState />
  if (query.isError) {
    return (
      <ErrorState
        description={t('Channel status is temporarily unavailable')}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (!query.data.enabled) {
    return <EmptyState title={t('Channel status is not configured')} />
  }

  const healthy = query.data.items.every(
    (item) => item.primary_status === 'operational'
  )

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold'>{t('Channel Status')}</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Auto-refresh every 60 seconds')}
          </p>
        </div>
        <div className='flex items-center gap-3'>
          {query.data.items.length > 0 && (
            <Badge variant='secondary'>
              {healthy ? t('Operational') : t('Degraded')}
            </Badge>
          )}
          <Button
            variant='outline'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
      </div>
      {query.data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className='grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
          {query.data.items.map((item) => (
            <MonitorCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ChannelStatus() {
  return (
    <PublicLayout>
      <ChannelStatusContent />
    </PublicLayout>
  )
}
