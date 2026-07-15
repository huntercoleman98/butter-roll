declare module "@3d-dice/dice-box" {
  interface DiceBoxOptions {
    assetPath?: string;
    theme?: string;
    gravity?: number;
    mass?: number;
    friction?: number;
    restitution?: number;
    angularDamping?: number;
    linearDamping?: number;
    spinForce?: number;
    throwForce?: number;
    startingHeight?: number;
    settleTimeout?: number;
    offscreen?: boolean;
    delay?: number;
    lightIntensity?: number;
    enableShadows?: boolean;
    shadowTransparency?: number;
    themeColor?: string;
    scale?: number;
  }

  interface DiceBoxRollOptions {
    theme?: string;
    themeColor?: string;
    newStartPoint?: boolean;
  }

  export default class DiceBox {
    constructor(selector: string, options?: DiceBoxOptions);
    init(): Promise<void>;
    roll(notation: string | string[], options?: DiceBoxRollOptions): Promise<unknown>;
    add(notation: string | string[], options?: DiceBoxRollOptions): Promise<unknown>;
    reroll(notation: unknown): Promise<unknown>;
    remove(notation: unknown): Promise<unknown>;
    clear(): void;
    hide(): void;
    show(): void;
    onRollComplete: ((results: unknown[]) => void) | null;
    onDieComplete: ((result: unknown) => void) | null;
  }
}
