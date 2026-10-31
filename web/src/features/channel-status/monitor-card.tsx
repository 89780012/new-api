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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ChannelStatusItem } from './api'

// Unknown/pending states remain visibly distinct from a successful check.
const monitorStates: Record<string, { label: string; color: string }> = {
  operational: { label: 'Operational', color: 'bg-emerald-500' },
  degraded: { label: 'Degraded', color: 'bg-amber-500' },
  failed: { label: 'Failed', color: 'bg-red-500' },
  error: { label: 'Error', color: 'bg-red-500' },
}

export function MonitorCard(props: { item: ChannelStatusItem }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const item = props.item
  const state = monitorStates[item.primary_status] ?? {
    label: 'Unknown',
    color: 'bg-slate-400',
  }

  return (
    <Card className='min-w-0'>
      <CardHeader>
        <CardTitle className='truncate' title={item.name}>
          {item.name}
        </CardTitle>
        <CardDescription className='truncate' title={item.primary_model}>
          {item.provider} · {item.primary_model || '—'}
        </CardDescription>
        <CardAction>
          <Badge variant='secondary'>
            <span
              aria-hidden='true'
              className={cn('size-2 rounded-full', state.color)}
            />
            {t(state.label)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-5'>
        <dl className='grid grid-cols-2 gap-3'>
          <div className='bg-muted/40 min-w-0 rounded-lg border p-3'>
            <dt className='text-muted-foreground text-xs'>
              {t('Conversation latency')}
            </dt>
            <dd className='mt-2 font-mono font-semibold'>
              {formatNumber(item.primary_latency_ms, locale)}{' '}
              <span className='text-muted-foreground text-xs'>ms</span>
            </dd>
          </div>
          <div className='bg-muted/40 min-w-0 rounded-lg border p-3'>
            <dt className='text-muted-foreground text-xs'>
              {t('Endpoint ping')}
            </dt>
            <dd className='mt-2 font-mono font-semibold'>
              {formatNumber(item.primary_ping_latency_ms, locale)}{' '}
              <span className='text-muted-foreground text-xs'>ms</span>
            </dd>
          </div>
        </dl>
        <div className='flex items-center justify-between gap-3 border-y py-3'>
          <span className='text-muted-foreground text-sm'>
            {t('Availability · 7 days')}
          </span>
          <span className='text-2xl font-bold tabular-nums'>
            {formatNumber(item.availability_7d, locale)}%
          </span>
        </div>
        <div className='space-y-2'>
          <p className='text-muted-foreground text-xs'>
            {t('Recent 60 checks')}
          </p>
          {item.timeline.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('No Data')}</p>
          ) : (
            <div
              role='list'
              aria-label={t('Recent 60 checks')}
              className='flex h-6 items-end gap-0.5'
            >
              {item.timeline.map((point) => {
                const pointState = monitorStates[point.status] ?? {
                  label: 'Unknown',
                  color: 'bg-slate-400',
                }
                const label = `${t(pointState.label)} · ${point.checked_at} · ${formatNumber(point.latency_ms, locale)} ms`
                return (
                  <span
                    key={point.checked_at}
                    role='listitem'
                    aria-label={label}
                    title={label}
                    className={cn(
                      'h-full min-w-0 flex-1 rounded-sm',
                      pointState.color
                    )}
                  />
                )
              })}
            </div>
          )}
          <div className='text-muted-foreground flex justify-between text-xs'>
            <span>{t('Past')}</span>
            <span>{t('Now')}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
