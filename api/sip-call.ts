import { Subject } from 'rxjs'
import { logError, logInfo } from './util'
import { getSrtpValue, RtpOptions, RtpStreamOptions } from './rtp-utils'

const ip = require('ip'),
  sip = require('sip'),
  sdp = require('sdp')

export const expiredDingError = new Error('Ding expired, received 480')

interface UriOptions {
  name?: string
  uri: string
  params?: { tag?: string }
}

interface SipHeaders {
  [name: string]: string | any
  cseq: { seq: number; method: string }
  to: UriOptions
  from: UriOptions
  contact?: UriOptions[]
  via?: UriOptions[]
}

export interface SipRequest {
  uri: UriOptions | string
  method: string
  headers: SipHeaders
  content: string
}

export interface SipResponse {
  status: number
  reason: string
  headers: SipHeaders
  content: string
}

export interface SipClient {
  send: (
    request: SipRequest | SipResponse,
    handler?: (response: SipResponse) => void
  ) => void
  destroy: () => void
  makeResponse: (
    response: SipRequest,
    status: number,
    method: string
  ) => SipResponse
}

export interface SipOptions {
  to: string
  from: string
  dingId: string
}

function getRandomId() {
  return Math.floor(Math.random() * 1e6).toString()
}

function createCryptoLine(rtpStreamOptions: RtpStreamOptions) {
  const srtpValue = getSrtpValue(rtpStreamOptions)

  if (!srtpValue) {
    return ''
  }

  return `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${srtpValue}`
}

function getRtpDescription(
  sections: string[],
  mediaType: 'audio' | 'video'
): RtpStreamOptions {
  const section = sections.find(s => s.startsWith('m=' + mediaType)),
    { port } = sdp.parseMLine(section),
    lines = sdp.splitLines(section),
    cryptoLine = lines.find((l: string) => l.startsWith('a=crypto'))

  if (!cryptoLine) {
    return { port }
  }
  const encodedCrypto = cryptoLine.match(/inline:(\S*)/)[1],
    crypto = Buffer.from(encodedCrypto, 'base64')

  return {
    port,
    srtpKey: crypto.slice(0, 16),
    srtpSalt: crypto.slice(16, 30)
  }
}

function parseRtpOptions(inviteResponse: { content: string }): RtpOptions {
  const sections: string[] = sdp.splitSections(inviteResponse.content),
    oLine = sdp.parseOLine(sections[0]),
    rtpOptions = {
      address: oLine.address,
      audio: getRtpDescription(sections, 'audio'),
      video: getRtpDescription(sections, 'video')
    }
  return rtpOptions
}

export class SipCall {
  private seq = 20
  private fromParams = { tag: getRandomId() }
  private toParams: { tag?: string } = {}
  private callId = getRandomId()
  private sipClient: SipClient
  public readonly onEndedByRemote = new Subject()
  public readonly onRemoteRtpOptionsSubject = new Subject<RtpOptions>()
  private destroyed = false

  public readonly sdp: string

  constructor(
    private sipOptions: SipOptions,
    rtpOptions: RtpOptions,
    tlsPort: number
  ) {
    const { address, audio, video } = rtpOptions,
      { from } = this.sipOptions,
      host = ip.address()

    this.sipClient = sip.create(
      {
        host,
        hostname: host,
        tls_port: tlsPort,
        tls: {
          rejectUnauthorized: false
        },
        tcp: false,
        udp: false
      },
      (request: SipRequest) => {
        if (request.method === 'BYE') {
          this.sipClient.send(this.sipClient.makeResponse(request, 200, 'Ok'))

          if (this.destroyed) {
            this.onEndedByRemote.next()
          }
        }
      }
    )

    this.sdp = [
      'v=0',
      `o=${from.split(':')[1].split('@')[0]} 3747 461 IN IP4 ${address}`,
      's=Talk',
      `c=IN IP4 ${address}`,
      'b=AS:380',
      't=0 0',
      'a=rtcp-xr:rcvr-rtt=all:10000 stat-summary=loss,dup,jitt,TTL voip-metrics',

      `m=audio ${audio.port} RTP/${audio.srtpKey ? 'S' : ''}AVP 0 101`,
      'a=rtpmap:0 PCMU/8000',
      createCryptoLine(audio),
      'a=rtcp-mux',
      `m=video ${video.port} RTP/${video.srtpKey ? 'S' : ''}AVP 99`,
      'a=rtpmap:99 H264/90000',
      createCryptoLine(video),
      'a=rtcp-mux'
    ]
      .filter(l => l)
      .join('\r\n')
  }

