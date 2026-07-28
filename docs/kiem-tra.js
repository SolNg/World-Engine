// kiem-tra.js — Bộ kiểm tra tổng hợp cho toàn bộ extension.
//
// Chạy: node docs/kiem-tra.js
//
// Bốn lớp, mỗi lớp bắt một loại lỗi khác nhau. Lý do dùng nhiều công cụ thay vì một:
// hai trình phân tích cú pháp độc lập thì lỗi của trình này bị trình kia bắt được,
// còn lỗi ngữ nghĩa (gõ nhầm tên hàm) thì cả hai đều mù nên cần lớp riêng.
//
//   1. node --check   — phân tích cú pháp bằng V8
//   2. acorn          — phân tích cú pháp bằng một trình độc lập, đối chứng với lớp 1
//   3. Định danh lạ   — quét tên biến/hàm được dùng nhưng không hề được khai báo ở đâu (bắt lỗi gõ nhầm)
//   4. Khế ước module — mỗi module có xuất đủ các hàm mà ENGINE_GROUPS trong world-engine.js đòi hỏi không
//   5. Kiểm thử       — chạy toàn bộ docs/*-test.js
//
// acorn được nạp từ npm global (npm root -g). Chưa có thì: npm install -g acorn

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
let problems = 0;

function fail(layer, message) {
  problems += 1;
  console.error(`  ✗ [${layer}] ${message}`);
}

function heading(text) {
  console.log('\n' + text);
}

// ========== Nạp acorn từ npm global ==========

// Dò theo các vị trí đã biết trước, chỉ gọi `npm root -g` khi hết cách — spawn npm vừa chậm
// vừa không chạy được ở mọi shell (npm.cmd không spawn trực tiếp được từ Git Bash trên Windows).
function loadAcorn() {
  const candidates = [
    'acorn',
    process.env.NODE_PATH && path.join(process.env.NODE_PATH, 'acorn'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'acorn'),
    path.join(path.dirname(process.execPath), 'node_modules', 'acorn'),
    '/usr/local/lib/node_modules/acorn',
    '/usr/lib/node_modules/acorn'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { /* thử vị trí kế tiếp */ }
  }

  try {
    const globalRoot = execFileSync('npm root -g', { encoding: 'utf8', shell: true }).trim();
    return require(path.join(globalRoot, 'acorn'));
  } catch (error) {
    return null;
  }
}

const acorn = loadAcorn();

// ========== Danh sách file ==========

const sourceFiles = fs.readdirSync(root)
  .filter(name => name.endsWith('.js'))
  .sort();

const testFiles = fs.readdirSync(__dirname)
  .filter(name => name.endsWith('-test.js'))
  .sort();

// ========== Lớp 1: node --check ==========

heading('1. node --check');
for (const file of sourceFiles) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    fail('node', `${file}: ${String(error.stderr || error.message).split('\n').slice(0, 3).join(' ')}`);
  }
}
console.log(`   đã kiểm tra ${sourceFiles.length} file`);

// ========== Lớp 2: acorn ==========

const trees = new Map();

heading('2. acorn');
if (!acorn) {
  fail('acorn', 'không nạp được acorn — chạy: npm install -g acorn');
} else {
  for (const file of sourceFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    try {
      trees.set(file, acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true }));
    } catch (error) {
      fail('acorn', `${file}:${error.loc?.line}:${error.loc?.column} ${error.message}`);
    }
  }
  console.log(`   đã phân tích ${trees.size}/${sourceFiles.length} file`);
}

// ========== Lớp 3: định danh lạ ==========
// Quét tên được ĐỌC nhưng không hề được khai báo ở bất kỳ đâu trong cùng file, cũng không
// nằm trong danh sách global đã biết. Cố ý bỏ qua phạm vi (scope) — một tên khai trong hàm này
// được tính là đã khai cho cả file. Cách này báo thiếu chứ gần như không báo nhầm, đúng thứ cần
// cho một bộ quét lỗi gõ nhầm: báo nhầm nhiều thì không ai thèm chạy nữa.

const BUILTIN_GLOBALS = new Set([
  'globalThis', 'undefined', 'NaN', 'Infinity', 'arguments', 'this',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Function',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl',
  'ArrayBuffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'eval',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape',
  'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'localStorage', 'sessionStorage', 'indexedDB', 'crypto', 'performance',
  'fetch', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
  'XMLHttpRequest', 'WebSocket', 'EventSource', 'FormData', 'URL', 'URLSearchParams',
  'Blob', 'File', 'FileReader', 'TextEncoder', 'TextDecoder', 'btoa', 'atob',
  'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'DOMParser', 'XPathResult',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver',
  'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
  'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'structuredClone',
  'Image', 'Audio', 'CanvasRenderingContext2D', 'getSelection',
  // Môi trường SillyTavern và thư viện đi kèm
  'SillyTavern', 'jQuery', '$', 'toastr', 'moment', 'DOMPurify', 'Handlebars',
  // Môi trường Node (các script kiểm thử)
  'require', 'module', 'exports', 'process', '__dirname', '__filename', 'global', 'Buffer'
]);

// Các module của chính dự án đều tự khai bằng `window.TÊN = ...`, nên gom hết lại làm global hợp lệ.
const projectGlobals = new Set();
for (const [, tree] of trees) {
  walk(tree, node => {
    if (node.type !== 'AssignmentExpression') return;
    const target = node.left;
    if (target?.type === 'MemberExpression' && !target.computed &&
        target.object?.type === 'Identifier' && target.object.name === 'window' &&
        target.property?.type === 'Identifier') {
      projectGlobals.add(target.property.name);
    }
  });
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  if (typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    walk(node[key], visit, node);
  }
}

