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

import { AICodeQuickstart } from './aicode-quickstart'

interface AICodeLandingProps {
  isAuthenticated: boolean
}

export function AICodeLanding(props: AICodeLandingProps) {
  const { t } = useTranslation()

  return (
    <main id='content' className='aicode-landing'>
      <section className='aicode-hero' aria-labelledby='aicode-title'>
        <div className='aicode-grid' aria-hidden='true' />
        <div className='aicode-wrap aicode-hero-layout'>
          <div className='aicode-hero-copy'>
            <p className='aicode-eyebrow'>
              <span />
              {t('AI MODEL SERVICES · BUILT FOR DEVELOPERS')}
            </p>
            <div className='aicode-wordmark' aria-hidden='true'>
              AI<span>Code</span>
              <sup>✳</sup>
            </div>
            <h1 id='aicode-title'>
              <span className='sr-only'>AICode · </span>
              {t('Intelligence, connected.')}
              <br />
              <span>{t('Your next idea, powered.')}</span>
            </h1>
            <p className='aicode-description'>
              {t(
                'Your AI model provider. Connect coding, conversation and multimodal applications through one API, with usage and costs in your control.'
              )}
            </p>
            <div className='aicode-actions'>
              <Button
                size='lg'
                role='link'
                className='aicode-primary'
                render={
                  <Link
                    to={props.isAuthenticated ? '/dashboard' : '/sign-up'}
                  />
                }
              >
                {props.isAuthenticated
                  ? t('Go to Dashboard')
                  : t('Start building')}
                <span aria-hidden='true'>↗</span>
              </Button>
              <Button
                size='lg'
                role='link'
                variant='outline'
                className='aicode-secondary'
                render={<Link to='/pricing' />}
              >
                {t('Explore models')}
                <span aria-hidden='true'>→</span>
              </Button>
            </div>
            <div className='aicode-hero-notes'>
              <span>{t('OpenAI-compatible API')}</span>
              <span>{t('Usage-based billing')}</span>
            </div>
          </div>
          <div
            className='aicode-network'
            role='img'
            aria-label={t(
              'AICode connects your application to AI model services'
            )}
          >
            <div className='aicode-orbit aicode-orbit-outer' />
            <div className='aicode-orbit aicode-orbit-inner' />
            <svg
              className='aicode-wires'
              viewBox='0 0 480 480'
              fill='none'
              aria-hidden='true'
            >
              <path d='M240 240L90 105M240 240L390 150M240 240L95 350M240 240L370 375' />
              <circle cx='240' cy='240' r='157' strokeDasharray='2 12' />
            </svg>
            <div className='aicode-core'>
              <span>AI</span>
              <small>AICode</small>
            </div>
            <div className='aicode-node aicode-node-code'>
              <span>⌘</span>
              {t('Code')}
            </div>
            <div className='aicode-node aicode-node-chat'>
              <span>↗</span>
              {t('Reasoning')}
            </div>
            <div className='aicode-node aicode-node-vision'>
              <span>◎</span>
              {t('Vision')}
            </div>
            <div className='aicode-node aicode-node-app'>
              <span>⟡</span>
              {t('Your application')}
            </div>
            <div className='aicode-network-caption'>
              <span aria-hidden='true'>✳</span>{' '}
              {t('ONE ENDPOINT. MORE POSSIBILITIES.')}
            </div>
          </div>
        </div>
        <div className='aicode-wrap aicode-protocol-strip'>
          <span>{t('ONE API / MULTIPLE MODEL FAMILIES')}</span>
          <div>
            <span>GPT</span>
            <span>Claude</span>
            <span>Gemini</span>
            <span>DeepSeek</span>
            <span>Qwen</span>
          </div>
          <p>{t('Model availability and pricing follow the live catalog.')}</p>
        </div>
      </section>

      <section
        className='aicode-wrap aicode-capabilities'
        aria-labelledby='aicode-capabilities-title'
      >
        <div className='aicode-section-heading'>
          <p className='aicode-eyebrow'>01 / {t('MODEL CAPABILITIES')}</p>
          <h2 id='aicode-capabilities-title'>
            {t('From first prompt to real product.')}
          </h2>
          <p>
            {t(
              'Choose the right model for the work. Keep one familiar integration.'
            )}
          </p>
        </div>
        <div className='aicode-card-grid'>
          <Link to='/pricing' className='aicode-capability'>
            <div className='aicode-card-top'>
              <span className='aicode-card-symbol' aria-hidden='true'>
                &lt;/&gt;
              </span>
              <span>01 — CODE</span>
              <span aria-hidden='true'>↗</span>
            </div>
            <h3>{t('Build with intelligence')}</h3>
            <p>
              {t(
                'Bring AI into your development workflow, from code generation to debugging and technical reasoning.'
              )}
            </p>
            <div className='aicode-mini-code' aria-hidden='true'>
              <span>const</span> idea = <span>await</span> ai.create();
              <br />
              <span>//</span> build what comes next
              <span className='aicode-cursor'>▍</span>
            </div>
          </Link>
          <Link to='/pricing' className='aicode-capability'>
            <div className='aicode-card-top'>
              <span className='aicode-card-symbol' aria-hidden='true'>
                ✳
              </span>
              <span>02 — REASON</span>
              <span aria-hidden='true'>↗</span>
            </div>
            <h3>{t('Think beyond the prompt')}</h3>
            <p>
              {t(
                'Power assistants, knowledge tools and complex workflows with conversation and reasoning models.'
              )}
            </p>
            <div className='aicode-signal' aria-hidden='true'>
              {[...'abcdefghijklmnopqrstuvwx'].map((bar) => (
                <i key={bar} />
              ))}
            </div>
          </Link>
          <Link to='/pricing' className='aicode-capability'>
            <div className='aicode-card-top'>
              <span className='aicode-card-symbol' aria-hidden='true'>
                ◎
              </span>
              <span>03 — CREATE</span>
              <span aria-hidden='true'>↗</span>
            </div>
            <h3>{t('Go beyond text')}</h3>
            <p>
              {t(
                'Explore image understanding and generation models for richer, multimodal experiences.'
              )}
            </p>
            <div className='aicode-spectrum' aria-hidden='true'>
              <i />
              <i />
              <i />
            </div>
          </Link>
        </div>
      </section>

      <AICodeQuickstart />

      <section
        className='aicode-wrap aicode-final'
        aria-labelledby='aicode-final-title'
      >
        <div>
          <p className='aicode-eyebrow'>03 / {t('YOUR NEXT BUILD')}</p>
          <h2 id='aicode-final-title'>{t('Less friction. More creation.')}</h2>
          <p>
            {t('Find your model. Connect your application. Make it happen.')}
          </p>
        </div>
        <Button
          size='lg'
          role='link'
          className='aicode-primary'
          render={
            <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
          }
        >
          {props.isAuthenticated ? t('Go to Dashboard') : t('Start building')}
          <span aria-hidden='true'>↗</span>
        </Button>
      </section>
    </main>
  )
}
