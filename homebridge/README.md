# homebridge-ring

[![Actions Status](https://github.com/dgreif/ring/workflows/Node%20CI/badge.svg)](https://github.com/dgreif/ring/actions)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=HD9ZPB34FY428&currency_code=USD&source=url)

This [Homebridge](https://github.com/nfarina/homebridge) plugin provides a platform for
[Ring Doorbells](https://shop.ring.com/pages/doorbell-cameras),
[Ring Cameras](https://shop.ring.com/pages/security-cameras),
the [Ring Alarm System](https://shop.ring.com/pages/security-system),
[Ring Smart Lighting](https://shop.ring.com/pages/smart-lighting),
and third party devices that connect to the Ring Alarm System.


## Installation

Assuming a global installation of `homebridge`:

`npm i -g homebridge-ring`

## Homebridge Configuration

Add the `Ring` platform in your homebridge `config.json` file.

### Basic Configuration

If you _do not have_ 2fa enabled, this is all that you need to get up and running.  It will enable all devices from Ring and no other configuration is required.  [See below](https://github.com/dgreif/ring/tree/master/homebridge#camera-setup) for instructions to add cameras to HomeKit.

 ```json
{
  "platforms": [
    {
      "platform": "Ring",
      "email": "some.one@website.com",
      "password": "abc123!#"
    }
  ]
}
```

### Alternate Basic Config (2fa)

If you _have_ 2fa enable, you _must_ use a `refreshToken` instead of email/password.  It also works without 2fa if you simply don't want your email/password in your homebridge `config.json`.  See the [Two Factor Auth Wiki](https://github.com/dgreif/ring/wiki/Two-Factor-Auth) for details on generating a `refreshToken`.

 ```json
{
  "platforms": [
    {
      "platform": "Ring",
      "refreshToken": "token generated with ring-auth-cli"
    }
  ]
}
```

### Optional Parameters
Only include an optional parameter if you actually need it.  Default behavior without any of the optional parameters should be sufficient for most users.

 ```json
{
  "email": "some.one@website.com",
  "password": "abc123!#",

  "alarmOnEntryDelay": true,
  "beamDurationSeconds": 60,
  "hideLightGroups": true,
  "hideDoorbellSwitch": true,
  "hideCameraMotionSensor": true,
  "hideCameraSirenSwitch": true,
  "hideInHomeDoorbellSwitch": true,
  "hideAlarmSirenSwitch": true,
  "hideUnsupportedServices": true,
  "cameraStatusPollingSeconds": 20,
  "cameraDingsPollingSeconds": 2,
  "locationIds": ["488e4800-fcde-4493-969b-d1a06f683102", "4bbed7a7-06df-4f18-b3af-291c89854d60"]
}
```

Option | Default | Explanation
--- | --- | ---
`alarmOnEntryDelay` | `false` | if `true`, HomeKit will register a delayed entry event as a triggered alarm.  There are some households where this is a nice feature as a heads up if you have other people who enter your house and you want an alert so that you can disable the alarm for them before it actually goes off. This works well if you automatically arm/disarm on leave/arrive (see setup instructions below)
`beamDurationSeconds` | `60` for light groups, previous from Ring app for individual lights | Ring smart lighting has a default behavior of only staying on for 60 seconds when you turn on a light via the Ring app.  To force a duration when the light is turned on from HomeKit, set this option to a specific number of seconds. If this option is not set, the lights will use the duration from the previous time the light was turned on in the Ring app. For light groups, this will default to 60 seconds. The maximum value is `32767`, which is ~9.1 hours.
`hideLightGroups` | `false` | Ring smart lighting allows you to create lighting groups within the Ring app. These groups are convenient for detecting motion in an area of your yard and turning on/off all lights in the group.  However, you may wish to group the lights differently in HomeKit and ignore the groups you have configured in Ring.  If this option is `true`, your Ring groups (and their associated motion sensor) will be ignored and will not show up in HomeKit.
`hideDoorbellSwitch` | `false` | If you have a Ring video doorbell, you will see a Programmable Switch associated with it.  This switch can be used to perform actions on when the doorbell is pressed using "Single Press" actions.  If you do not care to perform actions when the doorbell is pressed, you can hide the Programmable Switch by setting this option to `true`. You will still be able to receive _notifications_ from the doorbell even if the Programmable Switch is hidden (notifications can be configured in the settings for the doorbell camera in the Home app)
`hideCameraMotionSensor` | `false` | If `true`, hides the motion sensor for Ring cameras in HomeKit.
`hideCameraSirenSwitch` | `false` | If `true`, hides the siren switch for Ring cameras in HomeKit.
`hideInHomeDoorbellSwitch` | `false` | If `true`, hides the switch for in-home doorbells in HomeKit.
`hideAlarmSirenSwitch` | `false` | If you have a Ring Alarm, you will see both the alarm and a "Siren" switch in HomeKit.  The siren switch can sometimes get triggered by Siri commands by accident, which is loud and annoying.  Set this option to `true` to hide the siren switch.
`hideUnsupportedServices` | `false` | If `true`, hides the alarm Base Station and Keypad devices in HomeKit.  These are only supported by third-party HomeKit apps, not the native Home app.
`showPanicButtons` | `false` | Creates a new `Panic Buttons` device in HomeKit with `Burglar Alarm` and `Fire Alarm` switches.  **Use these at your own risk.  I do not guarantee functionality in case of emergency, nor do I take responsibility for any false alarms**.  These function just like the SOS sliders in the Ring app.
`cameraStatusPollingSeconds` | `20` | How frequently to poll for updates to your cameras.  Information like light/siren status do not update in real time and need to be requested periodically.
`cameraDingsPollingSeconds` | `2` | How frequently to poll for new events from your cameras.  These include motion and doorbell presses.
`locationIds` | All Locations | Use this option if you only want a subset of your locations to appear in HomeKit. If this option is not included, all of your locations will be added to HomeKit (which is what most users will want to do).
`debug` | false | Turns on additional logging.  In particular, ffmpeg logging.

### Camera Setup

This plugin will connect all of your Ring cameras to homebridge, but they require a little extra work to get set up.
Don't worry, it's really easy. Due to homebridge/HAP limitations, the cameras cannot be added through a bridge and must be added as individual devices.
Configure the homebridge plugin like normal, then click on the "+" in the upper right in
the Home app, then "Don't have a Code or Can't Scan?", then you should see the cameras listed as individual devices which
which you can add.  The code that you need for each is the same code you used when setting up homebridge.  It should be in
the output when you start homebridge, or in your homebridge `config.json` file.
Walk through the setup pages and when you are done, you should see several devices related to the camera:

  * Camera Feed
    * Shows a snapshot from the camera while viewing the room in Home
    * Shows a live feed from the camera if you click on it.  The feed supports video out of the box, and will supply audio as well if you have `ffmpeg` with `libfdk_aac` installed.  See the [FFmpeg wiki](https://github.com/dgreif/ring/wiki/FFmpeg#homebridge-audio-support) for details on audio support. Camera streams may not work on some networks with strict NAT settings.
  * Motion Sensor
    * Can be hidden with `hideCameraMotionSensor`
  * Light (if camera is equipped)
  * Siren Switch (if camera is equipped)
    * Can be hidden with `hideCameraSirenSwitch`
  * In-Home Doorbell Switch (if doorbell is equipped)
    * This will turn your physical in-home doorbell (mechanical/digital) on and off.  Useful for automating situations where you don't want your in-home doorbell to ring during certain situations, such as when a child's night light is on, or during certain hours of the night.
    * Can be hidden with `hideInHomeDoorbellSwitch`
  * Programmable switch for doorbells (triggers `Single Press` actions)
    * Note: doorbell event notifications should be configured via settings on the camera feed
    * Can be hidden with `hideDoorbellSwitch`

**Battery Camera Limitations** - There are limitations with how frequently battery cameras can take snapshots.  See [the Battery Cam Snapshots Wiki](https://github.com/dgreif/ring/wiki/Battery-Cam-Snapshots) for details.

If you turn on notifications for the motion sensors, or for any doorbell camera, you will get rich notifications from
HomeKit with a snapshot from the camera

If you are having issues with your cameras in the Home app, please see the [Camera Troubleshooting Wiki](https://github.com/dgreif/ring/wiki/Camera-Troubleshooting)

### Supported Devices via Ring Alarm and Ring Smart Lighting Hubs
  * Security Panel
    * This is a software device that represents the alarm for a Ring location
    * Arm Home / Arm Away / Disarm alarm for Ring location.
    * Detect active burglar alarm
    * Sound/silence siren (shows as a "Ring Alarm Siren" switch, can be hidden with `hideAlarmSirenSwitch`)
  * Base Station
    * Set Volume (Not currently supported in Home, but works in other apps like Eve)
    * Battery status
    * Can be hidden with `hideUnsupportedServices`
  * Keypad
    * Set Volume (Not currently supported in Home, but works in other apps like Eve)
    * Battery status
    * Can be hidden with `hideUnsupportedServices`
  * Contact Sensor
    * Detect if sensor is open or closed
    * Tamper status
    * Battery status
  * Motion Sensor
    * Detect motion
    * Tamper status
    * Battery status
  * Flood/Freeze Sensor
    * Detect water leak
    * Detect freezing temperature
      * Shows as an occupancy sensor in HomeKit because there is no "Freeze" sensor service.  "Occupied" indicates that freezing temperatures have been detected
    * Tamper status
    * Battery status
  * Freeze Sensor (**untested**)
    * Detect freezing temperature
    * Shows as an occupancy sensor in HomeKit because there is no "Freeze" sensor service.  "Occupied" indicates that freezing temperatures have been detected
    * Has not been confirmed to work yet.  Please open an issue on GitHub if you have a Freeze Sensor (not the flood/freeze sensor) and can test it out for me
    * Tamper status
    * Battery status
  * Ring Smart Lights (Motion Detector, Flood/Path/Spot Lights, Transformer)
    * On/Off
    * Brightness Level
    * Detect motion
    * Battery Status
  * Smoke Alarm
  * Carbon Monoxide Alarm
  * Smoke/Carbon Monoxide Listener
  * Smart Locks
  * Fans
    * On/Off
    * Speed
  * Lights/Switches
    * On/Off
    * Brightness Level (if applicable)
    * Hue/Sat/Color Temp are _possible_, but currently not supported.
      Please open an issue if you have a device that you would be able to
      test these on.
  * Panic Buttons
    * These can be added by setting `showPanicButtons: true` in your config
    * Creates `Burglar Alarm` and `Fire Alarm` switches in a new `Panic Buttons` device in HomeKit
    * Use these at your own risk.  **I do not guarantee functionality in case of emergency, nor do I take responsibility for any false alarms**
    * If either switch is turned on, you will receive a call from Ring monitoring to verify the emergency, and then authorities will be dispatched

### Alarm Modes

Ring Mode | HomeKit Mode
--- | ---
Disarmed | Off
Home | Home
Away | Away
Home | Night

Entry delays and bypassed sensors (ex. for Home mode) are all controlled in the Ring app.
These settings will automatically be used by HomeKit.

**Note**: Using `Night` mode in HomeKit will activate `Home` mode on the Ring alarm.
HomeKit should immediately switch to `Home` to match.

### Siri Commands for Alarm

Siri Command | Outcome
--- | ---
`Set Ring Alarm to Away` | Away mode activated
`Arm my security system` | Away mode activated
`Set Ring Alarm to Stay` | Home mode activated
`Arm my security system for stay` | Home mode activated
`Disarm Ring Alarm` | Disarmed
`Disarm my security system` | Disarmed
`Turn on Ring Alarm` | Turns on Ring Alarm Siren (unless hideAlarmSirenSwitch is set)
`Turn off Ring Alarm` | Turns off Ring Alarm Siren (unless hideAlarmSirenSwitch is set)

### Changes Modes on Arrive/Leave Home

The Home app allows you to create an automation that runs when you arrive/leave home.  If you include an accessory or
scene that "allows access" to your home (e.g. Security System or Lock), the Home app will require you to manually verify
that you actually want to run the automation every time it gets triggered.  For anyone who wants to arm/disarm their
Ring Alarm automatically, this manual verification can be quite annoying.  To work around this issue, you can add two
"dummy" switches to you homebridge setup using [homebridge-dummy](https://www.npmjs.com/package/homebridge-dummy).  You
can then use these dummy switches to trigger your other automation (e.g. Arm/Disarm Ring Alarm).

#### Example Dummy Config
```json
{
    "accessories": [
        {
          "accessory": "DummySwitch",
          "name": "Arrived Home"
        },
        {
          "accessory": "DummySwitch",
          "name": "Left Home"
        }
    ]
}
```

#### Example Home Automations

Trigger | Action
--- | ---
People Arrive | Turn on "Arrived Home"
People Leave | Turn on "Left Home"
"Arrived Home" turns on | Set Ring Alarm mode to Off
"Left Home" turns on | Set Ring Alarm mode to Away

## Upgrading from v3 to v4

See https://github.com/dgreif/ring/wiki/Upgrading-from-v3-to-v4
