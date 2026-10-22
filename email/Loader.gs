// SoloPrint emails: loader. This is the only code to paste into Apps Script (as Code.gs), once.
//
// Each time something runs, it uses the latest email/Code.gs from GitHub, so updates to the emails,
// backups and reminders arrive automatically, with no pasting or redeploying. It keeps a saved copy
// of the last version that worked, and emails you if anything goes wrong:
//   - GitHub can't be reached for a while (the saved copy keeps running)
//   - a new version has an error (the last good version keeps running)
//   - sending an email, a backup, a reminder or the 6-hourly check fails
// Each kind of problem is emailed at most once every 6 hours.
//
// The secret stays in Project Settings -> Script properties (SECRET), as before.

const LOADER_VERSION = 1;
const CODE_URL = 'https://raw.githubusercontent.com/jeffsolo49/SoloPrint/main/email/Code.gs';
const ALERT_EMAIL = 'jeffsolo49@gmail.com';
const CODE_CACHE_SECONDS = 15 * 60;     // how often to look for a new version
const ALERT_EVERY_SECONDS = 6 * 60 * 60;
const FETCH_FAILURES_BEFORE_ALERT = 3;
const EXPORTS = ['doPost', 'doGet', 'checkSetup', 'sendTestEmail', 'setupSchedules', 'setupWeeklyBackup', 'backupToDrive',
  'sendQuoteReminders', 'healthCheck', 'testLookup', 'connectMakerWorld', 'emailsFor', 'LOADER_VERSION_NEEDED'];

// What Apps Script runs. Each one passes through to the same-named function in Code.gs.
function doPost(e) { return run_('doPost', [e]); }
function doGet(e) { return run_('doGet', [e]); }
function checkSetup() { return run_('checkSetup', []); }
function sendTestEmail() { return run_('sendTestEmail', []); }
function setupSchedules() { return run_('setupSchedules', []); }
function setupWeeklyBackup() { return run_('setupWeeklyBackup', []); }
function backupToDrive() { return run_('backupToDrive', []); }
function sendQuoteReminders() { return run_('sendQuoteReminders', []); }
function healthCheck() { return run_('healthCheck', []); }
function testLookup() { return run_('testLookup', []); }
function connectMakerWorld() { return run_('connectMakerWorld', []); }

// Never called. Listing these makes Google ask for the same permissions Code.gs needs.
function permissions_() {
  MailApp.sendEmail; DriveApp.getRootFolder; UrlFetchApp.fetch; ScriptApp.newTrigger; CacheService.getScriptCache;
}

let loaded_ = null;

function run_(name, args) {
  let lib;
  try {
    lib = loadCode_();
  } catch (err) {
    alert_('load', 'The email code could not be loaded, so emails, backups and reminders are stopped.', err);
    throw err;
  }
  if (typeof lib[name] !== 'function') {
    const err = new Error(name + ' is missing from email/Code.gs.');
    alert_('missing-' + name, 'Part of the email code is missing.', err);
    throw err;
  }
  try {
    return lib[name].apply(null, args);
  } catch (err) {
    const what = { doPost: 'Sending order emails', backupToDrive: 'The weekly backup', sendQuoteReminders: 'Sending quote reminders',
      healthCheck: 'The 6-hourly check' }[name] || 'Running ' + name;
    alert_('error-' + name, what + ' failed.', err);
    throw err;
  }
}

