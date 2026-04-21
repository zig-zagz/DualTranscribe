# Streaming Multi-channel Audio to Amazon Transcribe using Web Audio API

A Next.js web application that captures audio from **two microphones simultaneously**, merges them into a stereo (2-channel) PCM stream, and sends it to **Amazon Transcribe Streaming** for real-time, channel-identified speech-to-text transcription.

This is a companion code sample for the blog post *Streaming Multi-channel Audio to Amazon Transcribe using Web Audio API*.

---

## Why This Matters

Most browser-based transcription demos use a single microphone and produce a single transcript. In many real-world scenarios — interviews, customer-service calls, multilingual meetings — you need to know **who said what**. Amazon Transcribe supports multi-channel audio with channel identification, but wiring two browser microphones into a single interleaved stream requires careful use of the Web Audio API.

This sample solves that problem end-to-end:

- **Dual-microphone capture** — select any two audio input devices available to the browser.
- **Real-time stereo merge** — a `ChannelMergerNode` combines both inputs and an `AudioWorkletProcessor` interleaves and PCM-encodes the samples on a dedicated audio thread, avoiding main-thread jank.
- **Channel-identified transcription** — Amazon Transcribe returns results tagged with `ch_0` or `ch_1`, so the UI can display each speaker's transcript in its own column.
- **50+ language support** — switch the transcription language from a dropdown; Transcribe handles the rest.
- **Secure authentication** — users sign in via Amazon Cognito (OAuth 2.0 / OIDC with PKCE); the Cognito ID token is exchanged for scoped, temporary AWS credentials through a Cognito Identity Pool, so no long-lived keys are exposed to the browser.

---

## How It Works

```
┌──────────────┐   ┌──────────────┐
│ Microphone A │   │ Microphone B │
└──────┬───────┘   └──────┬───────┘
       │ getUserMedia()    │ getUserMedia()
       ▼                   ▼
 MediaStreamSource   MediaStreamSource
       │                   │
       └───────┬───────────┘
               ▼
       ChannelMergerNode  (stereo: A → ch 0, B → ch 1)
               │
               ▼
       AudioWorkletNode  (recording-processor.js)
         • buffers samples
         • interleaves channels
         • PCM-encodes to 16-bit LE
               │
               ▼
       TranscribeStreamingClient
         • StartStreamTranscriptionCommand
         • 2-channel PCM @ 16 kHz (44.1 kHz on Firefox)
         • EnableChannelIdentification: true
               │
               ▼
       Real-time TranscriptResultStream
         • Results tagged with ChannelId (ch_0 / ch_1)
         • Partial + final results streamed to UI
```

### Step-by-step

1. **Sign in** — the user authenticates through Amazon Cognito using Auth.js (NextAuth v5). The server stores the Cognito ID token in a JWT session.
2. **Select microphones** — the `MicrophonesSelection` component enumerates available audio input devices and lets the user assign each to role A or B.
3. **Start transcription** — clicking *Start Transcription*:
   - Opens two `getUserMedia` streams (one per device) with echo-cancellation, noise-suppression, and auto-gain disabled to preserve raw audio.
   - Creates an `AudioContext` at the target sample rate, wires both sources into a `ChannelMergerNode`, then into a custom `AudioWorkletNode`.
   - The worklet (`recording-processor.js`) runs on the audio rendering thread. It buffers incoming frames, interleaves the two channels, and PCM-encodes them into a `Uint8Array` which it posts back to the main thread via `MessagePort`.
   - An async generator wraps the `MessagePort` events and yields `AudioEvent` chunks to the AWS SDK's `StartStreamTranscriptionCommand`.
4. **Receive results** — the SDK returns an async iterable of `TranscriptEvent` messages. Each `Result` carries a `ChannelId` (`ch_0` or `ch_1`) and an `IsPartial` flag. The UI splits results by channel and renders final transcripts in two side-by-side columns with timestamps.
5. **Stop** — clicking *Stop Transcription* stops all media tracks, closes the audio context, and tears down the worklet.

### Key Technology Choices

