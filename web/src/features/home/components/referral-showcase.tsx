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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function ReferralShowcase(props: { isAuthenticated: boolean }) {
  const { t } = useTranslation()

  return (
    <section
      className='aicode-wrap py-12 sm:py-16'
      aria-labelledby='referral-title'
    >
      <Card className='aicode-referral-surface border-primary/20 gap-8 border py-6 shadow-none sm:py-10'>
        <CardContent className='grid min-w-0 gap-8 px-6 sm:px-10 lg:grid-cols-2 lg:items-center'>
          <div className='min-w-0'>
            <p className='aicode-eyebrow'>{t('Referral Program')}</p>
            <h2
              id='referral-title'
              className='mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl'
            >
              {t('Invite friends. Earn recharge rebates.')}
            </h2>
            <p className='text-muted-foreground mt-4 text-sm leading-7'>
              {t(
                'When enabled, eligible recharges by friends who registered through your link earn rebates credited to your wallet.'
              )}
            </p>
            <div className='mt-6 flex flex-wrap gap-3'>
              <Button
                size='lg'
                role='link'
                className='h-auto min-h-11 whitespace-normal'
                render={
                  <Link to={props.isAuthenticated ? '/wallet' : '/sign-up'} />
                }
              >
                {props.isAuthenticated
                  ? t('Get my referral link')
                  : t('Join the referral program')}
                <span aria-hidden='true'>↗</span>
              </Button>
              {props.isAuthenticated && (
                <Button
                  size='lg'
                  role='link'
                  variant='outline'
                  className='h-auto min-h-11 whitespace-normal'
                  render={<Link to='/referrals' />}
                >
                  {t('Recharge rebate details')}
                </Button>
              )}
            </div>
          </div>
          <ol className='grid min-w-0 gap-5'>
            <li className='flex gap-4'>
              <span
                aria-hidden='true'
                className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-sm'
              >
                01
              </span>
              <div>
                <h3 className='font-semibold'>
                  {t('Share your referral link')}
                </h3>
                <p className='text-muted-foreground mt-1 text-sm leading-6'>
                  {t(
                    'Find your personal referral link in your wallet and share it with friends.'
                  )}
                </p>
              </div>
            </li>
            <li className='flex gap-4'>
              <span
                aria-hidden='true'
                className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-sm'
              >
                02
              </span>
              <div>
                <h3 className='font-semibold'>
                  {t('Friends register and recharge')}
                </h3>
                <p className='text-muted-foreground mt-1 text-sm leading-6'>
                  {t(
                    'Eligible online payments and redemption code recharges can earn rebates.'
                  )}
                </p>
              </div>
            </li>
            <li className='flex gap-4'>
              <span
                aria-hidden='true'
                className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-sm'
              >
                03
              </span>
              <div>
                <h3 className='font-semibold'>
                  {t('Track rebates in your account')}
                </h3>
                <p className='text-muted-foreground mt-1 text-sm leading-6'>
                  {t(
                    'View each recharge rebate and its status in My invited users.'
                  )}
                </p>
              </div>
            </li>
          </ol>
        </CardContent>
        <CardContent className='border-border border-t px-6 pt-5 sm:px-10'>
          <p className='text-muted-foreground text-xs leading-6'>
            {t(
              'Rebates depend on the active program settings. Registration gifts and other balance grants are excluded.'
            )}
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