// Latest code from GitHub (checked every 15 minutes), else the saved copy of the last good version.
function loadCode_() {
  if (loaded_) return loaded_;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('code');
  if (cached) {
    try { return (loaded_ = compile_(cached)); } catch (err) { cache.remove('code'); }
  }

  let fresh = '', fetchError = null;
  try {
    const res = UrlFetchApp.fetch(CODE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) fresh = res.getContentText();
    else fetchError = new Error('GitHub replied ' + res.getResponseCode());
  } catch (err) {
    fetchError = err;
  }

  if (fresh) {
    cache.remove('fetchFailures');
    try {
      const lib = compile_(fresh);
      cache.put('code', fresh, CODE_CACHE_SECONDS);
      if (fresh !== savedCode_()) saveCode_(fresh);
      return (loaded_ = lib);
    } catch (err) {
      alert_('bad-update', 'A new version of the email code has an error, so the last version that worked is still running.', err);
    }
  } else {
    const failures = Number(cache.get('fetchFailures') || 0) + 1;
    cache.put('fetchFailures', String(failures), ALERT_EVERY_SECONDS);
    if (failures >= FETCH_FAILURES_BEFORE_ALERT) {
      alert_('fetch', "GitHub couldn't be reached to check for new email code. The saved copy is still running, so emails should still send.", fetchError);
    }
  }

  const saved = savedCode_();
  if (!saved) throw new Error('No email code: GitHub could not be reached and there is no saved copy yet. ' + (fetchError || ''));
  const lib = compile_(saved);
  cache.put('code', saved, CODE_CACHE_SECONDS);
  return (loaded_ = lib);
}

// Turns the code text into its functions, and checks it can build a sample email before it's used.
function compile_(code) {
  const lib = new Function(code + '\n;return {' + EXPORTS.map(n => n + ': typeof ' + n + " === 'undefined' ? undefined : " + n).join(', ') + '};')();
  if (typeof lib.doPost !== 'function' || typeof lib.emailsFor !== 'function') throw new Error('doPost or emailsFor is missing.');
  const sample = lib.emailsFor('INSERT', { id: 'test', clientName: 'Test', clientEmail: 'test@example.com', createdAt: new Date().toISOString(),
    items: [{ name: 'Test', qty: 1, filType: 'black', minutes: 60, grams: 20 }] }, null, {});
  if (!Array.isArray(sample) || !sample.length || !sample.every(m => m.to && m.subject && m.body)) throw new Error('The sample email came out empty.');
  if (lib.LOADER_VERSION_NEEDED > LOADER_VERSION) {
    alert_('loader', 'The email code needs a newer loader. Paste email/Loader.gs from GitHub into Apps Script and deploy a new version.', null);
  }
  return lib;
}

// The saved copy lives in Script properties, compressed and split (each property holds up to 9 KB).
function savedCode_() {
  const props = PropertiesService.getScriptProperties();
  const parts = Number(props.getProperty('SAVED_CODE_PARTS') || 0);
  if (!parts) return '';
  try {
    let b64 = '';
    for (let i = 0; i < parts; i++) b64 += props.getProperty('SAVED_CODE_' + i) || '';
    return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString();
  } catch (err) {
    return '';
  }
}

function saveCode_(code) {
  const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(code, 'text/plain')).getBytes());
  const values = { SAVED_CODE_PARTS: '0' };
  let parts = 0;
  for (let i = 0; i < b64.length; i += 8000) values['SAVED_CODE_' + parts++] = b64.slice(i, i + 8000);
  values.SAVED_CODE_PARTS = String(parts);
  PropertiesService.getScriptProperties().setProperties(values);
}

// Emails the owner about a problem, at most once per kind of problem every 6 hours.
function alert_(kind, what, err) {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('alerted:' + kind)) return;
    cache.put('alerted:' + kind, '1', ALERT_EVERY_SECONDS);
    const details = err ? String(err && err.stack || err) : '';
    MailApp.sendEmail({
      to: ALERT_EMAIL,
      subject: 'SoloPrint emails need attention',
      name: 'SoloPrint',
      body: [
        what,
        '',
        details ? 'Details: ' + details : '',
        '',
        'What to do: paste this email into your chat with Claude. You can also open Apps Script -> Executions',
        '(https://script.google.com) to see each run. You will get this email at most once every 6 hours for this problem.'
      ].join('\n')
    });
  } catch (mailErr) {
    Logger.log('Could not send the alert email: ' + mailErr);
  }
}
