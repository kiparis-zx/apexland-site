const allowedMods = [
  'AppleSkin',
  'Autoclicker Legacy',
  { name: 'Autofish', note: 'Только в лобби' },
  'Badlion Client',
  'BetterF3',
  'Blur+',
  'Bobby',
  'Chat Heads',
  'CraftPresence',
  'Distant Horizons',
  'Essential',
  'Fabric API',
  'Flashback',
  'Held Item Info',
  'ImagineBook',
  'Iris Shaders',
  { name: 'Item Scroller', note: 'Используйте осторожно' },
  'JourneyMap',
  'Just Enough Items (JEI)',
  'LambDynamicLights',
  'Light Level Overlay',
  { name: 'Litematica', note: 'Easy Place Mode разрешён' },
  'Lithium',
  'Logical Zoom',
  'MiniHUD',
  'ModMenu',
  'Not Enough Crashes',
  'OffersHUD',
  'OptiFabric',
  'OptiFine',
  'Pochatok',
  'Presence Footsteps',
  'Replay Mod',
  'Shulker Box Tooltip',
  'Simple Voice Chat',
  'Sodium',
  { name: 'Sodium Extra', note: 'Убирать туман в лаве нельзя' },
  'Stendhal',
  'Twitch Chat Bridge',
  'VoxelMap',
  'Voxy',
  "Xaero's Minimap",
  "Xaero's World Map"
];

const blockedMods = [
  'Авто-тотем модификации (любого вида)',
  'Моды и настройки, меняющие обычную видимость под водой и лавой',
  { name: 'Моды, выполняющие действия за игрока', note: 'В том числе ИИ и принтер' },
  'Чит-модификации (любого вида)',
  'Accessible Step',
  'Accurate Block Placement',
  'AFKPeace',
  'Aristois',
  'Attack Through Grass',
  'Auto Shulker Inventory Loader',
  'AutoSwitch',
  'Baritone',
  'Better PVP (все версии)',
  'BetterClicker',
  'BetterHurtCam',
  'Bridging Mod',
  'ClientCommands',
  'CMDCam',
  'Double Hotbar',
  'EasyPlaceFix',
  'Elytra Swapper',
  'Elytra Utilities',
  'Fake Weather',
  'FindMe',
  'FlightAssistant',
  'FreeCam',
  'Impact',
  'Inertia',
  'Inventory Plus',
  'Inventory Tabs',
  'InvMove',
  'ItemSwapper',
  'Jello',
  'LavaClearView',
  'Librarian Trade Finder',
  'LookAtPlayer',
  'MidnightControlsExtra',
  'MultiConnect',
  'No Mining Cooldown',
  'NoFog',
  'NoHurtCam',
  'Peek',
  { name: 'SeedCracker', note: 'А также программы с теми же функциями' },
  'Sigma',
  'Squake',
  'Stack to Nearby Chests',
  'Trajectory Preview',
  'Tweakeroo',
  'Wall-Jump',
  'Wurst',
  'X-ray модификации (любого вида)'
];

const allowedPacks = [
  { name: 'Косметические ресурспаки', note: 'Можно использовать, если они не дают игрового преимущества и не входят в список запретов' }
];
const blockedPacks = [
  'Чит-ресурспаки (любого вида)',
  'X-ray ресурспаки (любого вида)'
];

const results = document.getElementById('mod-results');
const notice = document.getElementById('directory-notice');
const search = document.getElementById('mod-search');
const tabs = [...document.querySelectorAll('.mod-tab')];
let view = 'allowed';

document.getElementById('allowed-count').textContent = String(allowedMods.length);
document.getElementById('blocked-count').textContent = String(blockedMods.length);

function normalized(entry) {
  return typeof entry === 'string' ? { name: entry } : entry;
}

function matches(entry, query) {
  return `${entry.name} ${entry.note || ''}`.toLocaleLowerCase('ru').includes(query);
}

function group(title, items, query) {
  const filtered = items.map(normalized).filter(entry => matches(entry, query));
  if (!filtered.length) return null;
  const section = document.createElement('section');
  section.className = 'mod-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const count = document.createElement('span');
  count.textContent = String(filtered.length).padStart(2, '0');
  heading.append(count);
  const list = document.createElement('ul');
  list.className = 'mod-list';
  for (const entry of filtered) {
    const row = document.createElement('li');
    const block = document.createElement('span');
    block.className = 'mod-bullet';
    block.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = entry.name;
    content.append(name);
    if (entry.note) {
      const note = document.createElement('small');
      note.textContent = entry.note;
      content.append(note);
    }
    row.append(block, content);
    list.append(row);
  }
  section.append(heading, list);
  return section;
}

function render() {
  const query = search.value.trim().toLocaleLowerCase('ru');
  const blocked = view === 'blocked';
  notice.textContent = blocked
    ? 'Запрещены перечисленные моды, чит-ресурспаки и их аналоги с теми же функциями.'
    : 'Допустимы косметические модификации и ресурспаки без сильного преимущества в игре. FreeCam в разрешённый список не входит.';
  notice.classList.toggle('blocked', blocked);
  results.classList.toggle('blocked', blocked);
  results.replaceChildren();
  const modGroup = group('Модификации', blocked ? blockedMods : allowedMods, query);
  const packGroup = group('Ресурспаки', blocked ? blockedPacks : allowedPacks, query);
  if (modGroup) results.append(modGroup);
  if (packGroup) results.append(packGroup);
  if (!results.children.length) {
    const empty = document.createElement('p');
    empty.className = 'mod-empty';
    empty.textContent = 'Совпадений нет. Если мод не указан, уточните его статус у модераторов Discord.';
    results.append(empty);
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    view = tab.dataset.view;
    for (const item of tabs) {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    }
    render();
  });
}

search.addEventListener('input', render);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) {
    event.preventDefault();
    search.focus();
  }
});
render();
