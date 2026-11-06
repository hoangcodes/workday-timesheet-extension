// Workday Time Entry Importer — gif registry.
// Loaded as a content script (isolated world) BEFORE content.js, so it exposes
// window.OAI_GIFS for the scan-progress modal ("Grab data").
//
// Pinned chances must sum to exactly 100 (currently 100). To add a gif: append a { url, alt } entry below. Images load straight from the remote CDN.
//
// Optional per-entry fields:
//   • chance  – pin a probability (percentage, may be fractional e.g. 0.5). Entries WITHOUT
//               a chance split the leftover evenly; the total is normalised to 100% at roll
//               time (see rollGif in content.js), so adding more gifs later just works.
//   * displayChance - the percentage SHOWN to the user, overriding the real odds (cat_wtf really rolls at 0.25% but still claims 1%).
window.OAI_GIFS = [
  { url: 'https://cdn3.emoji.gg/emojis/666930-catrun.gif',                alt: 'catRun', chance: 11.4 },
  { url: 'https://cdn3.emoji.gg/emojis/257763-dancingcat.gif',            alt: 'dancingCat', chance: 15.2 },
  { url: 'https://cdn3.emoji.gg/emojis/656926-wiggletailcat.gif',         alt: 'wiggletailcat', chance: 20.6625 },
  { url: 'https://cdn3.emoji.gg/emojis/996211-pikachu.gif',               alt: 'pikachu', chance: 2.85 },
  { url: 'https://cdn3.emoji.gg/emojis/700719-hellokittysleighride.gif',  alt: 'helloKittySleighRide', chance: 9.5 },
  { url: 'https://cdn3.emoji.gg/emojis/281357-christmashellokitty.gif',   alt: 'christmasHelloKitty', chance: 7.6 },
  { url: 'https://cdn3.emoji.gg/emojis/136245-sneakycat.gif',             alt: 'sneakycat', chance: 15.2 },
  { url: 'https://cdn3.emoji.gg/emojis/572505-totoro-bye.gif',            alt: 'totoro', chance: 6.65 },
  { url: 'https://cdn3.emoji.gg/emojis/29323-doggorun.gif',               alt: 'Doggorun', chance: 3.8 },
  { url: 'https://cdn3.emoji.gg/emojis/8196-yoshi-bonk.gif',              alt: 'yoshi_bonk', chance: 1.9 },
  { url: 'https://cdn3.emoji.gg/emojis/366752-cat.gif',                  alt: 'cat', chance: 5 },
  { url: 'https://cdn3.emoji.gg/emojis/13344-cat-wtf.gif',                alt: 'cat_wtf', chance: 0.2375, displayChance: 1 },
];
