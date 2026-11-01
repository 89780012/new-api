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
import { useMutation } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect } from 'react'
import { useForm, useFormContext, useFormState } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { markServerErrorHandled } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  getServerErrorStatus,
} from '@/lib/server-error-message'

import { sendTestEmail } from '../api'
import { SettingsControlGroup } from '../components/settings-form-layout'
import type { EmailFormValues } from './email-settings-schema'

type EmailTestValues = { recipient: string }

export function EmailTestSection(props: {
  provider: string
  isSaving: boolean
}) {
  const { t } = useTranslation()
  const settings = useFormContext<EmailFormValues>()
  const { dirtyFields } = useFormState({ control: settings.control })
  const configurationDirty = Object.keys(dirtyFields).some(
    (key) =>
      key === 'EmailProvider' ||
      key.startsWith('SMTP') ||
      key.startsWith('Resend')
  )
  const form = useForm<EmailTestValues>({
    resolver: zodResolver(
      z.object({
        recipient: z
          .string()
          .trim()
          .pipe(z.email(t('Invalid email address')).max(254)),
      })
    ),
    defaultValues: { recipient: '' },
  })
  const mutation = useMutation({
    mutationFn: sendTestEmail,
    retry: false,
    meta: { errorToast: false },
    onError: markServerErrorHandled,
  })
  const resetTestResult = mutation.reset
  const isSending = mutation.isPending
  useEffect(() => {
    if (configurationDirty && !isSending) resetTestResult()
  }, [configurationDirty, isSending, resetTestResult])
  const status = getServerErrorStatus(mutation.error)
  let errorMessage = getServerErrorMessage(mutation.error)
  if (status === 429) {
    errorMessage = t('Too many requests')
  } else if (isAxiosError(mutation.error) && !status) {
    errorMessage = t(
      'Email delivery could not be confirmed. Check the inbox before sending again.'
    )
  }
  const disabled =
    props.isSaving ||
    configurationDirty ||
    mutation.isPending ||
    form.formState.isSubmitting
  const submit = form.handleSubmit(async (values) => {
    if (disabled) return
    try {
      await mutation.mutateAsync(values)
    } catch {
      // The result is displayed inline, without a duplicate toast.
    }
  })

  return (
    <SettingsControlGroup className='space-y-4 p-4'>
      <div className='space-y-1'>
        <h3 className='text-sm font-medium'>{t('Send test email')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Send a test email to one recipient using the saved email configuration.'
          )}
        </p>
        <p className='text-muted-foreground text-sm'>
          {t('Email sending method')}:{' '}
          {props.provider === 'resend' ? 'Resend API' : 'SMTP'}
        </p>
      </div>
      <Form {...form}>
        <FormField
          control={form.control}
          name='recipient'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Recipient email address')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  inputMode='email'
                  autoComplete='email'
                  placeholder='someone@example.com'
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    field.onChange(event)
                    mutation.reset()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      void submit()
                    }
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
      {configurationDirty && (
        <p className='text-muted-foreground text-sm' role='status'>
          {t('Email configuration has changed. Save it before testing.')}
        </p>
      )}
      <Button
        type='button'
        variant='outline'
        disabled={disabled}
        onClick={() => void submit()}
        aria-busy={mutation.isPending}
      >
        {mutation.isPending ? t('Sending test email...') : t('Send test email')}
      </Button>
      {!configurationDirty && !props.isSaving && mutation.isSuccess && (
        <Alert role='status'>
          <AlertDescription>
            {t(
              'The mail service accepted the request. Check the inbox or spam folder.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {!configurationDirty && !props.isSaving && mutation.isError && (
        <Alert variant='destructive'>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
    </SettingsControlGroup>
  )
}
