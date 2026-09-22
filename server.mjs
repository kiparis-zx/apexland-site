import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

const port = Number(process.env.PORT || 3000);
const publicUrl = new URL(process.env.PUBLIC_URL || `http://localhost:${port}`);
const frontendUrl = new URL(process.env.FRONTEND_URL || publicUrl.origin);
const redirectUri = new URL('/auth/callback', publicUrl).toString();
const clientId = process.env.TWITCH_CLIENT_ID?.trim();
const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
const authConfigured = Boolean(clientId && clientSecret);
const demoAllowed = !authConfigured && process.env.NODE_ENV !== 'production';
const secureCookie = publicUrl.protocol === 'https:';
const publicDir = resolve(root, 'public');
const dataFile = resolve(root, process.env.DATA_FILE || 'data/applications.json');
const sessions = new Map();
const adminSessions = new Map();
const failedAdminLogins = new Map();
const adminUsername = `admin_${randomBytes(4).toString('hex')}`;
const adminPassword = randomBytes(24).toString('base64url');
const applications = new Map();
let writeQueue = Promise.resolve();

try {
  const stored = JSON.parse(await readFile(dataFile, 'utf8'));
  for (const application of stored) {
    if (application?.twitchId) applications.set(application.twitchId, application);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function securityHeaders(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (request.headers.origin === frontendUrl.origin && frontendUrl.origin !== publicUrl.origin) {
    response.setHeader('Access-Control-Allow-Origin', frontendUrl.origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https://static-cdn.jtvnw.net",
    "media-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '));
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function redirect(response, location, extraHeaders = {}) {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...extraHeaders });
  response.end();
}

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(part => part.length === 2));
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}`;
}

function adminCookie(value, maxAge) {
  return `admin_sid=${value}; Path=/api/admin; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secureCookie ? '; Secure' : ''}`;
}

function equals(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sessionFor(request) {
  const sid = cookies(request).sid;
  const session = sid && sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...session };
}

function adminSessionFor(request) {
  const sid = cookies(request).admin_sid;
  const session = sid && adminSessions.get(sid);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    adminSessions.delete(sid);
    return null;
  }
  return { sid, ...session };
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  return !origin || origin === publicUrl.origin || origin === frontendUrl.origin;
}

function frontendLocation(path) {
  return new URL(path, frontendUrl).toString();
}

async function validateTwitch(session) {
  if (session.demo || Date.now() - session.validatedAt < 60 * 60 * 1000) return true;
  const response = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${session.token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return false;
  const token = await response.json();
  if (token.client_id !== clientId || token.user_id !== session.user.id) return false;
  sessions.get(session.sid).validatedAt = Date.now();
  return true;
}

async function authenticatedSession(request) {
  const session = sessionFor(request);
  if (!session) return null;
  try {
    if (await validateTwitch(session)) return session;
  } catch (error) {
    console.error('Twitch validation failed:', error);
    // Keep the session, but do not trust it until Twitch can be reached again.
    throw error;
  }
  sessions.delete(session.sid);
  return null;
}

function checkCsrf(request, session) {
  return sameOrigin(request) && equals(request.headers['x-csrf-token'], session.csrfToken);
}

function adminLoginAllowed(request) {
  const ip = request.socket.remoteAddress || 'unknown';
  const attempt = failedAdminLogins.get(ip);
  if (!attempt || attempt.resetAt < Date.now()) return true;
  return attempt.count < 5;
}

function recordFailedAdminLogin(request) {
  const ip = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = failedAdminLogins.get(ip);
  if (!attempt || attempt.resetAt < now) failedAdminLogins.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  else attempt.count += 1;
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateApplication(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Некорректные данные формы.' };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const minecraft = typeof body.minecraft === 'string' ? body.minecraft.trim() : '';
  const license = body.license;
  if (name.length < 2 || name.length > 40) return { error: 'Укажите имя от 2 до 40 символов.' };
  if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraft)) {
    return { error: 'Ник Minecraft: 3–16 латинских букв, цифр или _.' };
  }
  if (license !== 'yes' && license !== 'no') return { error: 'Укажите, есть ли у вас лицензия.' };
  if (body.fairPlay !== true) return { error: 'Подтвердите согласие с правилом честной игры.' };
  return { name, minecraft, license };
}

function persistApplications() {
  const snapshot = JSON.stringify([...applications.values()], null, 2) + '\n';
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(dataFile), { recursive: true });
    const temporary = `${dataFile}.${process.pid}.tmp`;
    await writeFile(temporary, snapshot, { mode: 0o600 });
    await rename(temporary, dataFile);
  });
  return writeQueue;
}

async function handleAuthStart(response) {
  if (!authConfigured) {
    redirect(response, frontendLocation('/?auth=not-configured'));
    return;
  }
  const state = randomBytes(24).toString('hex');
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', '');
  url.searchParams.set('state', state);
  redirect(response, url.toString(), { 'Set-Cookie': cookie('oauth_state', state, 600) });
}

async function handleAuthCallback(request, response, url) {
  const stateCookie = cookies(request).oauth_state;
  const clearState = cookie('oauth_state', '', 0);
  if (url.searchParams.get('error')) {
    redirect(response, frontendLocation('/?auth=cancelled'), { 'Set-Cookie': clearState });
    return;
  }
  if (!authConfigured || !equals(url.searchParams.get('state'), stateCookie) || !url.searchParams.get('code')) {
    redirect(response, frontendLocation('/?auth=invalid-state'), { 'Set-Cookie': clearState });
    return;
  }
  try {
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: url.searchParams.get('code'),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!tokenResponse.ok) throw new Error(`Token exchange returned ${tokenResponse.status}`);
    const token = await tokenResponse.json();
    const validationResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token.access_token}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!validationResponse.ok) throw new Error('Token validation failed');
    const validation = await validationResponse.json();
    if (validation.client_id !== clientId || !validation.user_id) throw new Error('Unexpected Twitch token');
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Client-Id': clientId
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!userResponse.ok) throw new Error('Twitch user lookup failed');
    const twitchUser = (await userResponse.json()).data?.[0];
    if (!twitchUser || twitchUser.id !== validation.user_id) throw new Error('Unexpected Twitch user');

    const sid = randomBytes(32).toString('hex');
    sessions.set(sid, {
      user: {
        id: twitchUser.id,
        login: twitchUser.login,
        displayName: twitchUser.display_name,
        avatar: twitchUser.profile_image_url
      },
      token: token.access_token,
      validatedAt: Date.now(),
      expiresAt: Date.now() + Math.min(Number(token.expires_in || 43200) * 1000, 43200_000),
      csrfToken: randomBytes(24).toString('hex'),
      demo: false
    });
    redirect(response, frontendLocation('/'), { 'Set-Cookie': [clearState, cookie('sid', sid, 43200)] });
  } catch (error) {
    console.error('Twitch sign-in failed:', error);
    redirect(response, frontendLocation('/?auth=failed'), { 'Set-Cookie': clearState });
  }
}

async function serveStatic(response, pathname) {
  const path = pathname === '/' ? '/index.html' : pathname === '/mods' ? '/mods.html' : pathname === '/rules' ? '/rules.html' : pathname === '/admin' ? '/admin.html' : pathname;
  let filePath;
  try {
    filePath = resolve(publicDir, '.' + decodeURIComponent(path));
  } catch {
    sendJson(response, 400, { error: 'Некорректный путь.' });
    return;
  }
  if (!filePath.startsWith(publicDir + sep)) {
    sendJson(response, 403, { error: 'Доступ запрещён.' });
    return;
  }
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.mp4': 'video/mp4',
    '.svg': 'image/svg+xml'
  }[extname(filePath)];
  if (!mime) {
    sendJson(response, 404, { error: 'Не найдено.' });
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache'
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') sendJson(response, 404, { error: 'Не найдено.' });
    else throw error;
  }
}

const server = createServer(async (request, response) => {
  securityHeaders(request, response);
  const url = new URL(request.url, publicUrl);
  try {
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      if (request.headers.origin !== frontendUrl.origin) return sendJson(response, 403, { error: 'Недопустимый запрос.' });
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
        'Access-Control-Max-Age': '600'
      });
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/auth/twitch') return await handleAuthStart(response);
    if (request.method === 'GET' && url.pathname === '/auth/callback') return await handleAuthCallback(request, response, url);

    if (request.method === 'GET' && url.pathname === '/api/admin/session') {
      const session = adminSessionFor(request);
      return sendJson(response, 200, session
        ? { authenticated: true, csrfToken: session.csrfToken }
        : { authenticated: false });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/login') {
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'Недопустимый запрос.' });
      if (!adminLoginAllowed(request)) return sendJson(response, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
      let body;
      try {
        body = await readJson(request);
      } catch {
        return sendJson(response, 400, { error: 'Некорректные данные.' });
      }
      const username = typeof body?.username === 'string' ? body.username : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      const validUsername = equals(username, adminUsername);
      const validPassword = equals(password, adminPassword);
      if (!validUsername || !validPassword) {
        recordFailedAdminLogin(request);
        return sendJson(response, 401, { error: 'Неверный логин или пароль.' });
      }
      failedAdminLogins.delete(request.socket.remoteAddress || 'unknown');
      const sid = randomBytes(32).toString('hex');
      adminSessions.set(sid, {
        csrfToken: randomBytes(24).toString('hex'),
        expiresAt: Date.now() + 8 * 60 * 60_000
      });
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': adminCookie(sid, 8 * 60 * 60) });
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/applications') {
      const session = adminSessionFor(request);
      if (!session) return sendJson(response, 401, { error: 'Войдите в панель администратора.' });
      const items = [...applications.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return sendJson(response, 200, { applications: items });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
      const session = adminSessionFor(request);
      if (!session || !checkCsrf(request, session)) return sendJson(response, 403, { error: 'Сессия истекла.' });
      adminSessions.delete(session.sid);
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': adminCookie('', 0) });
    }

    if (request.method === 'GET' && url.pathname === '/api/me') {
      const session = await authenticatedSession(request);
      return sendJson(response, 200, session ? {
        authenticated: true,
        user: session.user,
        csrfToken: session.csrfToken,
        demo: session.demo,
        application: session.demo ? session.application || null : applications.get(session.user.id) || null
      } : { authenticated: false, authConfigured, demoAllowed });
    }

    if (request.method === 'POST' && url.pathname === '/api/demo-login') {
      if (!demoAllowed) return sendJson(response, 404, { error: 'Демо недоступно.' });
      const sid = randomBytes(32).toString('hex');
      sessions.set(sid, {
        user: { id: 'demo', login: 'demo_player', displayName: 'DemoPlayer', avatar: '' },
        token: null,
        validatedAt: Date.now(),
        expiresAt: Date.now() + 43200_000,
        csrfToken: randomBytes(24).toString('hex'),
        demo: true
      });
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': cookie('sid', sid, 43200) });
    }

    if (request.method === 'POST' && url.pathname === '/api/logout') {
      const session = sessionFor(request);
      if (!session || !checkCsrf(request, session)) return sendJson(response, 403, { error: 'Сессия истекла.' });
      sessions.delete(session.sid);
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': cookie('sid', '', 0) });
    }

    if (request.method === 'POST' && url.pathname === '/api/applications') {
      const session = await authenticatedSession(request);
      if (!session) return sendJson(response, 401, { error: 'Войдите через Twitch.' });
      if (!checkCsrf(request, session)) return sendJson(response, 403, { error: 'Обновите страницу и попробуйте снова.' });
      if (session.demo ? session.application : applications.has(session.user.id)) {
        return sendJson(response, 409, { error: 'Заявка уже отправлена.' });
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        return sendJson(response, 400, { error: 'Некорректные данные формы.' });
      }
      const data = validateApplication(body);
      if (data.error) return sendJson(response, 400, data);
      if (session.demo ? session.application : applications.has(session.user.id)) {
        return sendJson(response, 409, { error: 'Заявка уже отправлена.' });
      }
      const application = {
        twitchId: session.user.id,
        twitchLogin: session.user.login,
        twitchDisplayName: session.user.displayName,
        name: data.name,
        minecraft: data.minecraft,
        license: data.license,
        fairPlayAccepted: true,
        submittedAt: new Date().toISOString()
      };
      if (session.demo) {
        sessions.get(session.sid).application = application;
        return sendJson(response, 201, { ok: true, application });
      }
      applications.set(session.user.id, application);
      try {
        await persistApplications();
      } catch (error) {
        applications.delete(session.user.id);
        throw error;
      }
      return sendJson(response, 201, { ok: true, application });
    }

    if (request.method === 'GET') return await serveStatic(response, url.pathname);
    sendJson(response, 405, { error: 'Метод не поддерживается.' });
  } catch (error) {
    console.error('Request failed:', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Ошибка сервера. Попробуйте позже.' });
    else response.end();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) if (session.expiresAt < now) sessions.delete(sid);
  for (const [sid, session] of adminSessions) if (session.expiresAt < now) adminSessions.delete(sid);
  for (const [ip, attempt] of failedAdminLogins) if (attempt.resetAt < now) failedAdminLogins.delete(ip);
}, 60 * 60 * 1000).unref();

server.listen(port, () => {
  console.log(`ApexLand is running at ${publicUrl.origin}`);
  console.log(authConfigured ? `Twitch callback: ${redirectUri}` : 'Twitch is not configured; local demo is available.');
  console.log(`Admin panel: ${new URL('/admin', publicUrl)}`);
  console.log(`Admin login: ${adminUsername}`);
  console.log(`Admin password: ${adminPassword}`);
});
