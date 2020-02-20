/* eslint-disable object-curly-spacing */
import {promisify} from "util";

const TelegramBot = require('node-telegram-bot-api'),
express = require('express');
import 'dotenv/config'
import {RingApi, RingCamera} from '../api'
import fs from 'promise-fs'
import * as path from 'path';

const request = require('request-promise');

let processing = false;

// let retrievingSnapshot = false, currentSnapshot: Buffer, snapshotSent: Buffer;
const {env} = process,
  openHabMotionUrl: string = env.OPENHAB_MOTION as string,
  openHabRingUrl: string = env.OPENHAB_RING as string,
  openHabSnapshotFolder: string = env.OPENHAB_SNAPSHOT_FOLDER as string,
  openHabSnapshotUrl: string = env.OPENHAB_SNAPSHOT_URL as string,
  // openHabVideoUrl: string = env.OPENHAB_VIDEO_URL as string,
  videoLength: number = parseInt(env.VIDEO_LENGTH as string) || 4,
  sendSnapshotForMotion = !!env.SEND_SNAPSHOT_MOTION,
  maxSnapshots = parseInt(env.MAX_SNAPSHOTS as string) || 3,
  snapshotInterval = (parseInt(env.SNAPSHOT_INTERVAL as string) * 1000) || 30000,
  telegramToken = env.TELEGRAM_TOKEN as string,
  telegramChatId = parseInt(env.TELEGRAM_CHAT_ID as string);

const bot = new TelegramBot(telegramToken, {polling: false});

function updateOpenHab(url: string, body: string, type: string): Promise<any> {
  return request.put({url: url, body: body, headers: {'content-type': 'text/plain'}}).then(() => {
    console.log('Updated openhab for ' + type);
  }, (err: any) => {
    return console.log('Could not update openhab for ' + type, err);
  });
}

async function getSnapshot(camera: RingCamera) {
  try {
    const time = new Date().getTime(), snapshot = await camera.getSnapshot();
    console.log(`Retrieved snapshot in ${new Date().getTime() - time} ms`);
    return snapshot;
  } catch (error) {
    console.log('Could not retrieve snapshot', error);
  }
}

async function writeSnapshot(snapshot: Buffer) {
  try {
    const fileName = `front-door-${new Date().getTime()}.jpg`,
      filePath = path.join(openHabSnapshotFolder, fileName);
    await fs.writeFile(filePath, snapshot);
    await fs.symlink(filePath, path.join(openHabSnapshotFolder, 'front-door-latest.jpg'), () => null);
    console.log('The file was saved!');
    // snapshotSent = currentSnapshot;
    return fileName;
  } catch (error) {
    console.log('Could not write snapshot', error);
  }
}

async function sendSnapshot(camera: RingCamera, count = 0) {
  if (count === maxSnapshots) {
    // if (count === maxSnapshots || !currentSnapshot) {
    return;
  }
  const snapshot = await getSnapshot(camera);
  if (snapshot) {
    const fileName = await writeSnapshot(snapshot);
    if (fileName) {
      try {
        await updateOpenHab(openHabSnapshotUrl, fileName, 'Snapshot ' + (count + 1));
        console.log('Openhab was updated with latest snapshot info');
      } catch (error) {
        console.log('Could not send snapshot', error);
      }
    }
  }
  setTimeout(() => {
    sendSnapshot(camera, count + 1);
  }, snapshotInterval);
}

async function sendVideo(camera: RingCamera) {
  try {
    const fileName = `front-door-${new Date().getTime()}.mp4`,
      filePath = path.join(openHabSnapshotFolder, fileName);
    console.log('Recording to file: ' + filePath);
    await camera.recordToFile(filePath, videoLength);
    let symLink = path.join(openHabSnapshotFolder, 'front-door-latest.mp4');
    console.log('Creating symlink: ' + symLink);
    if (fs.existsSync(symLink)) {
      await fs.unlink(symLink);
    }
    fs.symlinkSync(filePath, symLink);
    console.log('Sending telegram');
    return bot.sendVideo(telegramChatId, filePath);
  } catch (error) {
    console.log('Could not send video', error);
  }
}

// function retrieveSnapshots(camera: RingCamera) {
//   setInterval(async () => {
//     if (!retrievingSnapshot) {
//       retrievingSnapshot = true;
//       const snap = await getSnapshot(camera);
//       if (snap) {
//         currentSnapshot = snap;
//       }
//       retrievingSnapshot = false;
//     }
//   }, snapshotInterval);
// }

async function main() {
  const ringApi = new RingApi({
      // Replace with your ring email/password
      email: env.RING_EMAIL!,
      password: env.RING_PASS!,
      // Refresh token is used when 2fa is on
      refreshToken: process.env.RING_TOKEN!,
      // Listen for dings and motion events
      cameraDingsPollingSeconds: 2
      // externalPorts: {
      //   start: 15000,
      //   end: 15050,
      // }
    }),
    [camera] = await ringApi.getCameras();

  if (camera) {
    // await sendVideo(camera);
    (camera as any).snapshotLifeTime = 10000;
    camera.onNewDing.subscribe(async ding => {
      if (processing) {
        return;
      }
      const event =
        ding.kind === 'motion'
          ? 'Motion detected'
          : ding.kind === 'ding'
          ? 'Doorbell pressed'
          : `Video started (${ding.kind})`;
      console.log(`${event} on ${camera.name} camera. Ding id ${ding.id_str}.  Received at ${new Date()}`);
      processing = true;
      try {
        if (ding.kind === 'ding') {
          await Promise.all([updateOpenHab(openHabRingUrl, 'ON', 'Ring'), sendVideo(camera)].map(p => p.catch(e => e)))
            .then(results => console.log(results));
        } else if (ding.kind === 'motion') {
          await updateOpenHab(openHabMotionUrl, 'ON', 'Motion');
          if (sendSnapshotForMotion) {
            await sendVideo(camera);
          }
        }
      } catch (error) {
        console.log('Error handling event', error);
      } finally {
        processing = false;
      }
    });

    console.log('Listening for motion and doorbell presses on your cameras.')
  }

  const app = express(),
    publicOutputDirectory = path.join('public', 'output');

  if (!(await promisify(fs.exists)(publicOutputDirectory))) {
    await fs.mkdir(publicOutputDirectory, {recursive: true})
  }

  app.use('/send-video', async (req: any, res: any) => {
    await sendVideo(camera);
    res.status(200).send('send video to telegram');
  });

  app.use('/', express.static('public'))

  app.use('/get-video', async (req: any, res: any) => {
    const sipSession = await camera.streamVideo({
      output: [
        '-preset',
        'veryfast',
        '-g',
        '25',
        '-sc_threshold',
        '0',
        '-f',
        'hls',
        '-hls_time',
        '2',
        '-hls_list_size',
        '6',
        '-hls_flags',
        'delete_segments',
        path.join(publicOutputDirectory, 'stream.m3u8')
      ]
    });

    setTimeout(() => {
      sipSession.stop();
    }, 20000);

    sipSession.onCallEnded.subscribe(() => {
      console.log('Call has ended');
    });

    res.sendfile('public/index.html');
  });

  app.listen(3000, () => {
    console.log(
      'Listening on port 3000.  Go to http://localhost:3000 in your browser'
    )
  });
}

main();
