'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { LanguageCode, Result } from '@aws-sdk/client-transcribe-streaming'
import { signIn, signOut, useSession } from 'next-auth/react'

import { MicrophonesSelection } from '@/components/microphones-selection'
import { SAMPLE_RATE, startTranscribe } from '@/lib/stream'

type AudioInputs = {
  A: MediaDeviceInfo
  B: MediaDeviceInfo
}

const languageCodes: LanguageCode[] = [
  'en-US',
  'en-GB',
  'es-US',
  'fr-CA',
  'fr-FR',
  'en-AU',
  'it-IT',
  'de-DE',
  'pt-BR',
  'ja-JP',
  'ko-KR',
  'zh-CN',
  'th-TH',
  'es-ES',
  'ar-SA',
  'pt-PT',
  'ca-ES',
  'ar-AE',
  'hi-IN',
  'zh-HK',
  'nl-NL',
  'no-NO',
  'sv-SE',
  'pl-PL',
  'fi-FI',
  'zh-TW',
  'en-IN',
  'en-IE',
  'en-NZ',
  'en-AB',
  'en-ZA',
  'en-WL',
  'de-CH',
  'af-ZA',
  'eu-ES',
  'hr-HR',
  'cs-CZ',
  'da-DK',
  'fa-IR',
  'gl-ES',
  'el-GR',
  'he-IL',
  'id-ID',
  'lv-LV',
  'ms-MY',
  'ro-RO',
  'ru-RU',
  'sr-RS',
  'sk-SK',
  'so-SO',
  'tl-PH',
  'uk-UA',
  'vi-VN',
  'zu-ZA',
]

