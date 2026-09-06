import type { BaseCommand } from "seyfert";

/**
 * The type of the command options.
 */
export interface DeveloperOptions {
    /**
     *
     * The cooldown.
     * @default 3
     */
    cooldown?: number;

    /**
     *
     * Only the bot developer can use the command.
     * And sent the command to developer(s) guild(s).
     * @default false
     */
    onlyDeveloper?: boolean;

    /**
     *
     * Only the guild owner cam use the command.
     * @default false
     */
    onlyGuildOwner?: boolean;

    /**
     * Skip registering the command.
     * @default false
     */
    skipRegister?: boolean;
}

/**
 * Represents a constructor function.
 */
type Instantiable<T> = new (...arg: any[]) => T;

/**
 * Decorator function type.
 */
type Decorator<T> = (target: T) => T;

export function DeveloperOptions<A extends Instantiable<any>>(options: A extends Instantiable<BaseCommand> ? DeveloperOptions : null): Decorator<A> {
    return (target: A) =>
        class extends target {
            constructor(...args: any[]) {
                super(...args);
                Object.assign(this, options);
            }
        };
}