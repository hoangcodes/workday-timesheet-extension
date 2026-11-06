# Surprise / GIF feature — rebuild notes

The "surprise" emote feature was **removed for the Chrome Web Store build** (Jul 2026).
Two likely policy reasons: (1) **single purpose** — a random-GIF/reward gimmick is unrelated to
the timesheet-import purpose; (2) **remote content** — the gifs loaded from the emoji.gg CDN.
Keep it out of the public/store build. It's fine for a personal/unlisted build.

This doc has everything needed to rebuild it.

---

## What it did

On the **Complete** modal (after Fill Timesheet), a **surprise** button rolled a random emote by
weighted probability, showed a spinner until the image loaded, then revealed the gif + a subtext
("this gif had a N% chance of appearing!") **at the same time** (revealing the % first spoils it).
One emote could carry a `reward` message. A popup **Preferences** toggle let users hide the button.

---

## Files & integration points

| File | What to add |
|---|---|
| `gifs.js` | NEW content script exposing `window.OAI_GIFS`. Register in manifest BEFORE `content.js`. |
| `manifest.json` | Add `gifs.js` to the isolated `content_scripts` `js` array. If bundling gifs locally, add `assets/*` back to `web_accessible_resources`. |
| `content.js` | `rollGif()`/`computeGifWeights()`, the surprise button + handler in `showCompletionModal`, emote preload, `_hideSurprise` pref plumbing. |
| `content.css` | `.oai-gif-img`, `.oai-gif-loading`, `.oai-gif-chance`, `.oai-gif-reward` (+ dark overrides in `buildThemeCSS`). |
| `popup/popup.html` | A **Preferences** `section-group` with the `surprise` toggle (`#oai-surprise-pref`). |
| `popup/popup.js` | Wire the toggle to `chrome.storage.sync` key `oai_hide_surprise`. |
| `popup/popup.css` | `.oai-pref-row` + `.oai-switch` styles (scope under `.oai-pref-row` so the global `.nav-item span{flex:1}` doesn't distort the switch). |

---

## gifs.js (the registry)

`window.OAI_GIFS` is a list of `{ url, alt, chance?, reward? }`.
- `chance` (optional) pins a percentage (may be fractional, e.g. `0.5`).
- entries WITHOUT a `chance` split the leftover budget; the total is normalised to 100% at roll time.
- `reward` (optional) shows an extra subtext line when that gif is rolled.

The exact list that shipped (emoji.gg CDN):

```js
window.OAI_GIFS = [
  { url: 'https://cdn3.emoji.gg/emojis/366752-cat.gif',                    alt: 'cat' },
  { url: 'https://cdn3.emoji.gg/emojis/666930-catrun.gif',                 alt: 'CatRun' },
  { url: 'https://cdn3.emoji.gg/emojis/257763-dancingcat.gif',             alt: 'DancingCat' },
  { url: 'https://cdn3.emoji.gg/emojis/656926-wiggletailcat.gif',          alt: 'wiggletailcat' },
  { url: 'https://cdn3.emoji.gg/emojis/79967-happy-shiba-tailwag.gif',     alt: 'happy_shiba_tailwag' },
  { url: 'https://cdn3.emoji.gg/emojis/679076-dogkeyboard.gif',            alt: 'DogKeyboard' },
  { url: 'https://cdn3.emoji.gg/emojis/996211-pikachu.gif',                alt: 'pikachu' },
  { url: 'https://cdn3.emoji.gg/emojis/700719-hellokittysleighride.gif',   alt: 'HelloKittySleighRide' },
  { url: 'https://cdn3.emoji.gg/emojis/281357-christmashellokitty.gif',    alt: 'ChristmasHelloKitty' },
  { url: 'https://cdn3.emoji.gg/emojis/747946-yoshi.gif',                  alt: 'Yoshi' },
  { url: 'https://cdn3.emoji.gg/emojis/136245-sneakycat.gif',              alt: 'sneakycat',  chance: 5 },
  { url: 'https://cdn3.emoji.gg/emojis/3516-scubbacat.gif',                alt: 'Scubbacat',  chance: 1 },
  { url: 'https://cdn3.emoji.gg/emojis/623251-shocked.gif',                alt: 'shocked',    chance: 1 },
  { url: 'https://cdn3.emoji.gg/emojis/29323-doggorun.gif',                alt: 'Doggorun',   chance: 2 },
  { url: 'https://cdn3.emoji.gg/emojis/8196-yoshi-bonk.gif',               alt: 'yoshi_bonk', chance: 1 },
  { url: 'https://cdn3.emoji.gg/emojis/13344-cat-wtf.gif',                 alt: 'cat_wtf',    chance: 0.5,
    reward: 'please screenshot this to Q, he owes you a coffee' },
];
```

> To avoid the remote-content flag, bundle these locally in `assets/` and set
> `url: chrome.runtime.getURL('assets/<file>')` instead — but see the CSP note below.

---

## Probability + roll logic (content.js)

Pinned chances are kept; unpinned get a RANDOM share of the leftover so the grand total is 100%.
Memoise so the displayed odds stay stable within a session.

```js
var _gifWeights = null, _gifWeightsLen = -1;
function computeGifWeights(list) {
  var pinnedSum = 0, unpinned = [];
  list.forEach(function (g, i) { if (typeof g.chance === 'number') pinnedSum += g.chance; else unpinned.push(i); });
  var budget  = Math.max(0, 100 - pinnedSum);
  var weights = list.map(function (g) { return typeof g.chance === 'number' ? g.chance : 0; });
  if (unpinned.length) {
    var rand = unpinned.map(function () { return Math.random(); });
    var rsum = rand.reduce(function (a, b) { return a + b; }, 0) || 1;
    unpinned.forEach(function (idx, k) { weights[idx] = budget * rand[k] / rsum; });
  }
  return weights;
}

function rollGif() {
  var list = ((window.OAI_GIFS && window.OAI_GIFS.length) ? window.OAI_GIFS : OAI_GIFS_FALLBACK).slice();
  if (!list.length) return null;
  if (!_gifWeights || _gifWeightsLen !== list.length) { _gifWeights = computeGifWeights(list); _gifWeightsLen = list.length; }
  var weights = _gifWeights, total = weights.reduce(function (a, w) { return a + w; }, 0) || 1;
  var roll = Math.random() * total, cum = 0, idx = 0;
  for (var i = 0; i < weights.length; i++) { cum += weights[i]; if (roll < cum) { idx = i; break; } }
  return { url: list[idx].url, alt: list[idx].alt || '',
           chance: +(weights[idx] / total * 100).toFixed(1), reward: list[idx].reward || '' };
}
```

Keep an inline `OAI_GIFS_FALLBACK` (same array) so the button still works if `gifs.js` didn't load.

---

## Completion-modal button + reveal (content.js, inside showCompletionModal)

Button in the actions row (respect the hide pref):
```js
(_hideSurprise ? '' : '<button class="oai-btn oai-btn--secondary" id="oai-surprise">surprise</button>') +
```

Preload the emotes when the modal opens so the reveal is quick:
```js
if (!_hideSurprise) {
  ((window.OAI_GIFS && window.OAI_GIFS.length) ? window.OAI_GIFS : OAI_GIFS_FALLBACK)
    .forEach(function (g) { if (g && g.url) { var pre = new Image(); pre.src = g.url; } });
}
```

Handler — spinner first, reveal gif + subtext together on `img.onload`:
```js
var surpriseBtn = modal.querySelector('#oai-surprise');
if (surpriseBtn) surpriseBtn.addEventListener('click', function () {
  var picked = rollGif(); if (!picked) return;
  var body = modal.querySelector('.oai-completion-body');
  var btn  = modal.querySelector('#oai-surprise'); if (btn) btn.style.display = 'none';
  var title = modal.querySelector('.oai-conf-title'); if (title) title.textContent = 'Surprise';
  body.innerHTML = '<div class="oai-gif-loading"><span class="oai-spinner oai-spinner--lg"></span></div>';
  var revealed = false;
  function reveal() {
    if (revealed) return; revealed = true;
    body.innerHTML =
      '<img src="' + esc(picked.url) + '" class="oai-gif-img" alt="' + esc(picked.alt) + '">' +
      '<div class="oai-gif-chance">this gif had a <strong>' + picked.chance + '%</strong> chance of appearing!</div>' +
      (picked.reward ? '<div class="oai-gif-reward">' + esc(picked.reward) + '</div>' : '');
  }
  var pre = new Image(); pre.onload = reveal; pre.onerror = reveal; pre.src = picked.url;
  if (pre.complete) reveal();
  setTimeout(reveal, 4000); // safety net
});
```

---

## Hide-pref plumbing (content.js)

- Module var: `var _hideSurprise = false;`
- On load: `chrome.storage.sync.get([...,'oai_hide_surprise'], p => { _hideSurprise = !!p.oai_hide_surprise; });`
- On change: in `chrome.storage.onChanged`, `if (changes.oai_hide_surprise) _hideSurprise = !!changes.oai_hide_surprise.newValue;`

## Popup toggle (positive framing, default ON)

HTML (a `section-group` labelled **Preferences**):
```html
<label class="nav-item oai-pref-row" for="oai-surprise-pref">
  <span>surprise</span>
  <span class="oai-switch">
    <input type="checkbox" id="oai-surprise-pref">
    <span class="oai-switch-track"><span class="oai-switch-thumb"></span></span>
  </span>
</label>
```
JS — the toggle means "surprise ON"; stored as the INVERSE `oai_hide_surprise` so content.js logic
stays the same; unset => ON by default:
```js
var t = document.getElementById('oai-surprise-pref');
chrome.storage.sync.get(['oai_hide_surprise'], p => { t.checked = !p.oai_hide_surprise; });
t.addEventListener('change', () => chrome.storage.sync.set({ oai_hide_surprise: !t.checked }));
```

---

## CSS classes to restore

- `content.css`: `.oai-gif-img { width:120px; height:120px; object-fit:contain; border-radius:8px }`,
  `.oai-gif-loading { display:flex; align-items:center; justify-content:center; width:120px; height:120px }`,
  `.oai-gif-chance, .oai-gif-reward { font-size:12px; color:#64748b }`.
  In `buildThemeCSS` dark section add: `.oai-gif-chance,.oai-gif-reward{color:<t2>!important}`.
- `popup/popup.css`: `.oai-pref-row` + `.oai-switch*` (scope every switch selector under `.oai-pref-row`
  so it out-specifies the global `.nav-item span { flex: 1 }` rule, otherwise the switch collapses).

---

## Hard-won gotchas (verified live on the OpenAir page)

- **CSP:** the OpenAir page does NOT block `chrome-extension:` images, `data:` images, or `emoji.gg`
  remote images (tested with a `securitypolicyviolation` listener — no violations). So image rendering
  is not a CSP problem.
- **Stale content script:** if you set `img.src = chrome.runtime.getURL('assets/..')` and the extension
  was reloaded but the page NOT refreshed, `chrome.runtime.getURL` runs in an invalidated context and
  the image never loads. Remote CDN URLs sidestep this (no getURL). If bundling locally, remember to
  refresh the page after every extension reload.
- **Cross-file globals:** `gifs.js` and `content.js` are separate content-script files but share ONE
  isolated world, so `window.OAI_GIFS` set in `gifs.js` is readable in `content.js`. Adding a new
  content-script file to the manifest requires a full **extension reload** (page refresh alone won't inject it).
- **Why it was pulled from the store:** single-purpose policy + remote content. If rebuilding for a
  public listing, bundle the gifs locally AND be prepared to justify the feature as part of the UX, or
  keep it in an unlisted/personal build only.
