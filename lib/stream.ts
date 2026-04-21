import {
  BadRequestException,
  type LanguageCode,
  MediaEncoding,
  type Result,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
} from '@aws-sdk/client-transcribe-streaming'
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers'
import { pEventIterator } from 'p-event'

export const SAMPLE_RATE =
  typeof window !== 'undefined' && window.navigator.userAgent.includes('Firefox') ? 44100 : 16000

type AudioWorkletMessageDataType = {
  message: string
  buffer: Array<Float32Array>
  recordingLength: number
  audioData: Uint8Array
}

type AudioInputs = {
  audioDataIterator: AsyncIterableIterator<MessageEvent<AudioWorkletMessageDataType>>
  audioWorkletNode: AudioWorkletNode
  audioContext: AudioContext
}

async function getAudioIterator(mediaStreams: MediaStream[]): Promise<AudioInputs> {
  const audioContext = new AudioContext({
    sampleRate: SAMPLE_RATE,
  })

  try {
    await audioContext.audioWorklet.addModule('/worklets/recording-processor.js')
  } catch (error) {
    console.error('Failed to load audio worklet', error)
  }

  const sourceA = audioContext.createMediaStreamSource(mediaStreams[0])
  const sourceB = audioContext.createMediaStreamSource(mediaStreams[1])

  const merger = audioContext.createChannelMerger(2)

  sourceA.connect(merger, 0, 0)
  sourceB.connect(merger, 0, 1)

  const audioWorkletNode = new AudioWorkletNode(audioContext, 'recording-processor', {
    channelCountMode: 'explicit',
    numberOfInputs: 1,
    outputChannelCount: [2],
    numberOfOutputs: 1,
    processorOptions: {
      numberOfChannels: 2,
      sampleRate: SAMPLE_RATE,
      maxFrameCount: (SAMPLE_RATE * 4) / 10,
    },
  })

  audioWorkletNode.port.postMessage({
    message: 'UPDATE_RECORDING_STATE',
    setRecording: true,
  })

  audioWorkletNode.port.onmessageerror = (error) => {
    console.error('Error from audio worklet', error)
  }

  audioWorkletNode.port.onmessage = () => {
    // Required for Firefox compatibility
  }

  merger.connect(audioWorkletNode)

  const audioDataIterator = pEventIterator<'message', MessageEvent<AudioWorkletMessageDataType>>(
    audioWorkletNode.port,
    'message',
    { resolutionEvents: ['STOP_RECORDING_BUFFER'] },
  )

  return { audioDataIterator, audioWorkletNode, audioContext }
}

function getRegion(): string {
  const region = process.env.NEXT_PUBLIC_AWS_REGION
  if (!region) {
    throw new Error('Missing environment variable: NEXT_PUBLIC_AWS_REGION')
  }
  return region
}

function getIdentityPoolId(): string {
  const identityPoolId = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID
  if (!identityPoolId) {
    throw new Error('Missing environment variable: NEXT_PUBLIC_IDENTITY_POOL_ID')
  }
  return identityPoolId
}

function getUserPoolId(): string {
  const userPoolId = process.env.NEXT_PUBLIC_USER_POOL_ID
  if (!userPoolId) {
    throw new Error('Missing environment variable: NEXT_PUBLIC_USER_POOL_ID')
  }
  return userPoolId
}

function createTranscribeClient(idToken: string) {
  const region = getRegion()
  const identityPoolId = getIdentityPoolId()
  const userPoolId = getUserPoolId()

  return new TranscribeStreamingClient({
    region,
    credentials: fromCognitoIdentityPool({
      identityPoolId,
      clientConfig: { region },
      logins: {
        [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
      },
    }),
  })
}

async function* getAudioStream(
  audioDataIterator: AsyncIterableIterator<MessageEvent<AudioWorkletMessageDataType>>,
) {
  for await (const chunk of audioDataIterator) {
    if (chunk.data.message === 'SHARE_RECORDING_BUFFER') {
      const { audioData } = chunk.data
      yield {
        AudioEvent: {
          AudioChunk: audioData,
        },
      }
    }
  }
}

export async function startTranscribe(
  mediaStreams: MediaStream[],
  languageCode: LanguageCode,
  callback: (result: Result) => void,
  { idToken }: { idToken: string },
) {
  const { audioDataIterator, audioWorkletNode, audioContext } = await getAudioIterator(mediaStreams)
  let client: TranscribeStreamingClient | undefined

  try {
    client = createTranscribeClient(idToken)

    const command = new StartStreamTranscriptionCommand({
      LanguageCode: languageCode,
      MediaEncoding: MediaEncoding.PCM,
      MediaSampleRateHertz: SAMPLE_RATE,
      NumberOfChannels: 2,
      EnableChannelIdentification: true,
      AudioStream: getAudioStream(audioDataIterator),
    })

    const data = await client.send(command)

    if (!data.TranscriptResultStream || data.$metadata.httpStatusCode !== 200) {
      return
    }

    for await (const event of data.TranscriptResultStream) {
      if (event?.TranscriptEvent?.Transcript) {
        for (const result of event.TranscriptEvent.Transcript.Results || []) {
          if (result) {
            callback({ ...result })
          }
        }
      } else {
        console.error('Transcribe stream error', event)
        throw new Error('Transcribe Stream exception')
      }
    }
  } catch (error) {
    if (error instanceof BadRequestException) {
      console.warn('Transcribe stream disconnected after 15 seconds')
    } else {
      console.error(error)
    }
  } finally {
    if (client) {
      client.destroy()
    }
    audioWorkletNode.port.postMessage({
      message: 'UPDATE_RECORDING_STATE',
      setRecording: false,
    })
    audioWorkletNode.disconnect()
    await audioContext.close().catch((error) => {
      console.warn('Failed to close audio context', error)
    })
    if (audioDataIterator.return) {
      await audioDataIterator.return(undefined)
    }
  }
}
