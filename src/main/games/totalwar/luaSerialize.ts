/**
 * Serializes plain data into a Lua 5.1 table literal for the Warhammer III bridge.
 * The game loads the result with loadstring + an empty environment, so only
 * literals (strings, numbers, booleans, tables) are ever emitted.
 *
 * Kept free of imports so it can be exercised directly with `node`.
 */

export type LuaValue = string | number | boolean | null | undefined | LuaValue[] | { [key: string]: LuaValue };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

export function luaString(value: string): string {
  // Escape every byte that could end the literal or confuse the lexer; UTF-8 passes through.
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 32 || code === 127) out += '\\' + code.toString().padStart(3, '0');
    else out += ch;
  }
  return out + '"';
}

export function luaNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot serialize non-finite number ${value} to Lua`);
  }
  if (Number.isInteger(value)) {
    // toString switches to exponent notation only at 1e21, far above our ids
    return value.toString();
  }
  return value.toPrecision(15);
}

export function toLua(value: LuaValue): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return luaString(value);
  if (typeof value === 'number') return luaNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return '{ ' + value.map((v) => toLua(v)).join(', ') + ' }';
  }
  if (typeof value === 'object') {
    const parts: string[] = [];
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;
      const k = IDENTIFIER.test(key) && !LUA_KEYWORDS.has(key) ? key : `[${luaString(key)}]`;
      parts.push(`${k} = ${toLua(v)}`);
    }
    return '{ ' + parts.join(', ') + ' }';
  }
  throw new Error(`Cannot serialize ${typeof value} to Lua`);
}

/** The full command file the bridge polls: `return { cmds = { ... } }`. */
export function buildCommandFile(commands: Array<Record<string, LuaValue>>): string {
  return `return ${toLua({ cmds: commands })}\n`;
}
