import { activeGame } from "../games";
import type { EffectContext } from "../games/types";
import type { GameCommand } from "./types";

/**
 * Sends action effects to the active game. Each game validates its own format:
 *  - Total War and Paradox games take command objects such as `{ op: "war", a, b }`
 *    (or their JSON text) from a fixed whitelist of ops;
 *  - CK3 takes effect script, like the original Voices of the Court.
 */
export class ActionEffectWriter {
  static writeEffect(command: GameCommand, context?: EffectContext): void {
    activeGame().runGameEffect(command, context);
  }
}
