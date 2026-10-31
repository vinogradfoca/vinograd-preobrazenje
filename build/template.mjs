// Mali šablonski mehanizam, bez vanjskih biblioteka.
//
//   {{a.b}}                 vrijednost, HTML-escaped
//   {{{a.b}}}               vrijednost bez escapinga (samo za HTML koji pravi build)
//   {{#if a}}…{{else}}…{{/if}}
//   {{#unless a}}…{{/unless}}
//   {{#each lista}}…{{/each}}   unutra: this, @index, @first, @last i polja stavke
//   {{> ime}}               parcijalni šablon iz templates/partials/ime.html
//
// Nepoznata promjenljiva u ispisu ({{x}}) je greška, da se tipfeleri ne bi
// tiho pretvorili u prazan tekst. U {{#if}} nepoznato znači "netačno".

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

const TOKEN = /\{\{\{\s*([\w.@]+)\s*\}\}\}|\{\{\s*(#if|#unless|#each|\/if|\/unless|\/each|else|>)\s*([\w.@-]*)\s*\}\}|\{\{\s*([\w.@]+)\s*\}\}/g;

function parse(src, name) {
  const root = { type: "root", children: [] };
  const stack = [root];
  let last = 0;
  let m;
  const top = () => stack[stack.length - 1];
  const line = (i) => src.slice(0, i).split("\n").length;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    if (m.index > last) top().children.push({ type: "text", value: src.slice(last, m.index) });
    last = TOKEN.lastIndex;
    const where = `${name}:${line(m.index)}`;
    if (m[1]) { top().children.push({ type: "raw", path: m[1], where }); continue; }
    if (m[4]) { top().children.push({ type: "var", path: m[4], where }); continue; }
    const tag = m[2], arg = m[3];
    if (tag === "#if" || tag === "#unless" || tag === "#each") {
      if (!arg) throw new Error(`Šablon ${where}: ${tag} bez argumenta`);
      const node = { type: tag.slice(1), path: arg, children: [], where };
      top().children.push(node);
      stack.push(node);
    } else if (tag === "else") {
      const n = top();
      if (n.type !== "if" && n.type !== "unless") throw new Error(`Šablon ${where}: {{else}} van {{#if}}`);
      if (n.main) throw new Error(`Šablon ${where}: dva {{else}} u istom bloku`);
      n.main = n.children;
      n.children = [];
    } else if (tag === ">") {
      top().children.push({ type: "partial", name: arg, where });
    } else {
      const want = tag.slice(1);
      const n = stack.pop();
      if (!n || n.type !== want) throw new Error(`Šablon ${where}: {{${tag}}} ne zatvara otvoreni blok`);
    }
  }
  if (last < src.length) top().children.push({ type: "text", value: src.slice(last) });
  if (stack.length !== 1) throw new Error(`Šablon ${name}: blok {{#${top().type}}} (${top().where}) nije zatvoren`);
  return root;
}

function lookup(scopes, path) {
  if (path === "this") return { found: true, value: scopes[scopes.length - 1].data };
  const parts = path.split(".");
  if (parts[0] === "this") parts.shift();
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    let base;
    if (parts[0].startsWith("@")) {
      if (!s.meta || !(parts[0] in s.meta)) continue;
      base = s.meta[parts[0]];
    } else {
      if (s.data == null || typeof s.data !== "object" || !(parts[0] in s.data)) continue;
      base = s.data[parts[0]];
    }
    let v = base;
    for (const p of parts.slice(1)) {
      if (v == null || typeof v !== "object" || !(p in v)) return { found: false };
      v = v[p];
    }
    return { found: true, value: v };
  }
  return { found: false };
}

const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

export function createEngine(loadTemplate) {
  const cache = new Map();
  const get = (name) => {
    if (!cache.has(name)) cache.set(name, parse(loadTemplate(name), name));
    return cache.get(name);
  };

  function run(nodes, scopes) {
    let out = "";
    for (const n of nodes) {
      switch (n.type) {
        case "text": out += n.value; break;
        case "var":
        case "raw": {
          const r = lookup(scopes, n.path);
          if (!r.found || r.value === undefined) throw new Error(`Šablon ${n.where}: nepoznata vrijednost "${n.path}"`);
          const v = r.value == null ? "" : r.value;
          out += n.type === "var" ? escapeHtml(v) : String(v);
          break;
        }
        case "if":
        case "unless": {
          const r = lookup(scopes, n.path);
          let ok = r.found && truthy(r.value);
          if (n.type === "unless") ok = !ok;
          const main = n.main || n.children;
          const alt = n.main ? n.children : null;
          if (ok) out += run(main, scopes);
          else if (alt) out += run(alt, scopes);
          break;
        }
        case "each": {
          const r = lookup(scopes, n.path);
          if (!r.found || !Array.isArray(r.value)) throw new Error(`Šablon ${n.where}: "${n.path}" nije lista`);
          const len = r.value.length;
          r.value.forEach((item, i) => {
            out += run(n.children, [...scopes, { data: item, meta: { "@index": i, "@number": i + 1, "@first": i === 0, "@last": i === len - 1 } }]);
          });
          break;
        }
        case "partial":
          out += run(get("partials/" + n.name + ".html").children, scopes);
          break;
      }
    }
    return out;
  }

  return {
    render(name, data) {
      return run(get(name).children, [{ data }]);
    },
  };
}
