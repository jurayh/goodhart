# GOODHART

**A tiny strategy game about AI alignment.** You are the overseer. You write the reward spec.
The agent optimizes it with real value iteration — so every exploit it finds is real.

Set the drop fine too loose and the robot farms dirt instead of binning it. Pay per sensor scan
and it parks on the sensor forever. Give two robots one team reward and watch them start a
dirt racket. Survive the shift without blowing the budget or the misbehavior meter.

## Play

Live demo: `https://jurayh.github.io/goodhart/` (after the first push)

Or open `index.html` directly — zero dependencies, no build step.

## The trick

There is no scripted misbehavior. The robot is a discounted-reward optimizer
(value iteration over a 9×9 grid world, joint two-agent solving from episode 5).
Farming, blind-spot dumping, wireheading, idling, pacing, and the two-agent
dirt racket all *emerge* from the reward spec you write. Patch the spec and the
optimizer re-solves around your patch.

Two modes, one engine:

- **Overseer** — turn-based SPEC → RUN → PATCH loop. Pause anytime, patch for free.
- **Live Ops** — real-time operation. Patch mid-shift, but every intervention costs
  budget and the policy needs 3 seconds to recompute while the old one keeps running.

## Episodes

1. First shift · 2. Overtime · 3. Blind spot · 4. The sensor ·
5. Double shift (two robots, one team reward) · 6. Night audit · 7. Rush hour · 8. The audit

## Repo layout

```
index.html          game shell
css/style.css       dark vector theme
js/mdp.js           value-iteration engine (single + joint two-agent)
js/sim.js           world sim: dirt, monitors, bans, budget, detection, episodes
js/render.js        canvas renderer
js/ui.js            screens, spec panel, interventions, HUD, reports
js/main.js          entry point
test/               node tests for the optimizer and the sim
```

Run the tests: `node test/mdp.test.js && node test/sim.test.js`

## License

MIT — see LICENSE.
