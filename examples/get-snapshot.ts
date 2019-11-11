/* eslint-disable object-curly-spacing */
import 'dotenv/config'
import {RingApi, RingCamera} from '../api'

const fs = require('fs'), request = require('request');

function updateOpenHab(url: string, body: string, type: string) {
  request.put({url: url, body: body, headers: {'content-type': 'text/plain'}}, (err: any, res: any) => {
    if (err) {
      return console.log('Could not update openhab for ' + type, err);
    }
    console.log('Updated openhab for ' + type, res.statusCode);
  });
}

async function sendSnapshot(camera: RingCamera, openHabSnapshotFolder: string, openHabSnapshotUrl: string) {
  const snapshot = await camera.getSnapshot(false),
    fileName = `front-door-${new Date().getTime()}.jpg`,
    filePath = openHabSnapshotFolder + fileName;
  fs.writeFile(filePath, snapshot, (fileError: any) => {
    if (fileError) {
      return console.log('Could not write the snapshot to disk', fileError);
    }
    console.log('The file was saved!');
    updateOpenHab(openHabSnapshotUrl, fileName, 'Snapshot');
  })
}

async function main() {
  const {env} = process,
    ringApi = new RingApi({
      // Replace with your ring email/password
      email: env.RING_EMAIL!,
      password: env.RING_PASS!,
      // Refresh token is used when 2fa is on
      // Listen for dings and motion events
      cameraDingsPollingSeconds: 2
    }),
    [camera] = await ringApi.getCameras(),
    openHabMotionUrl: string = env.OPENHAB_MOTION as string,
    openHabRingUrl: string = env.OPENHAB_RING as string,
    openHabSnapshotFolder: string = env.OPENHAB_SNAPSHOT_FOLDER as string,
    openHabSnapshotUrl: string = env.OPENHAB_SNAPSHOT_URL as string,
    sendSnapshotForMotion = !!env.SEND_SNAPSHOT_MOTION;

  if (camera) {
    camera.onNewDing.subscribe(ding => {
      const event =
        ding.kind === 'motion'
          ? 'Motion detected'
          : ding.kind === 'ding'
          ? 'Doorbell pressed'
          : `Video started (${ding.kind})`;
      if (ding.kind === 'ding') {
        updateOpenHab(openHabRingUrl, 'ON', 'Ring');
        sendSnapshot(camera, openHabSnapshotFolder, openHabSnapshotUrl);
      } else if (ding.kind === 'motion') {
        updateOpenHab(openHabMotionUrl, 'ON', 'Motion');
        if (sendSnapshotForMotion) {
          sendSnapshot(camera, openHabSnapshotFolder, openHabSnapshotUrl);
        }
      }
      console.log(`${event} on ${camera.name} camera. Ding id ${ding.id_str}.  Received at ${new Date()}`)
    });

    console.log('Listening for motion and doorbell presses on your cameras.')
  }
}

main();
