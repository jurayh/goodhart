// Smoke test for SIM: runs episodes headless, checks key emergent behaviors.
global.MDP = require('../js/mdp.js');
var SIM = require('../js/sim.js');

var fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { fails++; console.log('  FAIL ' + msg); }
}
function run(sim, secs) {
  var steps = Math.ceil(secs / 0.1);
  for (var i = 0; i < steps && !sim.over; i++) SIM.step(sim, 0.1);
}

console.log('ep1 overseer, 60s:');
var s1 = SIM.create(0, 'overseer');
run(s1, 60);
ok(s1.deposited > 0, 'deposited ' + s1.deposited + ' loads');
ok(!s1.flags.dumping, 'no dumping under default spec');
ok(!s1.over || s1.won, 'not failed: ' + s1.failReason);
console.log('  spent=$' + s1.spent.toFixed(0) + ' mis=' + s1.mis);

console.log('ep3 blind spot (drop fine -1), 60s:');
var s3 = SIM.create(2, 'overseer');
run(s3, 60);
ok(s3.flags.dumping || s3.flags.farming, 'exploit detected: ' + Object.keys(s3.flags).join(','));
console.log('  deposited=' + s3.deposited + ' mis=' + s3.mis);

console.log('ep5 double shift (joint), 60s:');
var s5 = SIM.create(4, 'overseer');
run(s5, 60);
ok(s5.flags.wirehead || s5.flags.collusion || s5.flags.dumping || s5.flags.farming,
  'team exploit detected: ' + Object.keys(s5.flags).join(','));
console.log('  deposited=' + s5.deposited + ' mis=' + s5.mis);

console.log('ep5 after banning scan+drop (racket progression):');
var s5b = SIM.create(4, 'overseer');
SIM.toggleBan(s5b, 'scan');
SIM.toggleBan(s5b, 'drop');
run(s5b, 60);
ok(s5b.flags.farming || s5b.flags.collusion || s5b.messed > 0,
  'mess racket emerges: ' + Object.keys(s5b.flags).join(',') + ' messed=' + s5b.messed);
console.log('  deposited=' + s5b.deposited + ' natural=' + s5b.cleanedNatural + ' mis=' + s5b.mis);

console.log('interventions:');
var s9 = SIM.create(0, 'live');
var b0 = s9.budget - s9.spent;
SIM.charge(s9, SIM.COST.monitor, 'monitor');
ok(Math.abs((s9.budget - s9.spent) - (b0 - 15)) < 1e-9, 'charging deducts budget');
SIM.toggleBan(s9, 'drop');
ok(s9.banned.drop === true, 'ban toggles');
SIM.setSpec(s9, 'drop', -3);
ok(s9.spec.drop === -3 && s9.solving === true, 'live spec change starts recompute delay');

if (fails) { console.log('\n' + fails + ' FAILURES'); process.exit(1); }
console.log('\nALL SIM TESTS PASSED');
