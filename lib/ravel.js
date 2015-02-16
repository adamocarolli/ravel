'use strict';

/**
 * This module provides Ravel, a lightweight framework
 * for the rapid creation of MVPs which scale horizontally
 * with ease and support the latest in web technology.
 */
module.exports = function() {
  var Ravel = {
    modules: {},
    ApplicationError:require('./util/application_error'),
    //current working directory of the app using the
    //ravel library, so that client modules can be
    //loaded with relative paths.
    cwd: process.cwd()
  };
  Ravel._moduleFactories = {};
  Ravel._resourceFactories = {};
  Ravel._routesFactories = {};
  Ravel._rooms = {};
  Ravel._knownParameters = {};
  Ravel._params = {};

  //set up core event emitter
  Ravel._eventEmitter = new (require('events')).EventEmitter();
  Ravel.on = function(e, func) {
    Ravel._eventEmitter.on(e, func);
  };
  Ravel.once = function(e, func) {
    Ravel._eventEmitter.once(e, func);
  };

  //init database provider prototype
  require('./db/database_provider')(Ravel);
  //init authorization provider prototype
  require('./auth/authorization_provider')(Ravel);
  //init parameter system
  require('./core/params')(Ravel, Ravel._knownParameters, Ravel._params);
  //init logging system
  require('./util/log')(Ravel);

  //init dependency injection utility, which is used by most everything else
  var injector = require('./util/injector')(
    Ravel, Ravel._moduleFactories, module.parent);

  //init module registration (Ravel.module)
  require('./core/module')(Ravel, Ravel._moduleFactories, injector);

  //init routes registration (Ravel.routes)
  require('./core/route')(Ravel, Ravel._routesFactories, injector);

  //init resource registration (Ravel.resource)
  require('./core/resource')(Ravel, Ravel._resourceFactories, injector);

  //init websocket room registration (Ravel.room)
  require('./core/room')(Ravel, Ravel._rooms);

  /**
   * Much like start(), but only initializes modules for
   * testing purposes. Resources, routes and rooms are
   * not initialized, and no web server is started.
   */
  Ravel.test = function() {
    Ravel._eventEmitter.emit('start');
    Ravel.db = require('./db/database')(Ravel);
    Ravel.set('always rollback transactions', true);
    Ravel.kvstore = require('./util/kvstore')('ravel_prefix', Ravel);
    Ravel.kvstore.flushdb();

    //create registered modules using factories
    for (var moduleName in Ravel._moduleFactories) {
      Ravel._moduleFactories[moduleName]();
    }
  };

  /**
   * Starts the application, when the client is finished
   * supplying parameters and registering modules, resources
   * routes and rooms.
   */
  Ravel.start = function() {
    Ravel._eventEmitter.emit('start');
    Ravel.db = require('./db/database')(Ravel);
    Ravel.kvstore = require('./util/kvstore')('ravel_prefix', Ravel);

    //App dependencies.
    var express = require('express');
    var session = require('express-session');
    var compression = require('compression');
    var favicon = require('serve-favicon');
    var cookieParser = require('cookie-parser');
    var http = require('http'); //https will be provided by reverse proxy
    var path = require('path');
    var passport = require('passport');
    var Primus = require('primus.io');
    var ExpressRedisStore = require('connect-redis')(session);

    //configure express
    var app = express();
    app.disable('x-powered-by');
    //configure redis session store
    var sessionStoreArgs = {
      host:Ravel.get('redis host'),
      port:Ravel.get('redis port'),
      db:0 //we stick to 0 because clustered redis doesn't support multiple dbs
    };
    if (Ravel.get('redis password')) {
      sessionStoreArgs.pass = Ravel.get('redis password');
    }
    var expressSessionStore = new ExpressRedisStore(sessionStoreArgs);

    app.set('domain', Ravel.get('node domain'));
    app.set('port', Ravel.get('node port'));
    app.set('app domain', Ravel.get('app domain'));
    app.set('app port', Ravel.get('app port'));
    app.enable('trust proxy');
    //configure views
    app.set('views', path.join(Ravel.cwd, Ravel.get('express view directory')));
    app.set('view engine', Ravel.get('express view engine'));
    //app.use(require('morgan')('dev')); //uncomment to see HTTP requests
    app.use(compression());
    if (Ravel.get('express favicon path')) {
      app.use(favicon(path.join(Ravel.cwd, Ravel.get('express favicon path'))));
    }
    app.use(require('body-parser').json());
    app.use(require('method-override')());
    app.use(cookieParser(Ravel.get('express session secret')));
    app.use(session({
      store: expressSessionStore,
      secret:Ravel.get('express session secret'),
      resave:true,
      saveUninitialized:true
    }));
    //cross-site scripting protection, with mobile app support
    app.use(require('./auth/csrf')(Ravel));
    app.use(function(req, res, next){
      if (req.csrfToken) {
        res.locals.token = req.csrfToken();
      }
      next();
    });
    app.use(express.static(path.join(Ravel.cwd, Ravel.get('express public directory'))));
    app.use(require('connect-flash')());

    //initialize passport authentication
    app.use(passport.initialize());
    app.use(passport.session());
    require('./auth/passport_init.js')(Ravel, app, injector, passport);
    Ravel.authorize = require('./auth/authorize_request')(Ravel, false, true);
    Ravel.authorizeWithRedirect = require('./auth/authorize_request')(Ravel, true, true);

    //Create ExpressJS server
    var server = http.createServer(app);

    //Pass server to Primus to get it going on the same port
    //Initialize primus.io with room handling, etc.
    var primus = new Primus(server, { transformer: 'websockets', parser: 'JSON' });
    //primus_init produces a configured, cluster-ready broadcasting library
    var broadcast = require('./auth/primus_init.js')(
      Ravel, primus, expressSessionStore, require('./util/websocket_room_resolver')(Ravel._rooms));
    //public version of broadcast, for client use
    Ravel.broadcast = {
      emit: broadcast.emit
    };

    //create registered modules using factories
    for (var moduleName in Ravel._moduleFactories) {
      Ravel._moduleFactories[moduleName]();
    }

    //create registered resources using factories
    for (var resourceName in Ravel._resourceFactories) {
      Ravel._resourceFactories[resourceName](app);
    }

    //create routes using factories
    for (var routesName in Ravel._routesFactories) {
      Ravel._routesFactories[routesName](app);
    }

    //Start ExpressJS server
    server.listen(Ravel.get('node port'), function(){
      Ravel.Log.info('Application server at ' + Ravel.get('node domain') +
        ' listening on port ' + Ravel.get('node port'));
    });
  };

  //Register known ravel parameters
  //database providers
  Ravel.registerSimpleParameter('database providers', true);
  Ravel.set('database providers', []);
  //authorization providers
  Ravel.registerSimpleParameter('authorization providers', true);
  Ravel.set('authorization providers', []);
  //redis parameters
  Ravel.registerSimpleParameter('redis host', true);
  Ravel.registerSimpleParameter('redis port', true);
  Ravel.registerSimpleParameter('redis password');
  Ravel.registerSimpleParameter('websocket message cache time');
  //Node/express parameters
  Ravel.registerSimpleParameter('app domain', true);
  Ravel.registerSimpleParameter('app port', true);
  Ravel.registerSimpleParameter('node domain', true);
  Ravel.registerSimpleParameter('node port', true);
  Ravel.registerSimpleParameter('express public directory', true);
  Ravel.registerSimpleParameter('express view directory', true);
  Ravel.registerSimpleParameter('express view engine', true);
  Ravel.registerSimpleParameter('express favicon path');
  Ravel.registerSimpleParameter('express session secret', true);
  Ravel.registerSimpleParameter('disable json vulnerability protection');
  //Passport parameters
  Ravel.registerSimpleParameter('app route', true);
  Ravel.registerSimpleParameter('login route', true);
  Ravel.registerSimpleParameter('get user function', true);
  Ravel.registerSimpleParameter('get or create user function', true);

  return Ravel;
};