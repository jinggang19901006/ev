const path = require('path');

const ENV_ID = process.env.CLOUDBASE_ENV_ID || '';
const STATE_COLLECTION = process.env.CLOUDBASE_STATE_COLLECTION || 'ev_rescue_state';
const STATE_DOCUMENT = process.env.CLOUDBASE_STATE_DOCUMENT || 'primary';

let app;

function isEnabled() {
  return Boolean(ENV_ID);
}

function getApp() {
  if (!isEnabled()) {
    throw new Error('CLOUDBASE_ENV_ID 未配置');
  }
  if (!app) {
    const cloudbase = require('@cloudbase/node-sdk');
    const options = { env: ENV_ID };
    if (process.env.EV_CLOUDBASE_APIKEY) {
      options.accessKey = process.env.EV_CLOUDBASE_APIKEY;
    }
    app = cloudbase.init(options);
  }
  return app;
}

async function loadState() {
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
  return document && document.payload ? document.payload : null;
}

async function saveState(payload) {
  await getApp()
    .database()
    .collection(STATE_COLLECTION)
    .doc(STATE_DOCUMENT)
    .set({
      data: {
        payload,
        updated_at: new Date().toISOString()
      }
    });
}

async function uploadBuffer(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const cloudPath = [
    'ev-rescue',
    'order-photos',
    new Date().toISOString().slice(0, 10),
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
  envId: ENV_ID,
  isEnabled,
  loadState,
  saveState,
  uploadBuffer
};