// Thu tên từ một mẫu khai báo (hỗ trợ phá vỡ cấu trúc: {a, b: c}, [x, ...rest], mặc định)
function collectPattern(pattern, into) {
  if (!pattern || typeof pattern !== 'object') return;
  switch (pattern.type) {
    case 'Identifier': into.add(pattern.name); break;
    case 'ObjectPattern': pattern.properties.forEach(prop =>
      collectPattern(prop.type === 'RestElement' ? prop.argument : prop.value, into)); break;
    case 'ArrayPattern': pattern.elements.forEach(element => collectPattern(element, into)); break;
    case 'AssignmentPattern': collectPattern(pattern.left, into); break;
    case 'RestElement': collectPattern(pattern.argument, into); break;
    default: break;
  }
}

// Định danh này có phải là một lần ĐỌC biến không? (bỏ qua khoá thuộc tính, tên thuộc tính, nhãn)
function isVariableRead(node, parent) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return false;
  if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return false;
  if (parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) return false;
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return false;
  return true;
}

heading('3. định danh lạ');
if (trees.size) {
  for (const [file, tree] of trees) {
    const declared = new Set();
    const used = new Map();

    walk(tree, (node, parent) => {
      switch (node.type) {
        case 'VariableDeclarator': collectPattern(node.id, declared); break;
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          if (node.id) declared.add(node.id.name);
          node.params.forEach(param => collectPattern(param, declared));
          break;
        case 'ClassDeclaration':
        case 'ClassExpression':
          if (node.id) declared.add(node.id.name);
          break;
        case 'CatchClause': collectPattern(node.param, declared); break;
        case 'Identifier':
          if (isVariableRead(node, parent) && !used.has(node.name)) {
            used.set(node.name, node.loc?.start?.line);
          }
          break;
        default: break;
      }
    });

    for (const [name, line] of used) {
      if (declared.has(name) || BUILTIN_GLOBALS.has(name) || projectGlobals.has(name)) continue;
      fail('định danh', `${file}:${line} — "${name}" được dùng nhưng không khai báo ở đâu cả`);
    }
  }
  console.log(`   ${projectGlobals.size} global của dự án được ghi nhận là hợp lệ`);
} else {
  console.log('   bỏ qua (acorn không chạy được)');
}

// ========== Lớp 4: khế ước module ==========
// ENGINE_GROUPS trong world-engine.js khai mỗi module phải xuất những hàm nào. Nạp từng module
// trong sandbox rồi đối chiếu. Đây là lớp bắt được lỗi tích hợp: đổi tên hàm ở một file mà quên
// sửa nơi khai khế ước, hoặc gỡ một engine mà quên gỡ khai báo của nó.

heading('4. khế ước module');
const engineTree = trees.get('world-engine.js');
if (!engineTree) {
  console.log('   bỏ qua (không phân tích được world-engine.js)');
} else {
  const contracts = new Map();      // tên global -> [hàm bắt buộc]
  const moduleFiles = new Set();

  walk(engineTree, node => {
    if (node.type !== 'Property' || node.computed) return;
    const name = node.key.name || node.key.value;

    if (name === 'contracts' && node.value.type === 'ObjectExpression') {
      for (const entry of node.value.properties) {
        const globalName = entry.key.name || entry.key.value;
        if (entry.value.type !== 'ArrayExpression') continue;
        contracts.set(globalName, entry.value.elements.map(element => element.value));
      }
    }
    if (name === 'modules' && node.value.type === 'ArrayExpression') {
      for (const element of node.value.elements) {
        if (typeof element.value === 'string') moduleFiles.add(element.value);
      }
    }
  });

  // Sandbox tối thiểu: đủ để các IIFE cấp module chạy xong phần gán window.*, không chạm DOM thật.
  const storage = new Map();
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }), addEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, RegExp, Promise,
    SillyTavern: { getContext: () => ({ chat: [], eventSource: { on() {} }, event_types: {} }) },
    WORLD_ENGINE_STORE: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  const loadable = [...moduleFiles].filter(file => fs.existsSync(path.join(root, file)));

  for (const file of loadable) {
    try {
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    } catch (error) {
      fail('khế ước', `${file} ném lỗi khi nạp: ${error.message}`);
    }
  }

  for (const [globalName, required] of contracts) {
    const target = sandbox[globalName];
    if (!target) {
      fail('khế ước', `window.${globalName} không tồn tại sau khi nạp (khế ước đòi: ${required.join(', ')})`);
      continue;
    }
    for (const fn of required) {
      if (typeof target[fn] !== 'function') {
        fail('khế ước', `window.${globalName}.${fn}() thiếu hoặc không phải hàm`);
      }
    }
  }

  const missingFiles = [...moduleFiles].filter(file => !fs.existsSync(path.join(root, file)));
  for (const file of missingFiles) {
    fail('khế ước', `${file} được khai trong ENGINE_GROUPS nhưng không tồn tại`);
  }

  console.log(`   ${contracts.size} khế ước, ${loadable.length} module nạp được`);
}

// ========== Lớp 5: kiểm thử ==========

heading('5. kiểm thử');
for (const file of testFiles) {
  try {
    const output = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8', stdio: 'pipe' });
    console.log('   ✓ ' + output.trim().split('\n').pop());
  } catch (error) {
    fail('kiểm thử', `${file}\n${String(error.stdout || '') + String(error.stderr || '')}`);
  }
}

// ========== Kết luận ==========

console.log('');
if (problems > 0) {
  console.error(`KIỂM TRA THẤT BẠI — ${problems} vấn đề`);
  process.exit(1);
}
console.log('Tất cả kiểm tra đều đạt.');
