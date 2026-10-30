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

import { CopyButton } from '@/components/copy-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function AICodeQuickstart() {
  const { t } = useTranslation()
  const baseUrl = `${window.location.origin}/v1`
  const python = `from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="${baseUrl}",
)

response = client.chat.completions.create(
    model="YOUR_MODEL_ID",
    messages=[{"role": "user", "content": "Hello, AICode!"}],
)
print(response.choices[0].message.content)`
  const curl = `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "YOUR_MODEL_ID",
    "messages": [{"role": "user", "content": "Hello, AICode!"}]
  }'`

  return (
    <section
      className='aicode-integration'
      aria-labelledby='aicode-integration-title'
    >
      <div className='aicode-wrap aicode-integration-layout'>
        <div>
          <p className='aicode-eyebrow'>02 / {t('DEVELOPER FIRST')}</p>
          <h2 id='aicode-integration-title'>
            {t('A familiar API.')}
            <br />
            {t('A new starting point.')}
          </h2>
          <p className='aicode-description'>
            {t(
              'Keep your OpenAI SDK. Set your API key and base URL, then choose a model from the catalog.'
            )}
          </p>
          <ol className='aicode-steps'>
            <li>
              <span>01</span>
              {t('Create an account and an API key')}
            </li>
            <li>
              <span>02</span>
              {t('Choose an available model')}
            </li>
            <li>
              <span>03</span>
              {t('Send your first request')}
            </li>
          </ol>
          <div className='aicode-endpoint'>
            <span>BASE URL</span>
            <code>{baseUrl}</code>
            <CopyButton value={baseUrl} aria-label={t('Copy API base URL')} />
          </div>
        </div>
        <Tabs defaultValue='python' className='aicode-code-panel'>
          <div className='aicode-code-toolbar'>
            <TabsList aria-label={t('Code examples')} variant='line'>
              <TabsTrigger value='python'>Python</TabsTrigger>
              <TabsTrigger value='curl'>cURL</TabsTrigger>
            </TabsList>
            <span className='aicode-file-label'>AICode / quickstart</span>
          </div>
          {[
            { language: 'python', code: python },
            { language: 'curl', code: curl },
          ].map((example) => (
            <TabsContent key={example.language} value={example.language}>
              <div className='aicode-code-copy'>
                <CopyButton value={example.code} aria-label={t('Copy code')} />
              </div>
              <pre tabIndex={0} aria-label={example.language}>
                <code>{example.code}</code>
              </pre>
            </TabsContent>
          ))}
          <p className='aicode-code-note'>
            {t(
              'Replace YOUR_API_KEY and YOUR_MODEL_ID with your own values. Examples are not live requests.'
            )}
          </p>
        </Tabs>
      </div>
    </section>
  )
}
