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

import type { RebateEntry } from '../api'

export function RebateStatus(props: { entry: RebateEntry }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    credited: t('Rebate credited'),
    pending: t('Rebate pending'),
    review: t('Rebate needs review'),
    disabled: t('Rebate disabled'),
    zero: t('No rebate amount'),
    reversed: t('Rebate reversed'),
  }
  return (
    <div className='space-y-1'>
      <Badge variant='outline'>
        {labels[props.entry.status] ?? props.entry.status}
      </Badge>
      {props.entry.reason && (
        <p className='text-muted-foreground max-w-48 text-xs'>
          {t(props.entry.reason)}
        </p>
      )}
    </div>
  )
}
