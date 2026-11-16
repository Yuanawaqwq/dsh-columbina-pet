// 动态检查：lib/client.js 的启动守卫在「排队阶段」与「live 阶段」下的行为。
// 背景：2026-11-16 用户切网页端后桌宠与设置项整块消失——原因是启动守卫只认页面生命周期内的
// 「第一次执行」，插件被禁用再启用时 DSH 会以 live 模式重新执行同一份 bundle，守卫直接 return，
// 于是 window.__ModuleLoader__.load() 再没被调用，插槽永远不会重新上架。
// 这里用 vm + 假 DOM 把 bundle 真跑一遍，验证：排队阶段去重、live 阶段必须真的注册、重复注册不炸页面。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');

const results = [];
function check(name, ok) {
	results.push({ name, ok: !!ok });
	if (!ok) console.log('  FAIL ' + name);
}

/** 造一个够 bundle 启动用的假页面；loader 是可控的假 __ModuleLoader__。 */
function makePage(mode, loadImpl) {
	const node = () => ({
		tagName: 'div', dataset: {}, style: {}, children: [], childNodes: [], innerHTML: '', textContent: '',
		classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
		appendChild(c) { return c; }, removeChild() {}, remove() {}, insertBefore(c) { return c; },
		setAttribute() {}, getAttribute: () => null, removeAttribute() {},
		addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
		querySelector: () => null, querySelectorAll: () => [],
		getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
		hasAttribute: () => false, focus() {}, blur() {}, contains: () => false
	});
	const document = {
		createElement: node, createElementNS: node, createTextNode: (t) => ({ nodeType: 3, textContent: t }),
		head: node(), body: node(), documentElement: node(), styleSheets: [], style: {},
		querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
		addEventListener() {}, removeEventListener() {}, hasFocus: () => true,
		visibilityState: 'visible', hidden: false, readyState: 'complete',
		fonts: { ready: Promise.resolve(), add() {} }, activeElement: null
	};
	const store = new Map();
	const sandbox = {
		document,
		localStorage: {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => store.set(k, String(v)),
			removeItem: (k) => store.delete(k), clear: () => store.clear()
		},
		MutationObserver: class { observe() {} disconnect() {} },
		ResizeObserver: class { observe() {} disconnect() {} },
		requestAnimationFrame: () => 0, cancelAnimationFrame() {},
		setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
		fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
		location: { href: 'http://127.0.0.1:60087/', origin: 'http://127.0.0.1:60087', search: '', hash: '' },
		navigator: { userAgent: 'node-test', language: 'zh-CN' },
		getComputedStyle: () => ({ getPropertyValue: () => '' }),
		URL, URLSearchParams, TextEncoder, TextDecoder, queueMicrotask,
		addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
		innerWidth: 1600, innerHeight: 1000, devicePixelRatio: 1.5,
		console: { log() {}, info() {}, warn(...a) { warnings.push(a.join(' ')); }, error(...a) { warnings.push(a.join(' ')); } },
		warnings: undefined
	};
	const warnings = [];
	sandbox.warnings = warnings;
	sandbox.window = sandbox;
	sandbox.globalThis = sandbox;
	sandbox.self = sandbox;
	sandbox.window.__ModuleLoader__ = {
		mode,
		pendingQueue: [],
		load(registration) {
			loadCalls.push(registration);
			if (loadImpl) return loadImpl(registration, loadCalls);
		}
	};
	const loadCalls = [];
	sandbox.loadCalls = loadCalls;
	vm.createContext(sandbox);
	return { sandbox, loadCalls, warnings };
}

function run(sandbox) {
	vm.runInContext(src, sandbox, { filename: 'lib/client.js' });
}

// ---- 1. 排队阶段执行两次：只注册一次（启动期预载 + 正式加载，重复排队会 duplicate id）----
{
	const page = makePage('queue');
	run(page.sandbox);
	run(page.sandbox);
	check('排队阶段执行两次只注册一次', page.loadCalls.length === 1);
	check('排队阶段注册的 id 正确', page.loadCalls[0] && page.loadCalls[0].id === 'dsh-columbina-pet');
	check('排队阶段注册带 factory', page.loadCalls[0] && typeof page.loadCalls[0].factory === 'function');
}

// ---- 2. live 阶段第一次执行（正常启动、模块系统已建好）：必须注册 ----
{
	const page = makePage('live');
	run(page.sandbox);
	check('live 阶段第一次执行就注册', page.loadCalls.length === 1);
}

// ---- 3. 回归点：排队阶段装过一次，之后插件被禁用再启用，DSH 以 live 模式重新执行同一份 bundle ----
// 这一条以前会直接 return，导致宠物和设置项再也不回来。
{
	const page = makePage('queue');
	run(page.sandbox);
	page.sandbox.window.__ModuleLoader__.mode = 'live';
	run(page.sandbox);
	check('排队 → live 重新执行后再次注册（禁用再启用能恢复）', page.loadCalls.length === 2);
	check('两次注册的 id 都是 dsh-columbina-pet', page.loadCalls.every((c) => c.id === 'dsh-columbina-pet'));
}

// ---- 4. live 阶段重复注册撞 duplicate id：吞掉、只告警，不让整页崩掉 ----
{
	const page = makePage('live', () => {
		throw new Error('client-modules: duplicate module id "dsh-columbina-pet"');
	});
	let threw = false;
	try { run(page.sandbox); } catch (error) { threw = true; }
	check('duplicate id 不向外抛', threw === false);
	check('duplicate id 留一条告警', page.warnings.some((w) => w.includes('重复注册')));
}

// ---- 5. 其它注册错误不能吞：真坏了要能看见 ----
{
	const page = makePage('live', () => {
		throw new Error('boom: something else');
	});
	let threw = false;
	try { run(page.sandbox); } catch (error) { threw = true; }
	check('非 duplicate 的错误照旧抛出', threw === true);
}

const failed = results.filter((r) => !r.ok).length;
console.log('[client-boot] ' + (results.length - failed) + '/' + results.length + ' 通过');
process.exit(failed === 0 ? 0 : 1);
