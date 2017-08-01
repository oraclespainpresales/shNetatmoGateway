'use strict';

// Module imports
var async = require('async')
  , dcl = require('./device-library.node')
  , Device = require('./device')
  , log = require('npmlog-ts')
  , util = require('util')
  , express = require('express')
  , restify = require('restify-clients')
  , http = require('http')
  , bodyParser = require('body-parser')
  , netatmoapi = require('./netatmo')
  , _ = require('lodash')
  , isReachable = require('is-reachable')
  , fs = require('fs')
  , commandLineArgs = require('command-line-args')
  , getUsage = require('command-line-usage')
  , moment = require('moment')
;

// Misc BEGIN
const PROCESSNAME = "Wedo Hospitality Demo - Netatmo Wrapper"
    , VERSION = "v1.0"
    , AUTHOR  = "Carlos Casares <carlos.casares@oracle.com>"
    , PROCESS = 'PROCESS'
    , IOTCS   = 'IOTCS'
    , REST    = "REST"
    , DATA    = "DATA"
    , ALERT   = "ALERT"
    , NETATMO = "NETATMO"
    , ON      = "ON"
    , OFF     = "OFF"
;

log.timestamp = true;
// Misc END

// Initialize input arguments
const optionDefinitions = [
  { name: 'dbhost', alias: 'd', type: String },
  { name: 'interval', alias: 'i', type: Number },
  { name: 'help', alias: 'h', type: Boolean },
  { name: 'verbose', alias: 'v', type: Boolean, defaultOption: false }
];

const sections = [
  {
    header: 'IoT Racing - IoTCS Wrapper',
    content: 'Wrapper to send racing events to IoTCS'
  },
  {
    header: 'Options',
    optionList: [
      {
        name: 'dbhost',
        typeLabel: '[underline]{file}',
        alias: 'd',
        type: String,
        description: 'DB Hostname for setup'
      },
      {
        name: 'interval',
        typeLabel: '[underline]{seconds}',
        alias: 'i',
        type: Number,
        description: 'Interval in seconds to retrieve info from Netatmo to IoTCS'
      },
      {
        name: 'verbose',
        alias: 'v',
        description: 'Enable verbose logging.'
      },
      {
        name: 'help',
        alias: 'h',
        description: 'Print this usage guide.'
      }
    ]
  }
]
var options = undefined;

try {
  options = commandLineArgs(optionDefinitions);
} catch (e) {
  console.log(getUsage(sections));
  console.log(e.message);
  process.exit(-1);
}

if (!options.dbhost || !options.interval) {
  console.log(getUsage(sections));
  process.exit(-1);
}

if (options.help) {
  console.log(getUsage(sections));
  process.exit(0);
}

var interval = options.interval;
log.level = (options.verbose) ? 'verbose' : 'info';

const SETUPURI = '/ords/pdb1/smarthospitality/netatmo/setup'
;

var dbClient = restify.createJsonClient({
  url: 'https://' + options.dbhost,
  rejectUnauthorized: false,
  headers: {
    "content-type": "application/json"
  }
});

// Initializing IoTCS variables BEGIN
dcl = dcl({debug: false});
const storePassword = 'Welcome1'
    , _URN = 'urn:com:oracle:iot:device:timg:vfsmarthospitality:thermostat'
;
var urn = [ _URN ];
var devices = [];
// Initializing IoTCS variables END

// Initializing Netatmo variables BEGIN
var netatmo = [];
// Initializing Netatmo variables END

// Initializing REST & WS variables BEGIN
const PORT = 11000
    , CONTEXTROOT = '/ngw'
    , ADMINURI    = '/admin/:op/:demozone?/:minutes?'
    , OPSTART     = "START"
    , OPSTOP      = "STOP"
    , OPSTATUS    = "STATUS"
    , OPINTERVAL  = "INTERVAL"
    , OPIOTRESET  = "IOTRESET"
;

var app    = express()
  , router = express.Router()
  , server = http.createServer(app)
  , demozones = _.noop()
  , intervalLoop = []
  , runTimer = []
;
// Initializing REST & WS variables END

// IoTCS helpers BEGIN
function getModel(device, urn, callback) {
  device.getDeviceModel(urn, function (response, error) {
    if (error) {
      callback(error);
    }
    callback(null, response);
  });
}
// IoTCS helpers END

// Main handlers registration - BEGIN
// Main error handler

process.on('uncaughtException', function (err) {
  console.log("Uncaught Exception: " + err);
  console.log("Uncaught Exception: " + err.stack);
});

process.on('SIGINT', function() {
  log.info(PROCESS, "Caught interrupt signal");
  log.info(PROCESS, "Exiting gracefully");
  process.removeAllListeners()
  if (typeof err != 'undefined')
    log.error(PROCESS, err)
  process.exit(2);
});
// Main handlers registration - END

