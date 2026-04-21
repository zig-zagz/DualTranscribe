'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  disabled?: boolean
  onAudioInputs: (inputs: { A?: MediaDeviceInfo; B?: MediaDeviceInfo }) => void
}

type Option = {
  deviceId: string
  label: string
}

type RoleDeviceMap = {
  A?: string
  B?: string
}

export function MicrophonesSelection({ disabled, onAudioInputs }: Props) {
  const [options, setOptions] = useState<Option[]>([])
  const [selection, setSelection] = useState<RoleDeviceMap>({})
  const devicesRef = useRef<MediaDeviceInfo[]>([])
  const [error, setError] = useState<string>()

  const hasEnoughOptions = useMemo(() => options.length >= 2, [options])

  const listAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Audio input enumeration is not supported in this browser.')
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.filter((device) => device.kind === 'audioinput')
    } finally {
      // Immediately release the permissioned stream.
      stream.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const detectDevices = useCallback(async () => {
    try {
      setError(undefined)
      const devices = await listAudioDevices()
      devicesRef.current = devices

      const uniqueOptions: Option[] = []
      for (const device of devices) {
        if (device.deviceId && device.deviceId !== 'default') {
          uniqueOptions.push({
            deviceId: device.deviceId,
            label: device.label || 'Unknown microphone',
          })
        }
      }

      setOptions(uniqueOptions)

      if (uniqueOptions.length >= 2) {
        setSelection({
          A: uniqueOptions[0].deviceId,
          B: uniqueOptions[1].deviceId,
        })
      } else {
        setSelection({})
      }
    } catch (err) {
      console.error('Unable to enumerate audio devices', err)
      setOptions([])
      setSelection({})
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Unable to enumerate audio devices')
      }
    }
  }, [listAudioDevices])

  useEffect(() => {
    detectDevices()
  }, [detectDevices])

  useEffect(() => {
    if (!selection.A || !selection.B) {
      onAudioInputs({ A: undefined, B: undefined })
      return
    }

    const deviceA = devicesRef.current.find((device) => device.deviceId === selection.A)
    const deviceB = devicesRef.current.find((device) => device.deviceId === selection.B)

    if (deviceA && deviceB) {
      onAudioInputs({ A: deviceA, B: deviceB })
    } else {
      onAudioInputs({ A: undefined, B: undefined })
    }
  }, [selection, onAudioInputs])

  const optionElements = useMemo(
    () =>
      options.map((option) => (
        <option key={option.deviceId} value={option.deviceId}>
          {option.label}
        </option>
      )),
    [options],
  )

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Select microphones</h2>
        <button
          type="button"
          onClick={detectDevices}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Detect devices
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : hasEnoughOptions ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Channel 0</span>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-base shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={selection.A ?? ''}
              disabled={disabled}
              onChange={(event) =>
                setSelection((current) => ({ ...current, A: event.target.value }))
              }
            >
              {optionElements}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span>Channel 1</span>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-base shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={selection.B ?? ''}
              disabled={disabled}
              onChange={(event) =>
                setSelection((current) => ({ ...current, B: event.target.value }))
              }
            >
              {optionElements}
            </select>
          </label>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          Connect at least two microphones and click{' '}
          <span className="font-semibold">Detect devices</span> to refresh the list.
        </p>
      )}
    </div>
  )
}
