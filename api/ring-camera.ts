import {
  ActiveDing,
  batteryCameraKinds,
  CameraData,
  CameraHealth,
  DoorbellType,
  HistoricalDingGlobal,
  RingCameraModel,
  SnapshotTimestamp
} from './ring-types'
import { clientApi, RingRestClient } from './rest-client'
import { BehaviorSubject, Subject } from 'rxjs'
import {
  distinctUntilChanged,
  filter,
  map,
  publishReplay,
  refCount,
  share,
  take
} from 'rxjs/operators'
import { createSocket } from 'dgram'
import {
  bindToRandomPort,
  getPublicIp,
  reservePorts,
  SrtpOptions
} from './rtp-utils'
import { delay, logError, logInfo } from './util'
import { FfmpegOptions, SipSession } from './sip-session'

const snapshotRefreshDelay = 500,
  maxSnapshotRefreshSeconds = 30,
  maxSnapshotRefreshAttempts =
    (maxSnapshotRefreshSeconds * 1000) / snapshotRefreshDelay

function getBatteryLevel(data: CameraData) {
  const batteryLevel =
    typeof data.battery_life === 'number'
      ? data.battery_life
      : Number.parseFloat(data.battery_life)

  if (isNaN(batteryLevel)) {
    return null
  }

  return batteryLevel
}

export class RingCamera {
  id = this.initialData.id
  deviceType = this.initialData.kind
  model = RingCameraModel[this.initialData.kind] || 'Unknown Model'
  onData = new BehaviorSubject<CameraData>(this.initialData)
  hasLight = this.initialData.led_status !== undefined
  hasSiren = this.initialData.siren_status !== undefined
  hasBattery =
    batteryCameraKinds.includes(this.deviceType) ||
    (typeof this.initialData.battery_life === 'string' &&
      this.batteryLevel !== null &&
      this.batteryLevel < 100 &&
      this.batteryLevel >= 0)

  onRequestUpdate = new Subject()
  onRequestActiveDings = new Subject()

  onNewDing = new Subject<ActiveDing>()
  onActiveDings = new BehaviorSubject<ActiveDing[]>([])
  onDoorbellPressed = this.onNewDing.pipe(
    filter(ding => ding.kind === 'ding'),
    share()
  )
  onMotionDetected = this.onActiveDings.pipe(
    map(dings => dings.some(ding => ding.motion || ding.kind === 'motion')),
    distinctUntilChanged(),
    publishReplay(1),
    refCount()
  )
  onBatteryLevel = this.onData.pipe(
    map(getBatteryLevel),
    distinctUntilChanged()
  )
  onInHomeDoorbellStatus = this.onData.pipe(
    map(({ settings: { chime_settings } }: CameraData) => {
      return Boolean(chime_settings && chime_settings.enable)
    }),
    distinctUntilChanged()
  )

  constructor(
    private initialData: CameraData,
    public isDoorbot: boolean,
    private restClient: RingRestClient
  ) {}

  updateData(update: CameraData) {
    this.onData.next(update)
  }

  requestUpdate() {
    this.onRequestUpdate.next()
  }

  get data() {
    return this.onData.getValue()
  }

  get name() {
    return this.data.description
  }

  get activeDings() {
    return this.onActiveDings.getValue()
  }

  get batteryLevel() {
    return getBatteryLevel(this.data)
  }

  get hasLowBattery() {
    return this.data.alerts.battery === 'low'
  }

  get isOffline() {
    return this.data.alerts.connection === 'offline'
  }

  get hasInHomeDoorbell() {
    const { chime_settings } = this.data.settings

    return (
      this.isDoorbot &&
      Boolean(
        chime_settings &&
          [DoorbellType.Mechanical, DoorbellType.Digital].includes(
            chime_settings.type
          )
      )
    )
  }

  doorbotUrl(path = '') {
    return clientApi(`doorbots/${this.id}/${path}`)
  }

  async setLight(on: boolean) {
    if (!this.hasLight) {
      return false
    }

    const state = on ? 'on' : 'off'

    await this.restClient.request({
      method: 'PUT',
      url: this.doorbotUrl('floodlight_light_' + state)
    })

    this.updateData({ ...this.data, led_status: state })

    return true
  }

  async setSiren(on: boolean) {
    if (!this.hasSiren) {
      return false
    }

    const state = on ? 'on' : 'off'

    await this.restClient.request({
      method: 'PUT',
      url: this.doorbotUrl('siren_' + state)
    })

    this.updateData({ ...this.data, siren_status: { seconds_remaining: 1 } })

    return true
  }

  // Enable or disable the in-home doorbell (if digital or mechanical)
  async setInHomeDoorbell(on: boolean) {
    if (!this.hasInHomeDoorbell) {
      return false
    }

    await this.restClient.request({
      method: 'PUT',
      url: this.doorbotUrl(),
      data: {
        'doorbot[settings][chime_settings][enable]': on
      }
    })

    this.requestUpdate()

    return true
  }

  async getHealth() {
    const response = await this.restClient.request<{
      device_health: CameraHealth
    }>({
      url: this.doorbotUrl('health')
    })

    return response.device_health
  }