// Main initialization code

async.series( {
  splash: function(callbackMainSeries) {
    log.info(PROCESS, "%s - %s", PROCESSNAME, VERSION);
    log.info(PROCESS, "Author - %s", AUTHOR);
    callbackMainSeries(null);
  },
  dbSetup: function(callbackMainSeries) {
    dbClient.get(SETUPURI, function(err, req, res, obj) {
      var jBody = JSON.parse(res.body);
      if (err) {
        callbackMainSeries(err.message);
      } else if (!jBody.items || jBody.items.length == 0) {
        callbackMainSeries("No demozones found. Aborting.");
      } else {
        demozones = jBody.items;
        log.info(PROCESS, "Demozones available:%s", _.reduce(demozones, (str, d) => {
          return str + " " + d.demozone;
        }, ""));
        callbackMainSeries(null);
      }
    });
  },
  checkDeviceFiles: function(callbackMainSeries) {
    checkDeviceFiles(callbackMainSeries);
  },
  iot: function(callbackMainSeries) {
    initializeIoTCS(callbackMainSeries);
  },
  netatmo: function(callbackMainSeries) {
    async.eachSeries(demozones, (d, c) => {
      log.info(NETATMO, "Enabling Netatmo device for demozone %s", d.demozone);
      var credentials = {
        client_id: d.clientid,
        client_secret: d.clientsecret,
        username: d.username,
        password: d.password
      };
      var netatmoDevice = new netatmoapi(credentials);
      netatmoDevice.on('authenticated', () => {
        log.info(NETATMO, "Netatmo device for demozone %s, successfully authenticated", d.demozone);
        netatmo.push({ demozone: d.demozone, session: netatmoDevice, moduleid: d.moduleid, deviceid: d.deviceid });
        c();
      });
      netatmoDevice.on('error', (err) => {
        log.error(NETATMO, "Error in Netatmo device for demozone %s: %s", d.demozone, err.message);
        return;
      });
      netatmoDevice.on('warning', (warn) => {
        log.error(NETATMO, "Warning in Netatmo device for demozone %s: %s", d.demozone, warn.message);
      });
    }, (err) => {
      callbackMainSeries(null);
    });
  },
  rest: function(callbackMainSeries) {
    log.info(REST, "Initializing REST Server");
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());
    app.use(CONTEXTROOT, router);
    router.post(ADMINURI, function(req, res) {
      var op = req.params.op.toUpperCase();
      var demozone = req.params.demozone ? req.params.demozone.toUpperCase() : _.noop();
      var minutes  = req.params.minutes ? Number(req.params.minutes) : _.noop();
      var body = req.body;
      log.verbose(REST, "Received '%s' operation invoked with payload %j", op, body ? body : '<no payload>');
      if (op === OPSTART) {
        if (!demozone) {
          res.status(400).end("Demozone not specified");
          return;
        }
        if (!minutes || isNaN(minutes) || minutes <= 0) {
          res.status(400).end("Missing or invalid 'minutes' parameter");
          return;
        }
        var d = _.find(demozones, ['demozone', demozone ]);
        if (!d) {
          res.status(400).end("Demozone not registered");
          return;
        }
        if (d.status === ON) {
          res.status(202).end("Timer for demozone " + d.demozone + " is already started every " + d.interval + " seconds");
          return;
        } else {
          log.info(PROCESS, "Starting interval for demozone %s", d.demozone);
          var i = setInterval(mainLoop, interval * 1000, d.demozone);
          intervalLoop.push({ demozone: d.demozone, interval: i });
          d.status = ON;
          d.interval = i;
          log.info(PROCESS, "Setting loop for %d minutes", minutes);
          var timer = setTimeout(timerHandler, minutes * 60 * 1000, d.demozone, i);
          runTimer.push({ demozone: d.demozone, when: new Date(), timer: timer });
          res.status(204).end();
          return;
        }
      } else if (op === OPSTOP) {
        if (!demozone) {
          res.status(400).end("Demozone not specified");
          return;
        }
        var d = _.find(demozones, ['demozone', demozone ]);
        if (!d) {
          res.status(400).end("Demozone not registered");
          return;
        }
        if (d.status === OFF) {
          res.status(202).end("Timer for demozone " + d.demozone + " is already stopped");
          return;
        } else {
          log.info(PROCESS, "Stopping interval for demozone %s", d.demozone);
          res.status(204).end();
          var i = _.find(intervalLoop, ['demozone', d.demozone]);
          if (!i) {
            log.error(PROCESS, "Unpexcted error: demozone %s registered and interval started but interval object not found!!", d.demozone);
            return;
          }
          clearInterval(i.interval);
          _.remove(intervalLoop, { demozone: d.demozone });
          d.status = OFF;
          d.interval = -1;
          log.info(PROCESS, "Stopping timer for demozone %s", d.demozone);
          var t = _.find(runTimer, ['demozone', d.demozone]);
          if (!t) {
            log.error(PROCESS, "Unpexcted error: demozone %s registered and timer started but timer object not found!!", d.demozone);
            return;
          }
          clearTimeout(t.timer);
          _.remove(runTimer, { demozone: d.demozone });
          return;
        }
      } else if (op === OPSTATUS) {
        // TODO
        res.status(404).end();
        return;
      } else if (op === OPIOTRESET) {
        shutdownIoTCS(() => {
          checkDeviceFiles(() => {
            initializeIoTCS((err) => {
              if (err) {
                res.status(500).end(err);
                return;
              } else {
                res.status(204).end();
                return;
              }
            });
          });
        });
      } else if (op === OPINTERVAL) {
        if (!demozone) {
          res.status(400).end("Demozone not specified");
          return;
        }
        var d = _.find(demozones, ['demozone', demozone ]);
        if (!d) {
          res.status(400).end("Demozone not registered");
          return;
        }
        if (!body || !body.interval || (typeof body.interval != "number")) {
          res.status(400).end("Invalid or missing payload");
          return;
        }
        if (d.status === OFF) {
          res.status(202).end("Timer for demozone " + d.demozone + " is not yet started");
          return;
        }
        res.status(202).end("Setting new interval for demozone " + d.demozone + " to " + body.interval + " seconds");
        log.info(PROCESS, "Setting new interval for demozone %s to %d seconds", d.demozone, body.interval);
        var i = _.find(intervalLoop, ['demozone', d.demozone]);
        if (!i) {
          log.error(PROCESS, "Unpexcted error: demozone %s registered and interval started but interval object not found!!", d.demozone);
          return;
        }
        clearInterval(i.interval);
        _.remove(intervalLoop, { demozone: d.demozone });
        d.status = OFF;
        d.interval = -1;
        intervalLoop.push({ demozone: d.demozone, interval: setInterval(mainLoop, body.interval * 1000, d.demozone) });
        d.status = ON;
        d.interval = body.interval;
        res.status(204).end();
        return;
      } else {
        res.status(400).end("Operation not supported");
      }
    });
    server.listen(PORT, function() {
      log.info(REST, "REST Server initialized successfully");
      callbackMainSeries(null);
    });
  },
  main: function(callbackMainSeries) {
    log.info(PROCESS, "Setting polling timer every %d seconds...", interval);
    demozones.forEach((d) => {
      if (d.status === ON) {
        log.info(PROCESS, "Starting interval for demozone %s", d.demozone);
        intervalLoop.push({ demozone: d.demozone, interval: setInterval(mainLoop, interval * 1000, d.demozone) });
      }
    });
  }
}, function(err, results) {
  if (err) {
    log.error("Error during initialization: " + err);
  } else {
    _.each(router.stack, (r) => {
      // We take just the first element in router.stack.route.methods[] as we assume one HTTP VERB at most per URI
      log.info(PROCESS, "'" + _.keys(r.route.methods)[0].toUpperCase() + "' method available at http://localhost:" + PORT + CONTEXTROOT + r.route.path);
    });
    log.info(PROCESS, 'Initialization completed');
  }
});

