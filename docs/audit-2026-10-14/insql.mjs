import { sql } from '/home/user/lastdonor/node_modules/drizzle-orm/index.js';
import { PgDialect } from '/home/user/lastdonor/node_modules/drizzle-orm/pg-core/index.js';
const d = new PgDialect();
const ids = ['a1','b2','c3'];
console.log('IN ${arr}      ->', JSON.stringify(d.sqlToQuery(sql`select 1 where id IN ${ids}`)));
console.log('IN (${arr})    ->', JSON.stringify(d.sqlToQuery(sql`select 1 where id IN (${ids})`)));
