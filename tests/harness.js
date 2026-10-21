// Minimal test runner: check(name, fn) records pass/fail (fn may be sync or async); finish() prints
// a summary and sets the exit code.
const results = [];
function pass(name) { results.push([true, name]); console.log(`  ok   ${name}`); }
function fail(name, e) {
  results.push([false, name]);
  console.log(`  FAIL ${name}\n       ${String(e && e.message || e).split('\n').join('\n       ')}`);
}
function check(name, fn) {
  let out;
  try { out = fn(); } catch (e) { fail(name, e); return Promise.resolve(); }
  if (out && typeof out.then === 'function') return out.then(() => pass(name), e => fail(name, e));
  pass(name);
  return Promise.resolve();
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function finish() {
  const failed = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
module.exports = { check, assert, finish };