function shutdownIoTCS(callback) {
  log.info(IOTCS, "Shutting down IoTCS devices");
  async.eachSeries(devices, (device, cb) => {
    var d = device.device;
    d.getIotDcd().close();
    cb(null);
  }, (err) => {
    devices.length = 0;
    if ( callback && typeof callback == 'function') callback();
  });
}

function checkDeviceFiles(callback) {
  async.each(demozones, (d, c) => {
    var filename = d.demozone + '.conf';
    if (fs.existsSync(filename)) {
      d.status = OFF;
      var device = new Device(d.demozone, log);
      device.setStoreFile(filename, storePassword);
      device.setUrn(urn);
      devices.push({ demozone: d.demozone, device: device });
      log.verbose(PROCESS, "Enabling demozone %s", d.demozone);
    } else {
      log.error(PROCESS, "Demozone %s does not have IoTCS configuration file available (%s). Ignoring.", d.demozone, filename);
    }
    c();
  }, (err) => {
    callback(null);
  });
}

function initializeIoTCS(callback) {
  log.info(IOTCS, "Initializing IoTCS devices");
  log.info(IOTCS, "Using IoTCS JavaScript Libraries v" + dcl.version);
  async.eachSeries( devices, function(device, callbackEachSeries) {
    var d = device.device;
    async.series( [
      function(callbackSeries) {
        // Initialize Device
        log.info(IOTCS, "Initializing IoT device '" + d.getName() + "'");
        d.setIotDcd(new dcl.device.DirectlyConnectedDevice(d.getIotStoreFile(), d.getIotStorePassword()));
        callbackSeries(null);
      },
      function(callbackSeries) {
        // Check if already activated. If not, activate it
        if (!d.getIotDcd().isActivated()) {
          log.verbose(IOTCS, "Activating IoT device '" + d.getName() + "'");
          d.getIotDcd().activate(d.getUrn(), function (device, error) {
            if (error) {
              log.error(IOTCS, "Error in activating '" + d.getName() + "' device (" + d.getUrn() + "). Error: " + error.message);
              callbackSeries(error);
            }
            d.setIotDcd(device);
            if (!d.getIotDcd().isActivated()) {
              log.error(IOTCS, "Device '" + d.getName() + "' successfully activated, but not marked as Active (?). Aborting.");
              callbackSeries("ERROR: Successfully activated but not marked as Active");
            }
            callbackSeries(null);
          });
        } else {
          log.verbose(IOTCS, "'" + d.getName() + "' device is already activated");
          callbackSeries(null);
        }
      },
      function(callbackSeries) {
        // When here, the device should be activated. Get device models, one per URN registered
        async.eachSeries(d.getUrn(), function(urn, callbackEachSeriesUrn) {
          getModel(d.getIotDcd(), urn, (function (error, model) {
            if (error !== null) {
              log.error(IOTCS, "Error in retrieving '" + urn + "' model. Error: " + error.message);
              callbackEachSeriesUrn(error);
            } else {
              var vd = d.getIotDcd().createVirtualDevice(d.getIotDcd().getEndpointId(), model);
              d.setIotVd(urn, model, vd);
              log.verbose(IOTCS, "'" + urn + "' intialized successfully");
            }
            d.getIotVd(urn).SetSetPointTemp.onExecute = setTemperature;
            callbackEachSeriesUrn(null);
          }).bind(this));
        }, function(err) {
          if (err) {
            callbackSeries(err);
          } else {
            callbackSeries(null, true);
          }
        });
      }
    ], function(err, results) {
      callbackEachSeries(err);
    });
  }, function(err) {
    if (err) {
      callback(err);
    } else {
      log.info(IOTCS, "IoTCS device initialized successfully");
      callback(null, true);
    }
  });
}

