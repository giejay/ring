/* eslint-disable object-curly-spacing */
import 'dotenv/config'
import {RingApi, RingCamera} from '../api'
import fs from 'promise-fs'

const request = require('request-promise');

// let retrievingSnapshot = false, currentSnapshot: Buffer, snapshotSent: Buffer;
const {env} = process,
  openHabMotionUrl: string = env.OPENHAB_MOTION as string,
  openHabRingUrl: string = env.OPENHAB_RING as string,
  openHabSnapshotFolder: string = env.OPENHAB_SNAPSHOT_FOLDER as string,
  openHabSnapshotUrl: string = env.OPENHAB_SNAPSHOT_URL as string,
  sendSnapshotForMotion = !!env.SEND_SNAPSHOT_MOTION,
  maxSnapshots = parseInt(env.MAX_SNAPSHOTS as string, 0) || 3,
  snapshotInterval = (parseInt(env.SNAPSHOT_INTERVAL as string, 0) * 1000) || 30000;

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
      filePath = openHabSnapshotFolder + fileName;
    await fs.writeFile(filePath, snapshot);
    await fs.symlink(openHabSnapshotFolder + 'front-door-latest.jpg', filePath, () => null);
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
        setTimeout(() => {
          sendSnapshot(camera, count + 1);
        }, snapshotInterval);
      } catch (error) {
        console.log('Could not send snapshot', error);
      }
    }
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
    camera.onNewDing.subscribe(ding => {
      const event =
        ding.kind === 'motion'
          ? 'Motion detected'
          : ding.kind === 'ding'
          ? 'Doorbell pressed'
          : `Video started (${ding.kind})`;
      if (ding.kind === 'ding') {
        updateOpenHab(openHabRingUrl, 'ON', 'Ring');
        sendSnapshot(camera);
      } else if (ding.kind === 'motion') {
        updateOpenHab(openHabMotionUrl, 'ON', 'Motion');
        if (sendSnapshotForMotion) {
          sendSnapshot(camera);
        }
      }
      console.log(`${event} on ${camera.name} camera. Ding id ${ding.id_str}.  Received at ${new Date()}`)
    });

    // retrieveSnapshots(camera);

    console.log('Listening for motion and doorbell presses on your cameras.')
  }
}

main();
