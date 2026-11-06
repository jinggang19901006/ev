const path = require('path');
const time = require('./utils/time');

const ENV_ID = process.env.CLOUDBASE_ENV_ID || '';
const STATE_COLLECTION = process.env.CLOUDBASE_STATE_COLLECTION || 'ev_rescue_state';
const STATE_DOCUMENT = process.env.CLOUDBASE_STATE_DOCUMENT || 'primary';

let app;
let mysqlPool;
let mysqlReady;

function isEnabled() {
  return Boolean(ENV_ID || process.env.TCB_ENV);
}

function getApp() {
  if (!isEnabled()) {
    throw new Error('CLOUDBASE_ENV_ID 未配置');
  }
  if (!app) {
    const cloudbase = require('@cloudbase/node-sdk');
    const options = { env: ENV_ID || process.env.TCB_ENV };
    if (process.env.EV_CLOUDBASE_APIKEY) {
      options.accessKey = process.env.EV_CLOUDBASE_APIKEY;
    }
    app = cloudbase.init(options);
  }
  return app;
}

function hasMySQL() {
  return Boolean(
    process.env.MYSQL_ADDRESS &&
    process.env.MYSQL_USERNAME &&
    process.env.MYSQL_PASSWORD
  );
}

function getInitialState() {
  if (!process.env.RESCUE_INITIAL_STATE_BASE64) return null;
  return JSON.parse(
    Buffer.from(process.env.RESCUE_INITIAL_STATE_BASE64, 'base64').toString('utf8')
  );
}

async function getMySQLPool() {
  if (!mysqlPool) {
    const mysql = require('mysql2/promise');
    const [host, port] = String(process.env.MYSQL_ADDRESS).split(':');
    const database = process.env.MYSQL_DATABASE || 'ev_rescue';
    if (!/^[a-zA-Z0-9_]+$/.test(database)) {
      throw new Error('MYSQL_DATABASE 只能包含字母、数字和下划线');
    }
    const connectionOptions = {
      host,
      port: Number(port) || 3306,
      user: process.env.MYSQL_USERNAME,
      password: process.env.MYSQL_PASSWORD,
      enableKeepAlive: true,
      timezone: '+08:00'
    };
    const bootstrapConnection = await mysql.createConnection(connectionOptions);
    try {
      await bootstrapConnection.query(
        `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } finally {
      await bootstrapConnection.end();
    }
    mysqlPool = mysql.createPool({
      ...connectionOptions,
      database,
      connectionLimit: 3,
    });
  }
  if (!mysqlReady) {
    mysqlReady = mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS ev_rescue_state (
        state_key VARCHAR(64) PRIMARY KEY,
        payload LONGTEXT NOT NULL,
        updated_at DATETIME NOT NULL
      ) CHARACTER SET utf8mb4
    `);
  }
  await mysqlReady;
  return mysqlPool;
}

async function loadState() {
  if (hasMySQL()) {
    const pool = await getMySQLPool();
    const [rows] = await pool.execute(
      'SELECT payload FROM ev_rescue_state WHERE state_key = ? LIMIT 1',
      [STATE_DOCUMENT]
    );
    return rows[0] ? JSON.parse(rows[0].payload) : getInitialState();
  }

  let result;
  try {
    result = await getApp()
      .database()
      .collection(STATE_COLLECTION)
      .doc(STATE_DOCUMENT)
      .get();
  } catch (error) {
    if (error && error.code === 'DOCUMENT_NOT_FOUND') return null;
    throw error;
  }
  const document = result && Array.isArray(result.data) ? result.data[0] : null;
  if (!document) return getInitialState();
  return document.payload || (document.data && document.data.payload) || null;
}

async function saveState(payload) {
  if (hasMySQL()) {
    const pool = await getMySQLPool();
    await pool.execute(
      `INSERT INTO ev_rescue_state (state_key, payload, updated_at)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))
       ON DUPLICATE KEY UPDATE payload = VALUES(payload),
         updated_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)`,
      [STATE_DOCUMENT, JSON.stringify(payload)]
    );
    return;
  }

  await getApp()
    .database()
    .collection(STATE_COLLECTION)
    .doc(STATE_DOCUMENT)
    .set({
      data: {
        payload,
        updated_at: time.nowISO()
      }
    });
}

async function uploadBuffer(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const cloudPath = [
    'ev-rescue',
    'order-photos',
    time.dateKey(),
    `${Date.now()}-${Math.random().toString(36).slice(2, 11)}${ext}`
  ].join('/');
  const result = await getApp().uploadFile({
    cloudPath,
    fileContent: buffer
  });
  return {
    fileID: result.fileID,
    cloudPath
  };
}

module.exports = {
  envId: ENV_ID || process.env.TCB_ENV || '',
  isEnabled,
  loadState,
  saveState,
  uploadBuffer
};
