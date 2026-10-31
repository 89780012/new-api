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
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DatePicker } from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { formatDateStr } from '@/lib/format'

import type { RebateFilters as Filters } from '../api'

const filterSchema = z
  .object({
    start: z.date().optional(),
    end: z.date().optional(),
    payer: z.string().regex(/^$|^[1-9]\d*$/, 'Invalid user ID'),
    inviter: z.string().regex(/^$|^[1-9]\d*$/, 'Invalid user ID'),
    status: z.string(),
  })
  .refine((value) => !value.start || !value.end || value.start <= value.end, {
    message: 'Choose a valid date range of at most 366 days',
    path: ['end'],
  })

type FilterValues = z.infer<typeof filterSchema>

export function RebateFilters(props: {
  admin?: boolean
  onApply: (filters: Filters) => void
}) {
  const { t } = useTranslation()
  const form = useForm<FilterValues>({
    resolver: zodResolver(filterSchema),
    defaultValues: { payer: '', inviter: '', status: '' },
  })
  return (
    <Form {...form}>
      <form
        className='flex flex-wrap items-end gap-3'
        onSubmit={form.handleSubmit((values) =>
          props.onApply({
            start_date: values.start ? formatDateStr(values.start) : undefined,
            end_date: values.end ? formatDateStr(values.end) : undefined,
            payer_id: values.payer || undefined,
            inviter_id: props.admin ? values.inviter || undefined : undefined,
            status: values.status || undefined,
          })
        )}
      >
        <FormField
          control={form.control}
          name='start'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Start date')}</FormLabel>
              <div role='group' aria-label={t('Start date')}>
                <DatePicker
                  selected={field.value}
                  onSelect={field.onChange}
                  placeholder={t('Start date')}
                />
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='end'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('End date')}</FormLabel>
              <div role='group' aria-label={t('End date')}>
                <DatePicker
                  selected={field.value}
                  onSelect={field.onChange}
                  placeholder={t('End date')}
                />
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='payer'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Recharging user ID')}</FormLabel>
              <FormControl>
                <Input {...field} className='w-36' inputMode='numeric' />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {props.admin && (
          <FormField
            control={form.control}
            name='inviter'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Rebate recipient ID')}</FormLabel>
                <FormControl>
                  <Input {...field} className='w-36' inputMode='numeric' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name='status'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Status')}</FormLabel>
              <FormControl>
                <NativeSelect {...field}>
                  <NativeSelectOption value=''>
                    {t('All statuses')}
                  </NativeSelectOption>
                  <NativeSelectOption value='credited'>
                    {t('Rebate credited')}
                  </NativeSelectOption>
                  <NativeSelectOption value='pending'>
                    {t('Rebate pending')}
                  </NativeSelectOption>
                  <NativeSelectOption value='review'>
                    {t('Rebate needs review')}
                  </NativeSelectOption>
                  <NativeSelectOption value='disabled'>
                    {t('Rebate disabled')}
                  </NativeSelectOption>
                  <NativeSelectOption value='zero'>
                    {t('No rebate amount')}
                  </NativeSelectOption>
                  <NativeSelectOption value='reversed'>
                    {t('Rebate reversed')}
                  </NativeSelectOption>
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit'>{t('Search')}</Button>
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            form.reset({
              payer: '',
              inviter: '',
              status: '',
              start: undefined,
              end: undefined,
            })
            props.onApply({})
          }}
        >
          {t('Reset')}
        </Button>
      </form>
    </Form>
  )
}
