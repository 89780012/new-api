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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
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
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getRebatePolicy, saveRebatePolicy, type RebatePolicy } from '../api'

const policySchema = z
  .object({
    enabled: z.boolean(),
    rate: z
      .number({
        error:
          'Rebate rate must be greater than 0% and at most 100% when enabled',
      })
      .min(
        0,
        'Rebate rate must be greater than 0% and at most 100% when enabled'
      )
      .max(
        100,
        'Rebate rate must be greater than 0% and at most 100% when enabled'
      )
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.0000001,
        'Use at most two decimal places'
      ),
  })
  .refine((value) => !value.enabled || value.rate > 0, {
    message:
      'Rebate rate must be greater than 0% and at most 100% when enabled',
    path: ['rate'],
  })
type PolicyValues = z.infer<typeof policySchema>

export function RebateSettings() {
  const query = useQuery({
    queryKey: ['referral-rebates', 'settings'],
    queryFn: getRebatePolicy,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  return <RebatePolicyForm key={query.data.version} policy={query.data} />
}

function RebatePolicyForm(props: { policy: RebatePolicy }) {
  const { t } = useTranslation()
  const canManage = useAuthStore(
    (state) => (state.auth.user?.role ?? 0) >= ROLE.SUPER_ADMIN
  )
  const client = useQueryClient()
  const form = useForm<PolicyValues>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      enabled: props.policy.enabled,
      rate: props.policy.rate_bps / 100,
    },
  })
  const mutation = useMutation({
    mutationFn: saveRebatePolicy,
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      void client.invalidateQueries({
        queryKey: ['referral-rebates', 'settings'],
      })
    },
  })
  return (
    <Form {...form}>
      <form
        className='max-w-2xl space-y-5 pt-4'
        onSubmit={form.handleSubmit((values) =>
          mutation.mutate({
            enabled: values.enabled,
            rate_bps: Math.round(values.rate * 100),
          })
        )}
      >
        <FormField
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <SettingsSwitchField
              controlId='enable-recharge-rebates'
              label={t('Enable recharge rebates')}
              description={t(
                'Every online payment or redemption code recharge by a directly invited user rewards the inviter. Code rebates use the redeemed wallet amount. Registration gifts and other balance grants are excluded.'
              )}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!canManage || mutation.isPending}
            />
          )}
        />
        <FormField
          control={form.control}
          name='rate'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Rebate rate (%)')}</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={0}
                  max={100}
                  step={0.01}
                  className='max-w-48'
                  value={Number.isNaN(field.value) ? '' : field.value}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  onChange={(event) =>
                    field.onChange(event.target.valueAsNumber)
                  }
                  disabled={!canManage || mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className='text-muted-foreground text-sm'>
          {t(
            'The rate is captured when a recharge first succeeds. Existing records keep their original rate. Rebates are credited directly to the inviter wallet and never generate further rebates.'
          )}
        </p>
        {!canManage && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'Only super administrators can change rebate settings or reverse rebates.'
            )}
          </p>
        )}
        <Button type='submit' disabled={!canManage || mutation.isPending}>
          {mutation.isPending ? t('Saving...') : t('Save')}
        </Button>
      </form>
    </Form>
  )
}
