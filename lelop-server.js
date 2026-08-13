const Module = require('module');
const path = require('path');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './src/bot' && parent && parent.filename === path.join(__dirname, 'server.js')) {
    return originalLoad.call(this, path.join(__dirname, 'src/lelop-bot.js'), parent, isMain);
  }
  return originalLoad.apply(this, arguments);
};

require('./server.js');
