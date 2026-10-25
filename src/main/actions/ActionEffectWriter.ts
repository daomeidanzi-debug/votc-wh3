import { wh3Bridge } from "../wh3/Wh3Bridge";
import type { Wh3Command } from "../wh3/types";
import type { GameCommand } from "./types";

const KNOWN_OPS = new Set<Wh3Command['op']>([
  'transfer_gold', 'attitude', 'war', 'peace', 'alliance', 'trade', 'vassal', 'confederate',
  'transfer_region', 'add_trait', 'add_xp', 'wound', 'kill', 'replenish_ap', 'give_unit',
]);

/**
 * Sends action effects to Warhammer III through the votc_wh3 bridge.
 * Actions pass a command object such as `{ op: "transfer_gold", from, to, amount }`
 * (or its JSON string); the Lua side validates it again before executing.
 */
export class ActionEffectWriter {
  static parseCommand(command: GameCommand): Wh3Command {
    let cmd: unknown = command;
    if (typeof command === 'string') {
      try {
        cmd = JSON.parse(command);
      } catch {
        throw new Error(`Game effect must be a command object, got text: ${command.slice(0, 80)}`);
      }
    }
    if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) {
      throw new Error('Game effect must be a command object');
    }
    const op = (cmd as { op?: unknown }).op;
    if (typeof op !== 'string' || !KNOWN_OPS.has(op as Wh3Command['op'])) {
      throw new Error(`Unknown game command op: ${String(op)}`);
    }
    for (const [key, value] of Object.entries(cmd as Record<string, unknown>)) {
      const t = typeof value;
      if (value !== null && value !== undefined && t !== 'string' && t !== 'number' && t !== 'boolean') {
        throw new Error(`Game command field "${key}" must be a string, number or boolean`);
      }
      if (t === 'number' && !Number.isFinite(value as number)) {
        throw new Error(`Game command field "${key}" is not a finite number`);
      }
    }
    return cmd as Wh3Command;
  }

  static writeEffect(command: GameCommand): void {
    const cmd = this.parseCommand(command);
    wh3Bridge.queueCommand(cmd);
  }
}
