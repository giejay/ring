/* eslint-disable object-curly-spacing */
import 'dotenv/config'
import {RingApi, RingCamera} from '../api'
import fs from 'promise-fs'
import * as path from 'path';

const TelegramBot = require('node-telegram-bot-api');

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
  return request.put({url: url, body: body, headers: {'content-type': 'text/plain'}}).then((res: any) => {
    console.log('Updated openhab for ' + type, res);
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
    await camera.recordToFile(filePath, videoLength);
    let symLink = path.join(openHabSnapshotFolder, 'front-door-latest.mp4');
    if(fs.existsSync(symLink)){
      await fs.unlink(symLink);
    }
    fs.symlinkSync(filePath, symLink);
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
      // Listen for dings and motion events
      cameraDingsPollingSeconds: 2
    }),
    [camera] = await ringApi.getCameras();

  if (camera) {
    (camera as any).snapshotLifeTime = 10000;
    camera.onNewDing.subscribe(async ding => {
      if(processing){
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
          await updateOpenHab(openHabRingUrl, 'ON', 'Ring');
          // sendSnapshot(camera);
          await sendVideo(camera);
        } else if (ding.kind === 'motion') {
          await updateOpenHab(openHabMotionUrl, 'ON', 'Motion');
          if (sendSnapshotForMotion) {
            // sendSnapshot(camera);
            await sendVideo(camera);
          }
        }
      } catch(error){
        console.log('Error handling event', error);
      } finally {
        processing = false;
      }
    });

    // retrieveSnapshots(camera);

    console.log('Listening for motion and doorbell presses on your cameras.')
  }
}

main();