  request({
    method,
    headers,
    content,
    seq
  }: {
    method: string
    headers?: Partial<SipHeaders>
    content?: string
    seq?: number
  }) {
    if (this.destroyed) {
      return Promise.reject(
        new Error('SIP request made after call was destroyed')
      )
    }

    return new Promise<SipResponse>((resolve, reject) => {
      seq = seq || this.seq++
      this.sipClient.send(
        {
          method,
          uri: this.sipOptions.to,
          headers: {
            to: {
              name: '"FS Doorbot"',
              uri: this.sipOptions.to,
              params: this.toParams
            },
            from: {
              uri: this.sipOptions.from,
              params: this.fromParams
            },
            'max-forwards': 70,
            'call-id': this.callId,
            'User-Agent': 'Android/3.15.3 (belle-sip/1.4.2)',
            cseq: { seq, method },
            ...headers
          },
          content: content || ''
        },
        (response: SipResponse) => {
          if (response.headers.to.params && response.headers.to.params.tag) {
            this.toParams.tag = response.headers.to.params.tag
          }

          if (response.status >= 300) {
            if (response.status === 480 && method === 'INVITE') {
              const { dingId } = this.sipOptions
              logInfo(
                `Ding ${dingId} is expired (${response.status}).  Fetching a new ding and trying video stream again`
              )
              reject(expiredDingError)
              return
            }

            if (response.status !== 408 || method !== 'BYE') {
              logError(
                `sip ${method} request failed with status ` + response.status
              )
            }
            reject(
              new Error(
                `sip ${method} request failed with status ` + response.status
              )
            )
          } else if (response.status < 200) {
            // call made progress, do nothing and wait for another response
            // console.log('call progress status ' + response.status)
          } else {
            if (method === 'INVITE') {
              // The ACK must be sent with every OK to keep the connection alive.
              this.ackWithInfo(seq!).catch(e => {
                logError('Failed to send SDP ACK and INFO')
                logError(e)
              })
            }
            resolve(response)
          }
        }
      )
    })
  }

  private async ackWithInfo(seq: number) {
    // Don't wait for ack, it won't ever come back.
    this.request({
      method: 'ACK',
      seq // The ACK must have the original sequence number.
    })

    // SIP session will be terminated after 30 seconds if INFO isn't sent.
    await this.request({
      method: 'INFO',
      headers: {
        'Content-Type': 'application/dtmf-relay'
      },
      content: 'Signal=2\r\nDuration=250'
    })

    await this.request({
      method: 'INFO',
      headers: {
        'Content-Type': 'application/media_control+xml'
      },
      content:
        '<?xml version="1.0" encoding="utf-8" ?><media_control>  <vc_primitive>    <to_encoder>      <picture_fast_update></picture_fast_update>    </to_encoder>  </vc_primitive></media_control>'
    })
  }

  async invite() {
    const { from } = this.sipOptions,
      inviteResponse = await this.request({
        method: 'INVITE',
        headers: {
          supported: 'replaces, outbound',
          allow:
            'INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY, MESSAGE, SUBSCRIBE, INFO, UPDATE',
          'content-type': 'application/sdp',
          contact: [{ uri: from }]
        },
        content: this.sdp
      }),
      remoteRtpOptions = parseRtpOptions(inviteResponse)

    this.onRemoteRtpOptionsSubject.next(remoteRtpOptions)
    return remoteRtpOptions
  }

  sendBye() {
    return this.request({ method: 'BYE' }).catch(() => {
      // Don't care if we get an exception here.
    })
  }

  destroy() {
    this.destroyed = true
    this.sipClient.destroy()
  }
}
