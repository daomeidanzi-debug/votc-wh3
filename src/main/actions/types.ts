import { GameData } from "../gameData/GameData";
import { Character } from "../gameData/Character";
import type { Conversation } from "../conversation/Conversation";

export type ActionArgumentPrimitiveType = "number" | "string" | "enum" | "boolean";

// i18n support: string or object with language codes
export type I18nString = string | Record<string, string>;

export interface ActionArgumentBase {
  name: string;
  displayName?: string;
  description: I18nString;
  required?: boolean;
}

export interface NumberArgument extends ActionArgumentBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
}

export interface StringArgument extends ActionArgumentBase {
  type: "string";
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp | string;
}

export interface EnumArgument extends ActionArgumentBase {
  type: "enum";
  options: string[];
}

export interface BooleanArgument extends ActionArgumentBase {
  type: "boolean";
}

export type ActionArgumentDefinition =
  | NumberArgument
  | StringArgument
  | EnumArgument
  | BooleanArgument;

export type ActionArgumentValue = number | string | boolean | null;

export type ActionArgumentValues = Record<string, ActionArgumentValue>;

export type DynamicArgsFunction = (context: { gameData?: GameData; sourceCharacter: Character }) => ActionArgumentDefinition[];
export type DynamicDescriptionFunction = (context: { gameData?: GameData; sourceCharacter: Character }) => I18nString;

export interface ActionCheckContext {
  gameData: GameData;
  sourceCharacter: Character;
}

export interface ActionCheckResult {
  canExecute: boolean;
  validTargetCharacterIds?: number[];
  reason?: string;
}

/**
 * A game effect: a bridge command such as `{ op: "war", a: "<faction key>", b: "<faction key>" }`
 * (or its JSON text) for Total War and Paradox games, or effect script for CK3.
 */
export type GameCommand = Record<string, string | number | boolean | null | undefined> | string;

export interface ActionRunContext {
  gameData: GameData;
  sourceCharacter: Character;
  targetCharacter?: Character;
  runGameEffect: (effect: GameCommand) => void;
  args: ActionArgumentValues;
  conversation?: Conversation; // Optional conversation access for actions
  dryRun?: boolean; // True when action is being previewed, not executed
  lang?: string; // Language code for i18n (e.g., 'en', 'ru', 'fr')
}

export type ActionFeedbackSentiment = 'positive' | 'negative' | 'neutral';

export interface ActionFeedback {
  message: I18nString;
  sentiment?: ActionFeedbackSentiment;
}

export interface ActionDefinition {
  signature: string;
  title?: I18nString;
  description: I18nString | DynamicDescriptionFunction;
  args: ActionArgumentDefinition[] | DynamicArgsFunction;
  isDestructive?: boolean; // New field to mark destructive actions
  /** Total War: also offer this action when the NPC is a rank-and-file unit (default: no) */
  allowUnits?: boolean;
  /**
   * Games this action belongs to (ck3, wh3, tk, hoi4, vic3, eu5, stellaris). Omitted: every
   * game, so a custom action should name its game unless it only talks.
   */
  games?: string[];
  check: (context: ActionCheckContext) => Promise<ActionCheckResult> | ActionCheckResult;
  run: (context: ActionRunContext) => Promise<I18nString | ActionFeedback | void> | I18nString | ActionFeedback | void;
}

export interface ActionExecutionResult {
  actionId: string;
  success: boolean;
  feedback?: {
    message: string;
    sentiment: ActionFeedbackSentiment;
  };
  error?: string;
}

export interface ActionInvocation {
  actionId: string;
  targetCharacterId?: number | null;
  args: ActionArgumentValues;
}

export interface StructuredActionResponse {
  actions: ActionInvocation[];
}