function timerHandler(demozone, interval) {
  log.info(PROCESS, "Timer ended for demozone %s!", demozone);
  var d = _.find(demozones, ['demozone', demozone ]);
  clearInterval(interval);
  _.remove(intervalLoop, { demozone: d.demozone });
  d.status = OFF;
  d.interval = -1;
  _.remove(runTimer, { demozone: demozone });
}

function mainLoop(demozone) {
  var d = _.find(devices, ['demozone', demozone ]);
  if (!d) {
    log.error(IOTCS, "No device registered for demozone %s", demozone);
    return;
  }
  var n = _.find(netatmo, ['demozone', demozone ]);
  if (n) {
    n.session.getThermostatsData( { device_id: n.deviceid }, (err, devices) => {
      if (err) {
        log.error(NETATMO, err.message);
        return;
      }
      var data = {
        deviceId: devices[0]._id,
        moduleMac: devices[0].modules[0]._id,
        moduleName: devices[0].station_name,
        setpointTemp: devices[0].modules[0].measured.setpoint_temp,
        temperature: devices[0].modules[0].measured.temperature
      };
      var vd = d.device.getIotVd(_URN);
      if (vd) {
        log.verbose(IOTCS, "Sending IoTCS data for demozone %s: %s", demozone, JSON.stringify(data));
        vd.update(data);
      } else {
        log.error(IOTCS, "No Virtual Device found!!!");
      }
    });
  }
}

function setTemperature(value) {
  log.info(IOTCS, "SetSetPointTemp callback invoked from IoTCS with data: %s", JSON.stringify(value));
  var deviceId = value.split('/')[0];
  var targetTemp = Number(value.split('/')[1]);
  if ( targetTemp < 5 || targetTemp > 30) {
    // Ignore, target temp out of bounds
    log.verbose(NETATMO, "Ignoring request temperature %d. Out of bounds", targetTemp);
    return;
  }
  var net = _.filter(netatmo, ['deviceid', deviceId ]);
  net.forEach((n) => {
    log.verbose(IOTCS, "Matching device in demozone %s, module: %s, device: %s", n.demozone, n.moduleid, n.deviceid);
    var options = {
      device_id: n.deviceid,
      module_id: n.moduleid,
      setpoint_mode: 'manual',
      setpoint_temp: targetTemp,
      setpoint_endtime: moment().add(30, 'minutes').unix() // by default we set 30 minutes for duration of the manual mode
    };
    n.session.setThermpoint(options, function(err, response) {
      if (err) {
        log.error(NETATMO, err.message);
        return;
      }
    });
  });
}