| Concern | Solution |
|---|---|
| Framework | Next.js 15 (App Router, React 18) |
| Styling | Tailwind CSS |
| Authentication | Auth.js (NextAuth v5) with the Cognito provider, PKCE + state + nonce |
| AWS credentials | `fromCognitoIdentityPool` — exchanges the Cognito ID token for temporary STS credentials scoped to `transcribe:StartStreamTranscription` |
| Audio processing | Web Audio API — `AudioWorkletProcessor` for off-main-thread PCM encoding |
| Transcription | `@aws-sdk/client-transcribe-streaming` — HTTP/2 bidirectional streaming |
| Async iteration | `p-event` (`pEventIterator`) to bridge `MessagePort` events into an async iterable |

---

## Setup

### Prerequisites

- Node.js 18+
- An AWS account with Amazon Cognito and Amazon Transcribe enabled
- Two audio input devices (microphones) accessible to the browser

### 1. Install dependencies

```sh
npm install
```

### 2. Set up AWS Cognito Identity Pool

This application uses Amazon Cognito Identity Pool to provide temporary AWS credentials. You'll need to:

a. Create a Cognito Identity Pool in the AWS Console.
b. Configure it to accept your Cognito User Pool as an authentication provider.
c. Attach an IAM role to the authenticated identity with the following policy (the streaming API does not yet support resource-level restrictions, so the resource remains `"*"`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowTranscribeStreaming",
      "Effect": "Allow",
      "Action": "transcribe:StartStreamTranscription",
      "Resource": "*"
    }
  ]
}
```

And use the following trust policy so that only authenticated identities from your Cognito Identity Pool can assume the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "REGION:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        },
        "ForAnyValue:StringLike": {
          "cognito-identity.amazonaws.com:amr": "authenticated"
        }
      }
    }
  ]
}
```

Replace `REGION:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` with your Identity Pool ID.

Back in the Identity Pool console, ensure **Choose role from token** is enabled so Cognito group roles flow through.

> **Note:** If you prefer the WebSocket flavor of the streaming API, also allow `transcribe:StartStreamTranscriptionWebSocket`.

### 3. Configure environment variables

Create an `.env.local` file (see `env.sample` for reference):

```sh
# Auth.js / NextAuth configuration (server-only)
AUTH_SECRET=replace-with-secure-random-value
AUTH_URL=http://localhost:3000
AUTH_COGNITO_ID=your-cognito-app-client-id
# Omit AUTH_COGNITO_SECRET if your app client is public and PKCE-only
AUTH_COGNITO_SECRET=your-cognito-app-client-secret
AUTH_COGNITO_ISSUER=https://cognito-idp.REGION.amazonaws.com/USER_POOL_ID
   # Optional: set to your federated identity provider name (e.g. corporate SAML/OIDC provider)
   # AUTH_COGNITO_IDENTITY_PROVIDER=
AUTH_TRUST_HOST=true

# Safe to expose to the browser
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_USER_POOL_ID=USER_POOL_ID
NEXT_PUBLIC_IDENTITY_POOL_ID=REGION:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 4. Run the development server

```sh
npm run dev
```

### 5. Open the application

Navigate to http://localhost:3000/. Your browser will prompt you to grant microphone access — allow it. If no microphones are detected, try resetting the permissions in your browser settings.

---

## Project Structure

```
├── app/
│   ├── layout.tsx              # Root layout with session provider
│   ├── page.tsx                # Main UI — mic selection, controls, transcript display
│   └── api/auth/[...nextauth]/ # Auth.js route handler
├── auth.ts                     # NextAuth configuration (Cognito provider, JWT callbacks)
├── components/
│   ├── microphones-selection.tsx # Enumerates audio devices, lets user pick A and B
│   └── session-provider.tsx     # Client-side NextAuth SessionProvider wrapper
├── lib/
│   └── stream.ts               # Web Audio pipeline + Transcribe streaming logic
├── public/worklets/
│   └── recording-processor.js  # AudioWorkletProcessor — buffers, interleaves, PCM-encodes
├── types/
│   └── next-auth.d.ts          # Session type augmentation for cognito_id_token
├── middleware.ts               # NextAuth middleware
└── env.sample                  # Template for .env.local
```

---

## Browser Compatibility

- **Chrome / Edge** — full support; sample rate defaults to 16 kHz.
- **Firefox** — supported; sample rate is set to 44.1 kHz because Firefox does not support custom `AudioContext` sample rates below that value.
- **Safari** — AudioWorklet support varies; test on your target version.

---

## License

See [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.