export default function Home() {
  const { data: session, status } = useSession()
  const isSessionLoading = status === 'loading'
  const isAuthenticated = status === 'authenticated'
  const idToken = session?.cognito_id_token

  const [audioInputs, setAudioInputs] = useState<AudioInputs>()
  const [transcriptResults, setTranscriptResults] = useState<Result[]>([])
  const [streams, setStreams] = useState<MediaStream[]>()
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string>()
  const [language, setLanguage] = useState<LanguageCode>(languageCodes[0])
  const startTimeRef = useRef(Date.now())

  const handleAudioInputs = useCallback((inputs: { A?: MediaDeviceInfo; B?: MediaDeviceInfo }) => {
    if (inputs.A && inputs.B) {
      setAudioInputs({ A: inputs.A, B: inputs.B })
    } else {
      setAudioInputs(undefined)
    }
  }, [])

  const handleLogin = useCallback(() => {
    void signIn('cognito')
  }, [signIn])

  const handleLogout = useCallback(() => {
    void signOut()
  }, [signOut])

  const displayName = useMemo(() => {
    if (!session?.user) {
      return undefined
    }

    return session.user.name ?? session.user.email ?? undefined
  }, [session])

  const getMediaStreams = useCallback(async (devices: MediaDeviceInfo[]) => {
    if (!devices.length || devices.length > 2) {
      throw new Error('Expected max two devices/inputs')
    }

    const streams: MediaStream[] = []

    for (const device of devices) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: device.deviceId,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      console.log('Using mic: ', device.label)
      if (stream) {
        streams.push(stream)
      }
    }

    if (streams.length) {
      return streams
    }

    throw new Error('Recording device not found for mediaStream')
  }, [])

  const stop = useCallback(() => {
    if (!streams?.length) return

    for (const stream of streams) {
      for (const track of stream.getAudioTracks()) {
        track.stop()
      }
    }

    setStreams(undefined)
    setStarted(false)
  }, [streams])

  const start = useCallback(async () => {
    if (!audioInputs?.A || !audioInputs?.B) {
      return
    }

    if (!idToken) {
      setError('Missing Cognito ID token. Please sign in again.')
      if (!isAuthenticated) {
        void signIn('cognito')
      }
      return
    }

    let mediaStreams: MediaStream[] | undefined

    try {
      setTranscriptResults([])
      setError(undefined)
      startTimeRef.current = Date.now()

      mediaStreams = await getMediaStreams([audioInputs.A, audioInputs.B])
      setStreams(mediaStreams)
      setStarted(true)

      await startTranscribe(
        mediaStreams,
        language,
        (result) => {
          setTranscriptResults((current) => [...current, result])
        },
        { idToken },
      )
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An unexpected error occurred while starting the transcription')
      }
      console.error(err)
    } finally {
      if (mediaStreams) {
        for (const stream of mediaStreams) {
          for (const track of stream.getAudioTracks()) {
            track.stop()
          }
        }
      }
      setStreams(undefined)
      setStarted(false)
    }
  }, [audioInputs, getMediaStreams, idToken, isAuthenticated, language, signIn])

  const dataA = useMemo(
    () => transcriptResults.filter((entry) => entry.ChannelId === 'ch_0' && !entry.IsPartial),
    [transcriptResults],
  )
  const dataB = useMemo(
    () => transcriptResults.filter((entry) => entry.ChannelId === 'ch_1' && !entry.IsPartial),
    [transcriptResults],
  )

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-slate-900">Authentication</h2>
          {isSessionLoading ? (
            <p className="text-sm text-slate-600">Checking authentication status…</p>
          ) : isAuthenticated ? (
            <p className="text-sm text-slate-600">
              Signed in{displayName ? ` as ${displayName}` : ''}. You can start a transcription
              session below.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Sign in with Amazon Cognito to personalize your experience.
            </p>
          )}
          {isAuthenticated && !idToken ? (
            <p className="text-sm text-red-600">
              We could not read your Cognito ID token. Please sign out and sign in again.
            </p>
          ) : null}
          {error && !started ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex flex-wrap gap-3">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-300"
            >
              Sign out
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLogin}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              Sign in with Amazon Cognito
            </button>
          )}
        </div>

        {session?.user ? (
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 group-open:text-slate-900">
              View user attributes
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
              {JSON.stringify(session.user, null, 2)}
            </pre>
          </details>
        ) : null}
      </section>

      <h1 className="text-3xl font-semibold">
        Streaming multi-channel audio to Amazon Transcribe using the Web Audio API
      </h1>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="flex flex-col gap-6">
          <MicrophonesSelection
            disabled={started || !isAuthenticated}
            onAudioInputs={handleAudioInputs}
          />

          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              <span>Language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as LanguageCode)}
                disabled={started || !isAuthenticated}
                className="rounded-md border border-slate-300 px-3 py-2 text-base shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {languageCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-sm text-slate-600">Sample Rate: {SAMPLE_RATE}</div>

            {!isAuthenticated ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Please sign in to use the transcription feature.
              </div>
            ) : null}

            <div className="flex gap-3">
              {!started && audioInputs ? (
                <button
                  type="button"
                  onClick={start}
                  disabled={!isAuthenticated}
                  className="flex-1 rounded-md bg-sky-600 px-4 py-2 text-base font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Start Transcription
                </button>
              ) : null}

              {started ? (
                <button
                  type="button"
                  onClick={stop}
                  className="flex-1 rounded-md bg-red-600 px-4 py-2 text-base font-semibold text-white shadow-sm transition hover:bg-red-700"
                >
                  Stop Transcription
                </button>
              ) : null}
            </div>
          </div>

          {error && started ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Error: {error}
            </div>
          ) : null}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {started && audioInputs ? (
              <p className="text-lg font-semibold">
                Channel 0 - {audioInputs.A.label || 'Microphone A'}
              </p>
            ) : null}
            {dataA.map((entry, index) => (
              <p key={`${entry.ResultId}-${index}`} className="text-sm leading-relaxed">
                {entry.EndTime
                  ? new Date(
                      startTimeRef.current + Math.round(entry.EndTime * 1000),
                    ).toLocaleTimeString()
                  : 0}
                {' -> '}
                {entry.Alternatives?.[0]?.Transcript ?? ''}
              </p>
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {started && audioInputs ? (
              <p className="text-lg font-semibold">
                Channel 1 - {audioInputs.B.label || 'Microphone B'}
              </p>
            ) : null}
            {dataB.map((entry, index) => (
              <p key={`${entry.ResultId}-${index}`} className="text-sm leading-relaxed">
                {entry.EndTime
                  ? new Date(
                      startTimeRef.current + Math.round(entry.EndTime * 1000),
                    ).toLocaleTimeString()
                  : 0}
                {' -> '}
                {entry.Alternatives?.[0]?.Transcript ?? ''}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
