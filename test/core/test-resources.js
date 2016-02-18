'use strict';

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-things'));
const mockery = require('mockery');
const upath = require('upath');
const sinon = require('sinon');
chai.use(require('sinon-chai'));

let Ravel, Resource, fs, stub, coreSymbols;

describe('Ravel', function() {
  beforeEach(function(done) {
    //enable mockery
    mockery.enable({
      useCleanCache: true,
      warnOnReplace: false,
      warnOnUnregistered: false
    });

    fs = require('fs');
    mockery.registerMock('fs', fs);
    mockery.registerMock('fs-readdir-recursive', function(basePath) { //eslint-disable-line no-unused-vars
      return ['test1.js', 'test2.js', '.eslintrc'];
    });

    Ravel = new (require('../../lib/ravel'))();
    Resource = require('../../lib/ravel').Resource;
    coreSymbols = require('../../lib/core/symbols');
    Ravel.Log.setLevel(Ravel.Log.NONE);
    Ravel.kvstore = {}; //mock Ravel.kvstore, since we're not actually starting Ravel.
    done();
  });

  afterEach(function(done) {
    Ravel = undefined;
    Resource = undefined;
    coreSymbols = undefined;
    mockery.deregisterAll();
    mockery.disable();
    if (stub) {
      stub.restore();
    }
    done();
  });


  describe('#resources()', function() {
    it('should allow clients to recursively register resource files for instantiation in Ravel.start, ignoring non-js files', function(done) {
      stub = sinon.stub(fs, 'lstatSync', function() {
        return {
          isDirectory: function(){return true;}
        };
      });

      mockery.registerMock(upath.join(Ravel.cwd, './resources/test1.js'), class extends Resource {});
      mockery.registerMock(upath.join(Ravel.cwd, './resources/test2.js'), class extends Resource {});
      Ravel.resources('./resources');
      expect(Ravel[coreSymbols.resourceFactories]).to.have.property('resources/test1.js');
      expect(Ravel[coreSymbols.resourceFactories]['resources/test1.js']).to.be.a('function');
      expect(Ravel[coreSymbols.resourceFactories]).to.have.property('resources/test2.js');
      expect(Ravel[coreSymbols.resourceFactories]['resources/test2.js']).to.be.a('function');
      expect(Ravel[coreSymbols.resourceFactories]).to.not.have.property('.eslintrc');
      done();
    });

    it('should throw an ApplicationError.IllegalValue when supplied with a base path which is not a directory', function(done) {
      stub = sinon.stub(fs, 'lstatSync', function() {
        return {
          isDirectory: function(){return false;}
        };
      });

      const test = function() {
        Ravel.resources();
      };
      expect(test).to.throw(Ravel.ApplicationError.IllegalValue);
      done();
    });
  });
});
