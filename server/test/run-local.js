'use strict';
/* Starts the real server against an in-memory Postgres (pg-mem) so the e2e scripts can run without
   touching any real database. NEVER point this at production -- it ignores DATABASE_URL on purpose.
     node test/run-local.js            (then, in another shell: node test/e2e.js) */
const { newDb } = require('pg-mem');
const mem = newDb();
const pg = mem.adapters.createPg();
const Module = require('node:module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'pg') return { Pool: pg.Pool, types: { setTypeParser() {} } };
  return realLoad.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'pg-mem://local';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-test-secret-' + 'x'.repeat(40);
process.env.PORT = process.env.PORT || '3100';
require('../server.js');