  startVideoOnDemand() {
    return this.restClient.request({
      method: 'POST',
      url: this.doorbotUrl('vod')
    })
  }

  async getSipConnectionDetails() {
    const vodPromise = this.onNewDing
      .pipe(
        filter(x => x.kind === 'on_demand'),
        take(1)
      )
      .toPromise()
    await this.startVideoOnDemand()
    this.onRequestActiveDings.next()
    return vodPromise
  }

  processActiveDing(ding: ActiveDing) {
    const activeDings = this.activeDings

    this.onNewDing.next(ding)
    this.onActiveDings.next(activeDings.concat([ding]))

    setTimeout(() => {
      const allActiveDings = this.activeDings,
        otherDings = allActiveDings.filter(oldDing => oldDing !== ding)
      this.onActiveDings.next(otherDings)
    }, 65 * 1000) // dings last ~1 minute
  }

  getHistory(limit = 10, favoritesOnly = false) {
    const favoritesParam = favoritesOnly ? '&favorites=1' : ''
    return this.restClient.request<HistoricalDingGlobal[]>({
      url: this.doorbotUrl(`history?limit=${limit}${favoritesParam}`)
    })
  }

  async getRecording(dingIdStr: string) {
    const response = await this.restClient.request<{ url: string }>({
      url: clientApi(`dings/${dingIdStr}/share/play?disable_redirect=true`)
    })
    return response.url
  }

  private isTimestampInLifeTime(timestampAge: number) {
    return timestampAge < this.snapshotLifeTime
  }

  private async getSnapshotTimestamp() {
    const { timestamps, responseTimestamp } = await this.restClient.request<{
        timestamps: SnapshotTimestamp[]
      }>({
        url: clientApi('snapshots/timestamps'),
        method: 'POST',
        data: {
          doorbot_ids: [this.id]
        },
        json: true
      }),
      deviceTimestamp = timestamps[0],
      timestamp = deviceTimestamp ? deviceTimestamp.timestamp : 0,
      timestampAge = Math.abs(responseTimestamp - timestamp)

    this.lastSnapshotTimestampLocal = timestamp ? Date.now() - timestampAge : 0

    return {
      timestamp,
      inLifeTime: this.isTimestampInLifeTime(timestampAge)
    }
  }

  private refreshSnapshotInProgress?: Promise<boolean>
  private snapshotLifeTime = (this.hasBattery ? 600 : 30) * 1000 // battery cams only refresh timestamp every 10 minutes
  private lastSnapshotTimestampLocal = 0
  private lastSnapshotPromise?: Promise<Buffer>

  getSnapshot() {
    this.lastSnapshotPromise = this.restClient.request<Buffer>({
      url: clientApi(`snapshots/image/${this.id}`),
      responseType: 'arraybuffer'
    })

    this.lastSnapshotPromise.catch(() => {
      // snapshot request failed, don't use it again
      this.lastSnapshotPromise = undefined
    })

    return this.lastSnapshotPromise
  }

  sipUsedDingIds: string[] = []

  async getSipOptions() {
    const activeDings = this.onActiveDings.getValue(),
      existingDing = activeDings
        .slice()
        .reverse()
        .find(x => !this.sipUsedDingIds.includes(x.id_str)),
      targetDing = existingDing || (await this.getSipConnectionDetails())

    this.sipUsedDingIds.push(targetDing.id_str)

    return {
      to: targetDing.sip_to,
      from: targetDing.sip_from,
      dingId: targetDing.id_str
    }
  }

  async createSipSession(
    srtpOption: { audio?: SrtpOptions; video?: SrtpOptions } = {}
  ) {
    const videoSocket = createSocket('udp4'),
      audioSocket = createSocket('udp4'),
      [
        sipOptions,
        publicIpPromise,
        videoPort,
        audioPort,
        [tlsPort]
      ] = await Promise.all([
        this.getSipOptions(),
        getPublicIp(),
        bindToRandomPort(videoSocket),
        bindToRandomPort(audioSocket),
        reservePorts()
      ]),
      rtpOptions = {
        address: await publicIpPromise,
        audio: {
          port: audioPort,
          ...srtpOption.audio
        },
        video: {
          port: videoPort,
          ...srtpOption.video
        }
      }

    return new SipSession(
      {
        ...sipOptions,
        tlsPort
      },
      rtpOptions,
      videoSocket,
      audioSocket
    )
  }

  async recordToFile(outputPath: string, duration = 30) {
    const sipSession = await this.streamVideo({
      output: ['-t', duration.toString(), outputPath]
    })

    await sipSession.onCallEnded.pipe(take(1)).toPromise()
  }

  async streamVideo(ffmpegOptions: FfmpegOptions) {
    // SOMEDAY: generate random SRTP key/salt
    const sipSession = await this.createSipSession()
    await sipSession.start(ffmpegOptions)
    return sipSession
  }
}

// SOMEDAY: extract image from video file?
// ffmpeg -i input.mp4 -r 1 -f image2 image-%2d.png
