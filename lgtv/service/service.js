// Minha TV root service. Homebrew Channel's elevate-service makes it run as
// root, so its calls to the application manager carry full permissions that
// an ordinary app does not get. ES5: the TV's Node.js can be very old.
var Service = require('webos-service');

var SERVICE_ID = 'io.github.marianovale.lgtv.service';
var APPMGR = 'luna://com.webos.applicationManager/';

var service = new Service(SERVICE_ID);

function respondFrom(message) {
  return function (response) {
    var payload = response && response.payload;
    if (!payload) {
      payload = { returnValue: false, errorText: 'applicationManager não respondeu' };
    }
    message.respond(payload);
  };
}

service.register('listLaunchPoints', function (message) {
  service.call(APPMGR + 'listLaunchPoints', {}, respondFrom(message));
});

service.register('launch', function (message) {
  var input = message.payload || {};
  if (typeof input.id !== 'string' || !input.id) {
    message.respond({ returnValue: false, errorText: 'faltou o id do app' });
    return;
  }
  var args = { id: input.id };
  if (input.params && typeof input.params === 'object') args.params = input.params;
  service.call(APPMGR + 'launch', args, respondFrom(message));
});

// The TV's inputs (names, and whether each one is sending a picture), from
// the external input manager. Not in the app list on webOS 4.
service.register('listInputs', function (message) {
  service.call('luna://com.webos.service.eim/getAllInputStatus', {}, respondFrom(message));
});

// Where the phone server listens and its access code, so the TV app can
// sync its settings with it and show the link for the phone.
service.register('phoneLink', function (message) {
  var link;
  try {
    link = require('./common').phoneLink();
  } catch (e) {
    message.respond({ returnValue: false, errorText: String(e && e.message || e) });
    return;
  }
  message.respond({ returnValue: true, port: link.port, token: link.token, url: link.url });
});

// Lets the screen show whether the elevation worked.
service.register('status', function (message) {
  message.respond({
    returnValue: true,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    node: process.version
  });
});
