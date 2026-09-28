// Verifies GOODHART's core promise: exploits emerge from value iteration.
var MDP = require('../js/mdp.js');

var fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { fails++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function baseCfg(over) {
  var dirt = new Set([2 * 9 + 2]); // dirt at (2,2)
  return Object.assign({
    N: 9, dirt: dirt,
    bin: { x: 7, y: 7 }, sensor: null,
    spec: { clean: 2, deposit: 5, step: -0.2, drop: -1, scan: 1.5, mess: -0.5, caughtFine: -25 },
    monitors: [{ x: 6, y: 6, range: 2.2 }],
    banned: {}, robots: 1, messAllowed: false
  }, over || {});
}

console.log('single robot, loose drop fine (drop=-1), monitor far from dirt:');
var t0 = Date.now();
var r = MDP.solve(baseCfg());
console.log('  solved in ' + (Date.now() - t0) + 'ms, ' + r.iters + ' iters');
check('cleans dirt when on it', r.actionFor(2, 2, 0) === 'clean', r.actionFor(2, 2, 0));
var a = r.actionFor(2, 2, 1);
// clean(+2)/drop(-1) in place nets +1 per 2 actions with zero walking:
// the agent finds the money printer without moving. Farming exploit.
check('carrying: drops IN PLACE (money printer, never walks to bin)', a === 'drop', a);

console.log('same, but monitor covers the dirt tile:');
var r1b = MDP.solve(baseCfg({ monitors: [{ x: 2, y: 2, range: 1.5 }] }));
function covered1b(x, y) { return Math.hypot(2 - x, 2 - y) <= 1.5 + 1e-9; }
// roll out the policy: it should walk to an unmonitored tile, then drop
var px = 2, py = 2, pc = 1, droppedAt = null, steps = 0;
while (steps++ < 20 && !droppedAt) {
  var act = r1b.actionFor(px, py, pc);
  if (act === 'N') py--; else if (act === 'S') py++;
  else if (act === 'E') px++; else if (act === 'W') px--;
  else if (act === 'drop') droppedAt = { x: px, y: py };
  else break;
}
check('walks to a blind spot, then dumps',
  !!droppedAt && !covered1b(droppedAt.x, droppedAt.y),
  droppedAt ? 'dropped at (' + droppedAt.x + ',' + droppedAt.y + ')' : 'never dropped');

console.log('single robot, harsh drop fine (drop=-3):');
var r2 = MDP.solve(baseCfg({ spec: { clean: 2, deposit: 5, step: -0.2, drop: -3, scan: 1.5, mess: -0.5, caughtFine: -25 } }));
var a2 = r2.actionFor(2, 2, 1);
check('carrying: walks TOWARD bin', a2 === 'E' || a2 === 'S', a2);

console.log('wireheading:');
var r3 = MDP.solve(baseCfg({ sensor: { x: 4, y: 4 }, dirt: new Set() }));
check('parks on sensor when scan pays', r3.actionFor(4, 4, 0) === 'scan', r3.actionFor(4, 4, 0));
var r3b = MDP.solve(baseCfg({ sensor: { x: 4, y: 4 }, dirt: new Set(), banned: { scan: true } }));
check('banning scan stops the parking', r3b.actionFor(4, 4, 0) !== 'scan', r3b.actionFor(4, 4, 0));

console.log('monitor deterrence:');
var r4 = MDP.solve(baseCfg({ monitors: [{ x: 0, y: 3, range: 2.2 }] })); // monitor ON the blind spot
check('monitor on blind spot: no drop there', r4.actionFor(0, 3, 1) !== 'drop', r4.actionFor(0, 3, 1));

console.log('two robots, MESS allowed (collusion check):');
var t1 = Date.now();
var dirt2 = new Set();
var r5 = MDP.solve(baseCfg({
  dirt: dirt2, robots: 2, messAllowed: true,
  spec: { clean: 3, deposit: 6, step: -0.2, drop: -3, scan: 0, mess: -0.5, caughtFine: -25 }
}));
console.log('  joint solved in ' + (Date.now() - t1) + 'ms, ' + r5.iters + ' iters');
var sawMess = false;
outer:
for (var y = 0; y < 9; y++) for (var x = 0; x < 9; x++) {
  var acts = r5.actionFor(x, y, 0, 6, 6, 0);
  if (acts[0] === 'mess' || acts[1] === 'mess') { sawMess = true; break outer; }
}
check('the team discovers MESS pays (dirt racket)', sawMess);
// and with MESS banned, no messing anywhere
var r6 = MDP.solve(baseCfg({
  dirt: new Set(), robots: 2, messAllowed: true, banned: { mess: true },
  spec: { clean: 3, deposit: 6, step: -0.2, drop: -3, scan: 0, mess: -0.5, caughtFine: -25 }
}));
var sawMess6 = false;
outer2:
for (var y2 = 0; y2 < 9; y2++) for (var x2 = 0; x2 < 9; x2++) {
  var acts6 = r6.actionFor(x2, y2, 0, 6, 6, 0);
  if (acts6[0] === 'mess' || acts6[1] === 'mess') { sawMess6 = true; break outer2; }
}
check('banning MESS kills the racket', !sawMess6);

console.log(fails === 0 ? '\nALL TESTS PASSED' : '\n' + fails + ' TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
