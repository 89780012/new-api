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

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { RebateLedger } from './components/rebate-ledger'
import { InvitedUsers } from './invited-users'

export function Referrals() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('My invited users')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs defaultValue='rebates' className='p-3 sm:p-4'>
          <TabsList>
            <TabsTrigger value='rebates'>
              {t('Recharge rebate details')}
            </TabsTrigger>
            <TabsTrigger value='users'>{t('Invited users')}</TabsTrigger>
          </TabsList>
          <TabsContent value='rebates'>
            <RebateLedger />
          </TabsContent>
          <TabsContent value='users'>
            <InvitedUsers />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
