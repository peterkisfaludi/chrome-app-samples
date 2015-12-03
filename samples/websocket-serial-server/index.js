function $(id) {
  return document.getElementById(id);
}

function log(text) {
  $('log').value += text + '\n';
}

var ws;

//////////////////////////////////////////////////////////////
//Serial port
const DEVICE_PATH = '/dev/ttySCRATCHX';
const serial = chrome.serial;

/* Interprets an ArrayBuffer as UTF-8 encoded string data. */
var ab2str = function(buf) {
  var bufView = new Uint8Array(buf);
  var encodedString = String.fromCharCode.apply(null, bufView);
  return decodeURIComponent(escape(encodedString));
};

/* Converts a string to UTF-8 encoding in a Uint8Array; returns the array buffer. */
var str2ab = function(str) {
  var encodedString = unescape(encodeURIComponent(str));
  var bytes = new Uint8Array(encodedString.length);
  for (var i = 0; i < encodedString.length; ++i) {
    bytes[i] = encodedString.charCodeAt(i);
  }
  return bytes.buffer;
};

var SerialConnection = function() {
  this.connectionId = -1;
  this.lineBuffer = "";
  this.boundOnReceive = this.onReceive.bind(this);
  this.boundOnReceiveError = this.onReceiveError.bind(this);
  this.onConnect = new chrome.Event();
  this.onReadLine = new chrome.Event();
  this.onError = new chrome.Event();
};

SerialConnection.prototype.onConnectComplete = function(connectionInfo) {
  if (!connectionInfo) {
    log("Serial Connection failed on " + DEVICE_PATH);
    return;
  }
  this.connectionId = connectionInfo.connectionId;
  chrome.serial.onReceive.addListener(this.boundOnReceive);
  chrome.serial.onReceiveError.addListener(this.boundOnReceiveError);
  this.onConnect.dispatch();
};

SerialConnection.prototype.onReceive = function(receiveInfo) {
  if (receiveInfo.connectionId !== this.connectionId) {
    return;
  }

  this.lineBuffer += ab2str(receiveInfo.data);

  var index;
  while ((index = this.lineBuffer.indexOf('\n')) >= 0) {
    var line = this.lineBuffer.substr(0, index + 1);
    this.onReadLine.dispatch(line);
    this.lineBuffer = this.lineBuffer.substr(index + 1);
  }
};

SerialConnection.prototype.onReceiveError = function(errorInfo) {
  if (errorInfo.connectionId === this.connectionId) {
    this.onError.dispatch(errorInfo.error);
  }
};

SerialConnection.prototype.connect = function(path) {
  serial.connect(path, this.onConnectComplete.bind(this))
};

SerialConnection.prototype.send = function(msg) {
  if (this.connectionId < 0) {
    throw 'Invalid connection';
  }
  serial.send(this.connectionId, str2ab(msg), function() {});
};

SerialConnection.prototype.disconnect = function() {
  if (this.connectionId < 0) {
    throw 'Invalid connection';
  }
  serial.disconnect(this.connectionId, function() {});
};

var connection = new SerialConnection();

connection.onConnect.addListener(function() {
  log('Connected to serial device: ' + DEVICE_PATH);
});

connection.onReadLine.addListener(function(line) {
  log('Read line from serial device: ' + line);
  //send to websocket
  ws.send(line);
});

connection.connect(DEVICE_PATH);

//////////////////////////////////////////////////////////////
//Server
var port = 9999;
var isServer = false;
if (http.Server && http.WebSocketServer) {
  // Listen for HTTP connections.
  var server = new http.Server();
  var wsServer = new http.WebSocketServer(server);
  server.listen(port);
  isServer = true;

  server.addEventListener('request', function(req) {
    var url = req.headers.url;
    if (url == '/')
      url = '/index.html';
    // Serve the pages of this chrome application.
    req.serveUrl(url);
    return true;
  });

  // A list of connected websockets.
  var connectedSockets = [];

  wsServer.addEventListener('request', function(req) {
    log('WebSocket client connected');
    var socket = req.accept();
    connectedSockets.push(socket);

    
    // When a message is received on one socket, rebroadcast it on all
    // connected sockets.
    socket.addEventListener('message', function(e) {
      for (var i = 0; i < connectedSockets.length; i++)
        connectedSockets[i].send(e.data);
    });
    
    /*
    // When a message is received on serial, send it to client
    for (var i = 1; i < connectedSockets.length; i++) {
        connectedSockets[i].send('Serial message: X123Y456');
    }
    */

    // When a socket is closed, remove it from the list of connected sockets.
    socket.addEventListener('close', function() {
      log('WebSocket client disconnected');
      for (var i = 0; i < connectedSockets.length; i++) {
        if (connectedSockets[i] == socket) {
          connectedSockets.splice(i, 1);
          break;
        }
      }
    });
    return true;
  });
}

document.addEventListener('DOMContentLoaded', function() {
  log('This Websocket server relays Serial messages to all connected clients.');
// FIXME: Wait for 1s so that HTTP Server socket is listening...
setTimeout(function() {
  var address = isServer ? 'ws://localhost:' + port + '/' :
      window.location.href.replace('http', 'ws');
  ws = new WebSocket(address);
  ws.addEventListener('open', function() {
    log('Connected');
  });
  ws.addEventListener('close', function() {
    log('Connection lost');
    $('input').disabled = true;
  });
  ws.addEventListener('message', function(e) {
    log(e.data);
  });
  $('input').addEventListener('keydown', function(e) {
    if (ws && ws.readyState == 1 && e.keyCode == 13) {
      ws.send(this.value);
      this.value = '';
    }
  });
}, 1e3);
});
